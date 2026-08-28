/**
 * Flipkart Marketplace Seller API v3 connector.
 *
 * The v3 Listing API attaches seller offers to catalogue products that already
 * exist on Flipkart -- it cannot create catalogue entries. Every listing write
 * is a map keyed by the seller SKU whose entries must name an existing
 * catalogue product through `product_id`, the FSN (13-16 characters). So
 * "createProduct" here means "attach a listing to the FSN in
 * `attributes.flipkart_fsn`"; the catalogue entry itself is made in Seller Hub
 * (Listings > Add New Listings, with brand approval where required), which is
 * why the FSN is a required attribute rather than something this connector
 * could invent.
 *
 * Write responses come back as maps keyed by SKU carrying a per-SKU status of
 * SUCCESS | FAILURE | WARNING inside an HTTP 200, so every write checks its
 * own entry -- a FAILURE is a permanent rejection and surfaces as VALIDATION
 * with Flipkart's messages attached.
 *
 * The seller SKU is the durable remote handle: every v3 endpoint addresses
 * listings by SKU, while the FSN names the catalogue product, not this
 * seller's offer on it. `remoteId` is therefore the SKU, and the SKU -> FSN
 * mapping is cached in process and re-learned from the listing GET after a
 * restart.
 *
 * Channel config: `sandbox: true` targets https://sandbox-api.flipkart.net for
 * both the token mint and the APIs; `location_id` (the dispatch location from
 * seller onboarding) is mandatory for listing and inventory writes.
 *
 * Unverified against a live account, because the fetched docs do not pin them:
 * the sub-schemas of `fulfillment` and `packages` in the listing payload (the
 * docs require the keys but not their fields; dimensions are sent in cm,
 * weight in kg), the price-update casing (Flipkart's own pages disagree
 * between `selling_price` and `sellingPrice`), and the nesting of
 * GET /sellers/listings/v3/{sku} used to re-learn an FSN.
 *
 * Docs: https://seller.flipkart.com/api-docs/FMSAPI.html
 * Last verified against official docs: 2026-08-27.
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

/** Sandbox and production expose identical paths, token mint included. */
const base = (ctx: ConnectorContext) =>
  ctx.config.sandbox ? "https://sandbox-api.flipkart.net" : "https://api.flipkart.net";

const manifest: Manifest = {
  name: "flipkart",
  group: "India — horizontal",
  status: "development",
  idPrefix: "FKS",
  displayName: "Flipkart",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2_client_credentials",
    fields: [
      {
        key: "client_id",
        label: "Application ID",
        secret: false,
        help: "From Seller Dashboard > Manage Profile > Developer Access — not your seller login.",
      },
      {
        key: "client_secret",
        label: "Application Secret",
        secret: true,
        help: "Shown alongside the Application ID when the self-access application is created.",
      },
    ],
  },
  regions: ["IN"],
  capabilities: {
    // "Create" attaches a listing to an existing catalogue product (the FSN in
    // attributes.flipkart_fsn); catalogue creation is not in the v3 API.
    createProduct: true,
    updateProduct: true,
    deleteProduct: false,
    inventorySync: true,
    priceSync: true,
    orderImport: true,
    orderUpdate: false,
    webhooks: false,
    bulkOperations: true,
    variants: true,
  },
  /*
   * Only what the listing payload actually transmits may hard-block a publish.
   * Catalogue content (title, category, images, ...) lives in Seller Hub and
   * this API does not accept it, so requiring it here would block products the
   * API would happily list. The two soft prompts flag Seller Hub gates worth
   * checking before the FSN exists.
   */
  requiredFields: [
    {
      path: "attributes.flipkart_fsn",
      label: "Flipkart product ID (FSN)",
      required: true,
      help:
        "The API only attaches listings to catalogue products that already exist on Flipkart. Create the product in Seller Hub first (brand approval where required) and paste its 13-16 character FSN here.",
    },
    { path: "hsnCode", label: "HSN code", required: true, help: "Required for GST invoicing" },
    { path: "weightG", label: "Shipping weight (g)", required: true },
    {
      path: "brand",
      label: "Brand",
      required: false,
      help:
        "Checked on the Seller Hub catalogue entry, not sent by this API — must match a Flipkart-approved brand there",
    },
    {
      path: "attributes.country_of_origin",
      label: "Country of origin",
      required: false,
      help:
        "Belongs to the Seller Hub catalogue entry, not this API — mandatory there under Indian labelling rules",
    },
  ],
  /*
   * Self-imposed. Flipkart documents no numeric request rate; its documented
   * cap is a batch size -- at most 10 SKUs per listing create/update call --
   * and this connector stays at one SKU per call.
   */
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  docsUrl: "https://seller.flipkart.com/api-docs/FMSAPI.html",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/flipkart.md",
  sellerPortalUrl: "https://seller.flipkart.com",
};

