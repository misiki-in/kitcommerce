/**
 * Etsy connector (Open API v3).
 *
 * Etsy requires every call to carry two credentials at once: an x-api-key
 * header identifying the app — the keystring and shared secret joined by a
 * colon — and an OAuth2 bearer token identifying the seller, which dies after
 * one hour. The connector renews the bearer from the 90-day refresh token and
 * caches it in memory. Listings are created as drafts before being activated,
 * and variants live in a separate inventory document keyed by listing ID.
 *
 * Docs: https://developers.etsy.com/documentation/reference
 * Verified against the official OpenAPI spec (openapi/generated/oas/3.0.0.json)
 * on 2026-08-27.
 */
import {
  ConnectorError,
  classifyStatus,
  money,
  type CanonicalProduct,
  type ConnectorContext,
  type InventoryUpdate,
  type Manifest,
  type MarketplaceConnector,
  type PriceUpdate,
  type RemoteOrder,
  type RemoteProduct,
} from "../connector";
import { createHash } from "node:crypto";
import { mockLatency, mockMaybeFail, mockRemoteId } from "./mock";

const API = "https://openapi.etsy.com/v3/application";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

const manifest: Manifest = {
  name: "etsy",
  group: "Global",
  status: "ready",
  idPrefix: "ETSY",
  displayName: "Etsy",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2_pkce",
    fields: [
      { key: "api_key", label: "Keystring (x-api-key)", secret: false },
      {
        key: "shared_secret",
        label: "Shared secret",
        secret: true,
        // Optional in the form only because pasting "keystring:sharedsecret"
        // into api_key is a supported escape hatch — a required input here
        // would block that path. apiKeyHeader still rejects the case where
        // neither shape supplies the secret.
        optional: true,
        help: "Sits next to the keystring on your app's page at etsy.com/developers/your-apps. Etsy requires it inside the x-api-key header on every call; leave this empty only if api_key already holds \"keystring:sharedsecret\".",
      },
      {
        key: "access_token",
        label: "OAuth Access Token",
        secret: true,
        optional: true,
        help: "Only lives one hour. With a refresh token present the connector mints its own, so this can stay empty.",
      },
      {
        key: "refresh_token",
        label: "OAuth Refresh Token",
        secret: true,
        optional: true,
        help: "From the one-time OAuth grant; valid 90 days and rotated on every renewal. Without it, live mode stops working an hour after the access token was minted.",
      },
    ],
  },
  regions: ["US", "GB", "DE", "FR", "CA", "AU", "IN"],
  capabilities: {
    createProduct: true,
    updateProduct: true,
    deleteProduct: true,
    inventorySync: true,
    priceSync: true,
    orderImport: true,
    orderUpdate: true,
    // Etsy does have order webhooks now (order.paid, order.canceled,
    // order.shipped, order.delivered — registered in the developer console's
    // webhook portal), but no listing webhooks, and this connector has no
    // receiver yet. It polls receipts instead; flip this only alongside a real
    // webhook endpoint.
    webhooks: false,
    bulkOperations: false,
    variants: true,
  },
  requiredFields: [
    { path: "title", label: "Listing title", required: true, help: "140 characters max" },
    { path: "description", label: "Description", required: true },
    { path: "images", label: "At least one image", required: true },
    {
      path: "attributes.etsy_taxonomy_id",
      label: "Etsy taxonomy ID",
      required: true,
      help: "Numeric leaf category from Etsy's seller taxonomy",
    },
    {
      path: "attributes.who_made",
      label: "Who made it",
      required: true,
      enum: ["i_did", "someone_else", "collective"],
    },
    {
      path: "attributes.when_made",
      label: "When was it made",
      required: true,
      // Etsy's own list, from the current OpenAPI spec. "vintage" is a
      // category, not a value, and the recent buckets are named for specific
      // years — a wrong one here is rejected at create time with a validation
      // error the seller cannot act on. The first year bucket rolls forward
      // (it is 2020_2026 in the 2026 spec), so this list needs re-checking
      // against the spec each January.
      enum: [
        "made_to_order",
        "2020_2026",
        "2010_2019",
        "2007_2009",
        "before_2007",
        "2000_2006",
        "1990s",
        "1980s",
        "1970s",
        "1960s",
        "1950s",
        "1940s",
        "1930s",
        "1920s",
        "1910s",
        "1900s",
        "1800s",
        "1700s",
        "before_1700",
      ],
    },
    {
      path: "attributes.etsy_shipping_profile_id",
      label: "Shipping profile ID",
      // Etsy dropped this requirement for drafts in January 2026. Still worth
      // asking for, because a listing cannot go live without one — but holding
      // a product out of the queue over it is no longer correct.
      required: false,
      help: "From Etsy Shop Manager > Settings > Shipping. Needed before the listing can go live.",
    },
  ],
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  docsUrl: "https://developers.etsy.com/documentation/reference",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/etsy.md",
  sellerPortalUrl: "https://www.etsy.com/your/orders/sold",
};