/**
 * Access tokens, cached for their stated lifetime.
 *
 * Flipkart's client_credentials tokens come back with an expires_in measured in
 * weeks, so fetching a fresh one for every listing write was the most wasteful
 * version of this mistake in the registry: a catalogue push of N products made
 * 2N requests, half of them re-minting a token that was already valid for the
 * next month.
 *
 * Keyed by a hash of the secret, never the secret itself. The host is part of
 * the identity: the sandbox mints its own tokens.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Renew a minute early, so a token cannot expire mid-flight on a slow call. */
const TOKEN_MARGIN_MS = 60_000;

async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { client_id, client_secret } = ctx.credentials;
  if (!client_id || !client_secret) {
    throw new ConnectorError("missing Flipkart client_id/client_secret", "AUTHENTICATION");
  }

  const cacheKey = createHash("sha256")
    .update(`${base(ctx)}|${client_id}|${client_secret}`)
    .digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const basic = Buffer.from(`${client_id}:${client_secret}`).toString("base64");
  const res = await fetch(
    `${base(ctx)}/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api`,
    { headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const body = (await res.json()) as { access_token: string; expires_in?: number };
  // Documented in seconds. Falling back to an hour rather than to zero, which
  // would silently restore the per-call fetch this cache exists to remove.
  const lifetimeMs = (body.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - TOKEN_MARGIN_MS),
  });

  return body.access_token;
}