const shopId = (ctx: ConnectorContext) => {
  const id = ctx.config.shop_id;
  if (!id) throw new ConnectorError("channel config is missing shop_id", "VALIDATION");
  return String(id);
};

/**
 * The x-api-key header is no longer the keystring alone: current docs require
 * "keystring:shared_secret", colon-joined, on every v3 call. Sellers who
 * onboarded before the shared_secret field existed were told to paste the
 * combined form straight into api_key, so a value already containing a colon
 * is sent verbatim rather than joined twice.
 */
function apiKeyHeader(ctx: ConnectorContext): string {
  const { api_key, shared_secret } = ctx.credentials;
  if (!api_key) throw new ConnectorError("missing Etsy api_key", "AUTHENTICATION");
  if (api_key.includes(":")) return api_key;
  if (!shared_secret) {
    throw new ConnectorError(
      'Etsy requires the shared secret alongside the keystring: fill the shared_secret credential (it sits next to the keystring on your app page at etsy.com/developers/your-apps), or paste "keystring:sharedsecret" as the api_key',
      "AUTHENTICATION",
    );
  }
  return `${api_key}:${shared_secret}`;
}

/** The keystring half of api_key, which doubles as the OAuth client_id. */
function keystringOf(apiKey: string): string {
  const i = apiKey.indexOf(":");
  return i === -1 ? apiKey : apiKey.slice(0, i);
}

/**
 * Access tokens, cached for their stated lifetime.
 *
 * Etsy access tokens live one hour, so a channel that only stores the token
 * from the initial grant goes dark sixty minutes later. Whenever a refresh
 * token exists the connector renews proactively and caches the result, keyed
 * by a hash of the credentials — never the credentials themselves, because
 * this map is process-wide and a secret should not sit in a key that a future
 * debug dump would print.
 *
 * Etsy also rotates the refresh token: every renewal returns a new one and
 * retires the old. The newest lives in the cache entry and is preferred on the
 * next renewal; the stored credential is the fallback after a process restart
 * loses the cache.
 */
const tokenCache = new Map<string, { token: string; refreshToken: string; expiresAt: number }>();

/** Renew a minute early, so a token cannot expire mid-flight on a slow call. */
const TOKEN_MARGIN_MS = 60_000;

function refreshGrant(clientId: string, refreshToken: string): Promise<Response> {
  return fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });
}

async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { api_key, access_token, refresh_token } = ctx.credentials;

  if (!refresh_token) {
    // Legacy manual setups store only the one-hour access token. It goes
    // stale quickly, but with nothing to renew from it is the only option.
    if (!access_token) {
      throw new ConnectorError("missing Etsy access_token/refresh_token", "AUTHENTICATION");
    }
    return access_token;
  }

  const clientId = keystringOf(api_key ?? "");
  if (!clientId) throw new ConnectorError("missing Etsy api_key", "AUTHENTICATION");

  const cacheKey = createHash("sha256").update(`${clientId}|${refresh_token}`).digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const grantToken = cached?.refreshToken ?? refresh_token;
  let res = await refreshGrant(clientId, grantToken);
  if (!res.ok && grantToken !== refresh_token && (res.status === 400 || res.status === 401)) {
    // The rotated token from a previous renewal was refused. The stored one
    // may still be live (rotation and this cache can diverge across restarts),
    // so try it once before declaring the channel dead.
    res = await refreshGrant(clientId, refresh_token);
  }
  if (!res.ok) {
    if (res.status === 429) throw rateLimited(res);
    const text = await res.text();
    // A rejected refresh grant means the seller must redo the browser grant.
    // The token endpoint says 400 invalid_grant for a dead refresh token,
    // which is an auth problem, not a payload problem — retrying cannot help
    // and the channel should surface AUTH_FAILURE, not a validation error.
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new ConnectorError(
        `Etsy token refresh failed (${res.status}) — redo the OAuth grant: ${text.slice(0, 300)}`,
        "AUTHENTICATION",
      );
    }
    throw classifyStatus(res.status, text);
  }

  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  // expires_in is seconds (documented 3600). A missing value defaulting to
  // zero would re-fetch on every call — the bug this cache exists to fix — so
  // fall back to the documented hour.
  const lifetimeMs = (body.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    refreshToken: body.refresh_token ?? grantToken,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - TOKEN_MARGIN_MS),
  });

  return body.access_token;
}

/**
 * Etsy sends retry-after in seconds on 429; the daily budget is a sliding
 * 24h window, so its exhaustion can need far more than any fixed guess.
 * Shared between parse() and the token refresh, because the token endpoint
 * rate-limits too and classifyStatus would drop the retry-after header.
 */
function rateLimited(res: Response): ConnectorError {
  const retryAfter = Number(res.headers.get("retry-after"));
  return new ConnectorError("Etsy rate limit", "RATE_LIMITED", {
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000,
  });
}

/** Shared response handling, so both encodings classify failures identically. */
async function parse(res: Response): Promise<any> {
  if (res.status === 429) throw rateLimited(res);
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const apiKey = apiKeyHeader(ctx);
  const token = await accessToken(ctx);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return parse(res);
}

/**
 * Listing writes, which are form-encoded.
 *
 * Etsy's v3 API is JSON everywhere except createDraftListing and updateListing,
 * which take application/x-www-form-urlencoded. Sending those two JSON does not
 * fail as a content-type error — it comes back as a validation complaint about
 * the fields, which sends you looking in the wrong place entirely.
 *
 * Undefined and empty values are dropped rather than sent blank. Etsy validates
 * shipping_profile_id="" as a malformed ID instead of ignoring it, so an absent
 * optional field has to actually be absent from the body.
 */
async function callForm(
  ctx: ConnectorContext,
  path: string,
  method: "POST" | "PATCH" | "PUT",
  fields: Record<string, string | number | undefined>,
): Promise<any> {
  const apiKey = apiKeyHeader(ctx);
  const token = await accessToken(ctx);

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const s = String(value);
    if (s === "") continue;
    form.set(key, s);
  }

  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "x-api-key": apiKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  return parse(res);
}

/*
 * Inventory documents: what a PUT must carry beyond `products`.
 *
 * The top-level *_on_property arrays declare which properties price, quantity,
 * SKU and processing readiness vary on, and Etsy rejects a PUT whose values
 * are incompatible with them — per-variant SKUs with an empty sku_on_property,
 * for instance. They come back on every getListingInventory read, so updates
 * echo them rather than recompute them. property_values likewise keep their
 * readback property_id and value_ids (the write schema requires both) but drop
 * readback-only keys such as scale_name, which the write schema does not
 * accept.
 */
const writablePropertyValues = (propertyValues: any[]): any[] =>
  (propertyValues ?? []).map((pv: any) => ({
    property_id: pv.property_id,
    property_name: pv.property_name,
    scale_id: pv.scale_id ?? undefined,
    value_ids: pv.value_ids ?? [],
    values: pv.values ?? [],
  }));

/**
 * Which inventory products an update aimed at `sku` should touch.
 *
 * createDraftListing has no sku parameter, so Etsy auto-creates the inventory
 * product for a single-variant listing with sku "" — a strict sku match would
 * silently no-op every single-variant sync. When nothing in the document
 * matches and it holds exactly one product, that sole product is the target
 * regardless of its sku.
 */