async function call(
  ctx: ConnectorContext,
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const token = await accessToken(ctx);
  const res = await fetch(`${base(ctx)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after") ?? 30);
    throw new ConnectorError("Flipkart rate limit", "RATE_LIMITED", { retryAfterMs: ra * 1000 });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  return res.status === 204 ? null : res.json();
}

/**
 * Flipkart tracks stock per dispatch location, so listing and inventory writes
 * must name one. The id is assigned at seller onboarding (it also appears in
 * listing GET responses and the dashboard's dispatch settings); there is no
 * sane default to invent for it.
 */
function locationId(ctx: ConnectorContext): string {
  const id = ctx.config.location_id;
  if (!id) {
    throw new ConnectorError(
      "config.location_id is required for Flipkart listing and inventory writes — set it in the channel's Extra config (see the setup guide)",
      "VALIDATION",
    );
  }
  return String(id);
}

/**
 * SKU -> FSN, remembered per host + application. Inventory and price jobs
 * carry only the SKU, yet every v3 write must repeat the catalogue
 * `product_id`, so the mapping learned at listing time is kept here and
 * re-learned from the listing GET after a process restart. Keyed by a hash of
 * the application id, never a raw credential.
 */
const fsnCache = new Map<string, string>();

function fsnKey(ctx: ConnectorContext, sku: string): string {
  const app = createHash("sha256")
    .update(`${base(ctx)}|${ctx.credentials.client_id ?? ""}`)
    .digest("hex");
  return `${app}|${sku}`;
}

async function resolveFsn(ctx: ConnectorContext, sku: string): Promise<string> {
  const cached = fsnCache.get(fsnKey(ctx, sku));
  if (cached) return cached;

  const body = await call(ctx, `/sellers/listings/v3/${encodeURIComponent(sku)}`);
  // The docs confirm the FSN appears in this response without pinning its
  // nesting, so accept both the API's map-keyed convention and an `available`
  // array of listings.
  const entry =
    body?.[sku] ??
    (Array.isArray(body?.available)
      ? body.available.find((l: any) => (l?.sku_id ?? l?.skuId) === sku) ?? body.available[0]
      : undefined);
  const fsn = entry?.product_id ?? entry?.productId ?? entry?.fsn;
  if (!fsn) {
    throw new ConnectorError(
      `cannot resolve the Flipkart product ID (FSN) for SKU ${sku} — republish the product so attributes.flipkart_fsn reaches this channel`,
      "VALIDATION",
      { details: body },
    );
  }
  fsnCache.set(fsnKey(ctx, sku), String(fsn));
  return String(fsn);
}

/**
 * Every v3 write answers with a map keyed by SKU whose entries carry a status
 * of SUCCESS | FAILURE | WARNING — inside an HTTP 200, so a rejected listing
 * would otherwise report as created. FAILURE is a permanent rejection of this
 * payload and maps to VALIDATION with Flipkart's own error and
 * attribute-error messages attached; WARNING means accepted, so it is logged
 * and let through.
 */
function checkSkuResult(ctx: ConnectorContext, body: any, sku: string, what: string): void {
  const entry = body?.[sku];
  const status = String(entry?.status ?? "").toUpperCase();
  if (status === "FAILURE") {
    const detail = [...(entry?.errors ?? []), ...(entry?.attribute_errors ?? [])]
      .map((e: any) => (typeof e === "string" ? e : e?.description ?? e?.message ?? JSON.stringify(e)))
      .join("; ");
    throw new ConnectorError(
      `Flipkart rejected ${what} for ${sku}: ${detail || "no detail returned"}`,
      "VALIDATION",
      { details: entry },
    );
  }
  if (status === "WARNING") {
    ctx.log(`flipkart: ${what} for ${sku} accepted with warnings`, { entry });
  }
}

/**
 * Canonical -> one entry of the map-keyed v3 listing payload.
 *
 * The entry names the catalogue product (`product_id`, the FSN from
 * attributes.flipkart_fsn) and carries only offer data: price, tax, status,
 * fulfilment and per-location stock. Catalogue content — title, description,
 * images — lives in Seller Hub and is not accepted by this API.
 *
 * The docs require the `fulfillment_profile`, `fulfillment` and `packages`
 * keys without publishing their sub-schemas; the shapes below follow
 * Flipkart's published examples (dimensions in cm, weight in kg) and are the
 * first thing to verify in sandbox.
 */
function toListing(ctx: ConnectorContext, p: CanonicalProduct) {
  const fsn = (p.attributes as any).flipkart_fsn;
  if (!fsn) {
    throw new ConnectorError(
      "attributes.flipkart_fsn is required — the v3 Listing API attaches offers to existing catalogue products",
      "VALIDATION",
    );
  }
  const v = p.variants[0];
  return {
    product_id: String(fsn),
    price: {
      mrp: Number(money(v?.mrpCents ?? 0)),
      selling_price: Number(money(v?.priceCents ?? 0)),
      currency: v?.currency ?? ctx.seller.currency,
    },
    tax: {
      hsn: p.hsnCode,
      is_gst_sellable: true,
      goods_services_rate: Number((p.attributes as any).gst_percentage ?? p.taxRateBp / 100),
    },
    listing_status: "ACTIVE",
    fulfillment_profile: ctx.config.fulfillment_profile ?? "NON_FBF",
    fulfillment: { dispatch_sla: Number(ctx.config.dispatch_sla ?? 2) },
    packages: [
      {
        id: `pkg-${p.sku}`,
        dimensions: {
          length: (p.lengthMm || 0) / 10,
          breadth: (p.widthMm || 0) / 10,
          height: (p.heightMm || 0) / 10,
        },
        weight: (v?.weightG || p.weightG || 0) / 1000,
      },
    ],
    locations: [{ id: locationId(ctx), inventory: v?.available ?? 0 }],
  };
}

/**
 * Hard cap on shipment-filter pagination. A page holds up to 20 shipments, so
 * ten pages cover a generous sync window; past that, a bad watermark or a
 * self-referencing nextPageUrl would spin forever.
 */
const MAX_ORDER_PAGES = 10;

/**
 * `nextPageUrl` is documented only as "the URL to call for the next page".
 * Normalise it onto our own host so bearer auth and the sandbox flag keep
 * applying whether Flipkart returns an absolute URL or a /sellers-relative
 * path.
 */
function nextPagePath(url: string): string {
  if (/^https?:\/\//.test(url)) {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  }
  return url.startsWith("/sellers") ? url : `/sellers${url.startsWith("/") ? "" : "/"}${url}`;
}

export const flipkart: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return { status: "HEALTHY", detail: "mock mode" };
    }
    try {
      await accessToken(ctx);
      return { status: "HEALTHY" };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        status: err.class === "AUTHENTICATION" ? "AUTH_FAILURE" : "API_FAILURE",
        detail: err.message,
      };
    }
  },

  async createProduct(ctx, p): Promise<RemoteProduct> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "createProduct");
      const remoteId = mockRemoteId("FKS", p.sku);
      ctx.log(`mock: created Flipkart listing ${remoteId} for ${p.sku}`);
      return { remoteId, url: `https://www.flipkart.com/mock/${remoteId}` };
    }
    const listing = toListing(ctx, p);
    const body = await call(ctx, "/sellers/listings/v3", {
      method: "POST",
      body: JSON.stringify({ [p.sku]: listing }),
    });
    checkSkuResult(ctx, body, p.sku, "listing create");
    fsnCache.set(fsnKey(ctx, p.sku), listing.product_id);
    // The SKU is the durable handle: every v3 endpoint addresses the listing
    // by seller SKU, and the FSN names the catalogue product, not this offer.
    return { remoteId: p.sku, raw: body };
  },

  async updateProduct(ctx, p, remoteId) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateProduct");
      ctx.log(`mock: updated Flipkart listing ${remoteId}`);
      return;
    }
    // The map key must be the seller SKU — the canonical SKU is what the API
    // addresses, whatever an older mapping may have stored as remoteId.
    const listing = toListing(ctx, p);
    const body = await call(ctx, "/sellers/listings/v3/update", {
      method: "POST",
      body: JSON.stringify({ [p.sku]: listing }),
    });
    checkSkuResult(ctx, body, p.sku, "listing update");
    fsnCache.set(fsnKey(ctx, p.sku), listing.product_id);
  },

  async updateInventory(ctx, u: InventoryUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateInventory");
      ctx.log(`mock: Flipkart inventory ${u.sku} -> ${u.available}`);
      return;
    }
    const fsn = await resolveFsn(ctx, u.sku);
    const body = await call(ctx, "/sellers/listings/v3/update/inventory", {
      method: "POST",
      body: JSON.stringify({
        [u.sku]: {
          product_id: fsn,
          locations: [{ id: locationId(ctx), inventory: u.available }],
        },
      }),
    });
    checkSkuResult(ctx, body, u.sku, "inventory update");
  },

  async updatePrice(ctx, u: PriceUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updatePrice");
      ctx.log(`mock: Flipkart price ${u.sku} -> ${money(u.priceCents)}`);
      return;
    }
    const fsn = await resolveFsn(ctx, u.sku);
    const body = await call(ctx, "/sellers/listings/v3/update/price", {
      method: "POST",
      body: JSON.stringify({
        [u.sku]: {
          product_id: fsn,
          // Flipkart's price page spells this `sellingPrice` while the create
          // schema uses `selling_price`; snake_case follows the create schema
          // — verify in sandbox before relying on it.
          price: {
            mrp: Number(money(u.mrpCents)),
            selling_price: Number(money(u.priceCents)),
            currency: u.currency,
          },
        },
      }),
    });
    checkSkuResult(ctx, body, u.sku, "price update");
  },

  async listOrders(ctx, since): Promise<RemoteOrder[]> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return mockOrders(ctx, since);
    }

    const orders = new Map<string, RemoteOrder>();
    // `filter.type` is mandatory and scopes the search to pre-dispatch
    // shipments, matching the states below; dispatched/delivered orders would
    // need a second postDispatch pass.
    let init: RequestInit | undefined = {
      method: "POST",
      body: JSON.stringify({
        filter: {
          type: "preDispatch",
          states: ["APPROVED", "PACKING_IN_PROGRESS"],
          orderDate: { from: since.toISOString(), to: new Date().toISOString() },
        },
        pagination: { pageSize: 20 },
      }),
    };
    let next: string | null = "/sellers/v3/shipments/filter";

    for (let page = 0; next && page < MAX_ORDER_PAGES; page++) {
      const body = await call(ctx, next, init);
      // Subsequent pages are plain GETs of the returned nextPageUrl.
      init = undefined;

      // orderItems are nested per shipment; group them back into one
      // RemoteOrder per marketplace order.
      for (const shipment of body?.shipments ?? []) {
        for (const o of shipment?.orderItems ?? []) {
          const orderId = String(o?.orderId ?? "");
          if (!orderId) continue;
          const priceCents = Math.round(Number(o.priceComponents?.sellingPrice ?? 0) * 100);
          let order = orders.get(orderId);
          if (!order) {
            order = {
              externalId: orderId,
              status: String(o.status ?? "NEW"),
              currency: "INR",
              totalCents: 0,
              placedAt: o.orderDate ?? new Date().toISOString(),
              // The preDispatch filter response carries no buyer contact or
              // address fields this connector can rely on — labels and
              // invoices own that data downstream.
              customer: { name: "", email: "", phone: "" },
              shippingAddress: {},
              items: [],
            };
            orders.set(orderId, order);
          }
          order.items.push({
            sku: o.sku ?? "",
            title: o.title ?? "",
            quantity: Number(o.quantity ?? 1),
            priceCents,
            remoteItemId: String(o.orderItemId ?? ""),
          });
          order.totalCents += priceCents;
        }
      }

      next =
        body?.hasMore && typeof body?.nextPageUrl === "string" && body.nextPageUrl
          ? nextPagePath(body.nextPageUrl)
          : null;
    }

    // A non-null `next` here means the cap fired with hasMore still true —
    // this pass returned a partial window, and silence would hide that.
    if (next) {
      ctx.log(
        `flipkart: order sync stopped at the ${MAX_ORDER_PAGES}-page cap with more shipments pending — results are partial until the next sync`,
      );
    }

    return [...orders.values()];
  },
};

/** Deterministic sample orders so the order pipeline is demonstrable offline. */
function mockOrders(ctx: ConnectorContext, _since: Date): RemoteOrder[] {
  const skus: string[] = ctx.config.mockOrderSkus ?? [];
  return skus.slice(0, 2).map((sku, i) => ({
    externalId: `FK-ORD-${mockRemoteId("", sku)}-${i}`,
    status: "NEW",
    currency: "INR",
    totalCents: 129900,
    placedAt: new Date().toISOString(),
    customer: { name: "Ananya Rao", email: "ananya@example.in", phone: "+91-9800000000" },
    shippingAddress: {
      line1: "12 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "IN",
    },
    items: [
      { sku, title: "Mock Flipkart item", quantity: 1, priceCents: 129900, remoteItemId: `FKI-${i}` },
    ],
  }));
}