function skuMatcher(products: any[], sku: string): (prod: any) => boolean {
  if (products.some((prod) => prod.sku === sku)) return (prod) => prod.sku === sku;
  if (products.length === 1) return () => true;
  return () => false;
}

const onPropertyFields = (inv: any) => ({
  price_on_property: inv?.price_on_property ?? [],
  quantity_on_property: inv?.quantity_on_property ?? [],
  sku_on_property: inv?.sku_on_property ?? [],
  readiness_state_on_property: inv?.readiness_state_on_property ?? [],
});

/**
 * Etsy's two custom variation slots. Real taxonomy properties would need a
 * getPropertiesByTaxonomyId lookup per category; the custom slots accept any
 * property_name, which is exactly what arbitrary OpenCommerce option names
 * are. Etsy supports at most two variation properties per listing.
 */
const CUSTOM_PROPERTY_IDS = [513, 514];

export const etsy: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return { status: "HEALTHY", detail: "mock mode" };
    }
    try {
      await call(ctx, `/shops/${shopId(ctx)}`);
      return { status: "HEALTHY" };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        status: err.class === "AUTHENTICATION" ? "AUTH_FAILURE" : "API_FAILURE",
        detail: err.message,
      };
    }
  },

  async createProduct(ctx, p: CanonicalProduct): Promise<RemoteProduct> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "createProduct");
      const remoteId = mockRemoteId("ETSY", p.sku);
      ctx.log(`mock: created Etsy listing ${remoteId} for ${p.sku}`);
      return { remoteId, url: `https://www.etsy.com/listing/${remoteId}` };
    }

    const a = p.attributes as any;
    const v = p.variants[0];

    // Etsy defines price and quantity as positive non-zero. A zero price will
    // never be accepted, so it fails here with the real reason instead of as
    // an opaque marketplace validation error five retries later.
    if (!v || p.variants.some((variant) => variant.priceCents <= 0)) {
      throw new ConnectorError(
        "Etsy rejects zero-price listings: every variant needs a positive price before publishing",
        "VALIDATION",
      );
    }
    let quantity = v.available;
    if (quantity < 1) {
      // Quantity is transient in a way price is not: the product may simply be
      // out of stock right now. Create the draft with the minimum Etsy accepts;
      // the next inventory sync overwrites it with the real quantity —
      // updateInventory's single-product fallback means that holds even for
      // single-variant listings, whose auto-created inventory product has no
      // sku to match on.
      ctx.log(
        `etsy: quantity clamped to 1 for ${p.sku} — Etsy cannot create a zero-quantity listing; the next inventory sync sets the real quantity`,
      );
      quantity = 1;
    }

    /*
     * createDraftListing always creates a draft — the endpoint has no state
     * parameter; publishing is a later updateListing with state=active.
     *
     * That suits this connector: Etsy requires images before a listing may be
     * "active", and uploadListingImage is not implemented yet — asking for
     * active without them is a guaranteed validation failure that reads like a
     * bad payload. A draft the seller activates in Shop Manager is the honest
     * outcome until image upload exists.
     */
    if (ctx.config.publish_immediately) {
      ctx.log("etsy: created as draft — activating needs images, which this connector does not upload yet");
    }

    const listing = (await callForm(ctx, `/shops/${shopId(ctx)}/listings`, "POST", {
      quantity,
      title: p.title.slice(0, 140),
      description: p.description,
      price: money(v.priceCents),
      who_made: a.who_made ?? "i_did",
      when_made: a.when_made ?? "made_to_order",
      taxonomy_id: a.etsy_taxonomy_id,
      // Optional since January 2026. Omitted when the seller has not set one,
      // rather than sent empty.
      shipping_profile_id: a.etsy_shipping_profile_id,
      item_weight: p.weightG > 0 ? p.weightG : undefined,
      // The spec's default unit is null, and Etsy's shipping UI assumes oz/lb
      // for US shops — a bare gram value would silently corrupt calculated
      // shipping. The unit travels with the weight or not at all.
      item_weight_unit: p.weightG > 0 ? "g" : undefined,
    })) as { listing_id: number; url?: string };

    const listingId = String(listing.listing_id);

    // Variants become an inventory document on the created listing.
    if (p.variants.length > 1) {
      // Option names, in first-seen order, mapped onto the custom slots.
      const names: string[] = [];
      for (const variant of p.variants) {
        for (const n of Object.keys(variant.options)) {
          if (!names.includes(n)) names.push(n);
        }
      }
      if (names.length > CUSTOM_PROPERTY_IDS.length) {
        throw new ConnectorError(
          `Etsy supports at most ${CUSTOM_PROPERTY_IDS.length} variation properties; this product has ${names.length} (${names.join(", ")})`,
          "VALIDATION",
        );
      }
      const propertyIdOf = new Map(names.map((n, i) => [n, CUSTOM_PROPERTY_IDS[i]]));

      // The write schema requires value_ids even for custom values, where no
      // Etsy-issued ID exists. IDs are assigned per property in first-seen
      // order, so the same product always produces the same document and a
      // retried PUT is a true replay.
      const valueIdsByName = new Map<string, Map<string, number>>();
      const valueIdFor = (name: string, value: string): number => {
        let ids = valueIdsByName.get(name);
        if (!ids) {
          ids = new Map();
          valueIdsByName.set(name, ids);
        }
        let id = ids.get(value);
        if (id === undefined) {
          id = ids.size + 1;
          ids.set(value, id);
        }
        return id;
      };

      // OpenCommerce models every variant with its own SKU, price and stock,
      // so all three are declared as varying on the option properties. Equal
      // values on a varying property are legal; the reverse — differing values
      // with an empty *_on_property — is what Etsy rejects, and it would also
      // freeze future per-variant inventory updates.
      const propertyIds = names.map((n) => propertyIdOf.get(n)!);

      await call(ctx, `/listings/${listingId}/inventory`, {
        method: "PUT",
        body: JSON.stringify({
          products: p.variants.map((variant) => ({
            sku: variant.sku,
            property_values: names
              .filter((n) => variant.options[n] !== undefined)
              .map((n) => ({
                property_id: propertyIdOf.get(n),
                property_name: n,
                value_ids: [valueIdFor(n, variant.options[n])],
                values: [variant.options[n]],
              })),
            offerings: [
              {
                price: Number(money(variant.priceCents)),
                quantity: variant.available,
                is_enabled: true,
              },
            ],
          })),
          price_on_property: propertyIds,
          quantity_on_property: propertyIds,
          sku_on_property: propertyIds,
        }),
      });
    }

    return { remoteId: listingId, url: listing.url, raw: listing };
  },

  async updateProduct(ctx, p, remoteId) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateProduct");
      ctx.log(`mock: updated Etsy listing ${remoteId}`);
      return;
    }
    await callForm(ctx, `/shops/${shopId(ctx)}/listings/${remoteId}`, "PATCH", {
      title: p.title.slice(0, 140),
      description: p.description,
    });
  },

  async updateInventory(ctx, u: InventoryUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateInventory");
      ctx.log(`mock: Etsy quantity ${u.sku} -> ${u.available}`);
      return;
    }
    const inv = await call(ctx, `/listings/${u.remoteId}/inventory`);
    const targets = skuMatcher(inv?.products ?? [], u.sku);
    const products = (inv?.products ?? []).map((prod: any) => ({
      sku: prod.sku,
      property_values: writablePropertyValues(prod.property_values),
      offerings: (prod.offerings ?? []).map((o: any) => ({
        price: Number(o.price?.amount ?? 0) / Number(o.price?.divisor ?? 100),
        quantity: targets(prod) ? u.available : o.quantity,
        is_enabled: o.is_enabled ?? true,
      })),
    }));
    await call(ctx, `/listings/${u.remoteId}/inventory`, {
      method: "PUT",
      body: JSON.stringify({ products, ...onPropertyFields(inv) }),
    });
  },

  async updatePrice(ctx, u: PriceUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updatePrice");
      ctx.log(`mock: Etsy price ${u.sku} -> ${money(u.priceCents)}`);
      return;
    }
    const inv = await call(ctx, `/listings/${u.remoteId}/inventory`);
    const targets = skuMatcher(inv?.products ?? [], u.sku);
    const products = (inv?.products ?? []).map((prod: any) => ({
      sku: prod.sku,
      property_values: writablePropertyValues(prod.property_values),
      offerings: (prod.offerings ?? []).map((o: any) => ({
        price: targets(prod) ? Number(money(u.priceCents)) : Number(o.price?.amount ?? 0) / Number(o.price?.divisor ?? 100),
        quantity: o.quantity,
        is_enabled: o.is_enabled ?? true,
      })),
    }));
    await call(ctx, `/listings/${u.remoteId}/inventory`, {
      method: "PUT",
      body: JSON.stringify({ products, ...onPropertyFields(inv) }),
    });
  },

  async listOrders(ctx, since): Promise<RemoteOrder[]> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      const skus: string[] = ctx.config.mockOrderSkus ?? [];
      return skus.slice(0, 1).map((sku, i) => ({
        externalId: `ETSY-ORD-${mockRemoteId("", sku)}-${i}`,
        status: "NEW",
        currency: "USD",
        totalCents: 3200,
        placedAt: new Date().toISOString(),
        customer: { name: "Sam Whitfield", email: "sam@example.com", phone: "" },
        shippingAddress: {
          line1: "18 Bridge Lane",
          city: "Brooklyn",
          state: "NY",
          postalCode: "11201",
          country: "US",
        },
        items: [
          { sku, title: "Mock Etsy item", quantity: 1, priceCents: 3200, remoteItemId: `ETI-${i}` },
        ],
      }));
    }

    /*
     * getShopReceipts pages by offset (limit max 100). The loop runs until a
     * short page: the min_created window bounds the work, and the caller polls
     * with a fixed 30-day lookback rather than an advancing watermark, so a
     * receipt dropped here is not picked up later — it is lost. The safety cap
     * exists only so a broken offset that returns full pages forever cannot
     * spin, and hitting it is worth a warning because it means real orders
     * went unread.
     */
    const minCreated = Math.floor(since.getTime() / 1000);
    const limit = 100;
    const MAX_PAGES = 100;
    const receipts: any[] = [];
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) {
        ctx.log(
          `etsy: listOrders stopped at the ${MAX_PAGES}-page safety cap with full pages still arriving — receipts beyond the first ${receipts.length} were not imported`,
        );
        break;
      }
      const body = await call(
        ctx,
        `/shops/${shopId(ctx)}/receipts?min_created=${minCreated}&limit=${limit}&offset=${page * limit}`,
      );
      const results = body?.results ?? [];
      receipts.push(...results);
      if (results.length < limit) break;
    }

    return receipts.map((r: any) => ({
      externalId: String(r.receipt_id),
      status: r.status ?? "NEW",
      currency: r.total_price?.currency_code ?? "USD",
      totalCents: Math.round(
        (Number(r.total_price?.amount ?? 0) / Number(r.total_price?.divisor ?? 100)) * 100,
      ),
      placedAt: new Date(Number(r.created_timestamp ?? 0) * 1000).toISOString(),
      customer: { name: r.name ?? "", email: r.buyer_email ?? "", phone: "" },
      shippingAddress: {
        line1: r.first_line ?? "",
        line2: r.second_line ?? "",
        city: r.city ?? "",
        state: r.state ?? "",
        postalCode: r.zip ?? "",
        country: r.country_iso ?? "",
      },
      items: (r.transactions ?? []).map((t: any) => ({
        sku: t.sku ?? "",
        title: t.title ?? "",
        quantity: Number(t.quantity ?? 1),
        priceCents: Math.round(
          (Number(t.price?.amount ?? 0) / Number(t.price?.divisor ?? 100)) * 100,
        ),
        remoteItemId: String(t.transaction_id ?? ""),
      })),
    }));
  },
};
