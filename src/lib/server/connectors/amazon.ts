/**
 * Amazon connector (Selling Partner API).
 *
 * SP-API is the one marketplace here with a fully public reference, so this is
 * a first-class implementation rather than a documented-shape sketch.
 *
 * Two things that trip people up:
 *   - India lives on the EU endpoint (sellingpartnerapi-eu), not a dedicated
 *     Indian host. The marketplace ID is what selects the storefront.
 *   - SP-API no longer requires AWS SigV4 request signing; the LWA bearer token
 *     is sufficient. Older integration guides still tell you otherwise.
 *
 * Orders are read through Orders API v0, which Amazon has deprecated and will
 * remove on 2027-03-27. It keeps working until then; the migration target is
 * Orders API v2026-01-01 (searchOrders/getOrder with includedData), which
 * folds line items and role-based buyer PII into one call and retires both
 * the per-order item fetch and the Restricted Data Token dance in listOrders.
 *
 * Docs: https://developer-docs.amazon.com/sp-api/
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

/** Region host is chosen by marketplace, not by the seller's country. */
const REGION_HOSTS = {
  eu: "https://sellingpartnerapi-eu.amazon.com", // IN, UK, DE, FR, IT, ES, AE, SA
  na: "https://sellingpartnerapi-na.amazon.com", // US, CA, MX, BR
  fe: "https://sellingpartnerapi-fe.amazon.com", // JP, AU, SG
} as const;

export const MARKETPLACES: Record<string, { id: string; region: keyof typeof REGION_HOSTS; currency: string }> = {
  IN: { id: "A21TJRUUN4KGV", region: "eu", currency: "INR" },
  US: { id: "ATVPDKIKX0DER", region: "na", currency: "USD" },
  UK: { id: "A1F83G8C2ARO7P", region: "eu", currency: "GBP" },
  DE: { id: "A1PA6795UKMFR9", region: "eu", currency: "EUR" },
  AE: { id: "A2VIGQ35RCS4UG", region: "eu", currency: "AED" },
  AU: { id: "A39IBJ37TRP1C6", region: "fe", currency: "AUD" },
  JP: { id: "A1VC38T7YXB528", region: "fe", currency: "JPY" },
};

const manifest: Manifest = {
  name: "amazon",
  group: "India — horizontal",
  status: "development",
  idPrefix: "AMZ",
  displayName: "Amazon",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2_lwa",
    fields: [
      { key: "client_id", label: "LWA Client ID", secret: false },
      { key: "client_secret", label: "LWA Client Secret", secret: true },
      { key: "refresh_token", label: "Refresh Token", secret: true },
      { key: "seller_id", label: "Selling Partner ID", secret: false },
    ],
  },
  credentialsNote:
    "Amazon issues these only after a reviewed developer registration (Seller Central > Apps and Services > Develop Apps), which takes days to approve. If this installation has Amazon OAuth configured, the Connect button obtains everything except the review for you — the setup guide covers both routes.",
  regions: Object.keys(MARKETPLACES),
  capabilities: {
    createProduct: true,
    updateProduct: true,
    deleteProduct: true,
    inventorySync: true,
    priceSync: true,
    orderImport: true,
    orderUpdate: true,
    webhooks: true, // via SP-API Notifications + SQS
    bulkOperations: true,
    variants: true,
  },
  requiredFields: [
    { path: "title", label: "Item name", required: true, help: "200 characters max" },
    { path: "brand", label: "Brand", required: true, help: "Must be Brand Registry approved" },
    { path: "description", label: "Description", required: true },
    { path: "images", label: "Main image", required: true, help: "Min 1000px on the longest side" },
    {
      path: "attributes.amazon_product_type",
      label: "Product type",
      required: true,
      help: "From the Product Type Definitions API, e.g. SHIRT, LUGGAGE, FINERING",
    },
    {
      path: "attributes.amazon_browse_node_id",
      label: "Browse node ID",
      required: true,
      help: "Numeric category node for the target marketplace",
    },
    {
      path: "attributes.condition",
      label: "Condition",
      required: true,
      // Canonical vocabulary, shared with every other connector. Amazon's own
      // condition_type values are translated below -- a marketplace's private
      // vocabulary must never leak into the canonical model.
      enum: ["NEW", "LIKE_NEW", "USED_EXCELLENT", "USED_GOOD", "USED_ACCEPTABLE"],
    },
    {
      path: "attributes.country_of_origin",
      label: "Country of origin",
      required: true,
      help: "Mandatory for Amazon India listings",
    },
    { path: "hsnCode", label: "HSN code", required: true, help: "Required for GST invoicing (IN)" },
    { path: "weightG", label: "Item weight (g)", required: true },
  ],
  // SP-API rate limits are per-operation; this is the conservative floor for
  // the Listings Items endpoints. putListingsItem allows 5 rps with a burst of
  // 10, but patchListingsItem — the inventory and price path — bursts only to
  // 5, and the floor is what keeps a mixed batch safe.
  rateLimits: { requestsPerSecond: 5, burst: 5 },
  docsUrl: "https://developer-docs.amazon.com/sp-api/",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/amazon.md",
  sellerPortalUrl: "https://sellercentral.amazon.in",
  orderUrlTemplate: "https://sellercentral.amazon.in/orders-v3/order/{id}",
};

/** Canonical condition -> Amazon's condition_type vocabulary. */
const CONDITION_MAP: Record<string, string> = {
  NEW: "new_new",
  LIKE_NEW: "used_like_new",
  USED_EXCELLENT: "used_very_good",
  USED_GOOD: "used_good",
  USED_ACCEPTABLE: "used_acceptable",
};

function marketplace(ctx: ConnectorContext) {
  const code = String(ctx.config.marketplace ?? "IN").toUpperCase();
  const m = MARKETPLACES[code];
  if (!m) {
    throw new ConnectorError(
      `unsupported Amazon marketplace "${code}" (expected one of ${Object.keys(MARKETPLACES).join(", ")})`,
      "VALIDATION",
    );
  }
  return m;
}

/**
 * LWA access tokens, cached for their stated lifetime.
 *
 * Amazon's tokens last an hour and every SP-API call needs one. A listOrders
 * run makes one call per order for line items, so exchanging per request would
 * multiply traffic against the LWA token endpoint — which carries its own,
 * much tighter throttle than SP-API itself. Keyed by a hash of the
 * credentials, never the credentials themselves: this map is process-wide and
 * a secret should not sit in a key that any future debug dump of it would
 * print.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Renew a minute early, so a token cannot expire mid-flight on a slow call. */
const TOKEN_MARGIN_MS = 60_000;

async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { client_id, client_secret, refresh_token } = ctx.credentials;
  if (!client_id || !client_secret || !refresh_token) {
    throw new ConnectorError(
      "missing Amazon client_id/client_secret/refresh_token",
      "AUTHENTICATION",
    );
  }

  const cacheKey = createHash("sha256").update(`${client_id}|${refresh_token}`).digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      client_id,
      client_secret,
    }),
  });
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  // expires_in is seconds (documented 3600). A missing value must not become
  // an immediately-stale cache entry — the bug this cache exists to prevent —
  // so it falls back to the documented hour.
  const lifetimeMs = (body.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - TOKEN_MARGIN_MS),
  });
  return body.access_token;
}

async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const token = await accessToken(ctx);
  const host = REGION_HOSTS[marketplace(ctx).region];
  const res = await fetch(`${host}${path}`, {
    ...init,
    headers: {
      "x-amz-access-token": token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429) {
    // SP-API returns quota headers rather than Retry-After on most endpoints.
    throw new ConnectorError("Amazon SP-API throttled", "RATE_LIMITED", { retryAfterMs: 60_000 });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const sellerId = (ctx: ConnectorContext) => {
  const id = ctx.credentials.seller_id ?? ctx.config.seller_id;
  if (!id) throw new ConnectorError("missing Amazon seller_id", "AUTHENTICATION");
  return String(id);
};

/**
 * Listings Items submissions answer 200 with a status of ACCEPTED or INVALID.
 * INVALID is a permanent rejection: surfacing it as VALIDATION keeps the job
 * from being retried and puts Amazon's issues in front of the merchant,
 * instead of reporting success for a change that never happened.
 */
function rejectInvalid(body: any, what: string): void {
  if (body?.status !== "INVALID") return;
  throw new ConnectorError(
    `Amazon rejected the ${what}: ${(body.issues ?? []).map((i: any) => i.message).join("; ")}`,
    "VALIDATION",
    { details: body.issues },
  );
}

/**
 * Restricted Data Token for order PII.
 *
 * Orders v0 treats buyer name/email and the shipping address as restricted
 * data elements: getOrders succeeds on a plain LWA token but silently omits
 * them. An RDT scoped to /orders/v0/orders (minted with the normal token on
 * the same region host, ~1h lifetime) unlocks them when passed as
 * x-amz-access-token on the getOrders calls — and only those: an RDT is
 * valid solely for the restrictedResources named at minting, so the
 * per-order item fetches stay on the plain token. Minting one requires
 * the Direct-to-Consumer Shipping (Restricted) role on the app; when the role
 * is missing Amazon answers 403, and the sync deliberately falls back to the
 * plain token — an order without a buyer address is still an order, and
 * missing PII must never be the reason an import fails.
 */
async function restrictedToken(ctx: ConnectorContext): Promise<string | null> {
  try {
    const body = await call(ctx, "/tokens/2021-03-01/restrictedDataToken", {
      method: "POST",
      body: JSON.stringify({
        restrictedResources: [
          {
            method: "GET",
            path: "/orders/v0/orders",
            dataElements: ["buyerInfo", "shippingAddress"],
          },
        ],
      }),
    });
    return body?.restrictedDataToken ?? null;
  } catch (e) {
    const err = e as ConnectorError;
    if (err.class === "AUTHENTICATION") {
      ctx.log(
        "restricted data token refused (app lacks the restricted PII role); importing orders without buyer PII",
      );
      return null;
    }
    throw e;
  }
}

/** A corrupt NextToken or bad watermark must never spin the sync forever. */
const ORDER_PAGE_CAP = 10;

/**
 * getOrderItems allows 0.5 rps with a burst of 30. The first ~25 item fetches
 * ride the burst (with headroom left for other traffic); the rest are paced
 * under the refill rate so a large sync degrades to slow instead of to 429s.
 */
const ITEM_BURST_HEADROOM = 25;
const ITEM_PACE_MS = 2_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Canonical -> SP-API Listings Items attributes.
 *
 * Every value is an array of objects with a marketplace_id, which is the shape
 * that catches people out coming from other marketplace APIs.
 */
function toListingAttributes(ctx: ConnectorContext, p: CanonicalProduct) {
  const m = marketplace(ctx);
  const a = p.attributes as any;
  const v = p.variants[0];
  const mk = <T>(value: T) => [{ value, marketplace_id: m.id }];

  return {
    item_name: mk(p.title.slice(0, 200)),
    brand: mk(p.brand),
    product_description: mk(p.description),
    condition_type: [
      { value: CONDITION_MAP[String(a.condition ?? "NEW")] ?? "new_new", marketplace_id: m.id },
    ],
    country_of_origin: mk(a.country_of_origin ?? "IN"),
    recommended_browse_nodes: mk(String(a.amazon_browse_node_id ?? "")),
    main_product_image_locator: p.images[0]
      ? [{ media_location: p.images[0].url, marketplace_id: m.id }]
      : undefined,
    other_product_image_locator_1: p.images[1]
      ? [{ media_location: p.images[1].url, marketplace_id: m.id }]
      : undefined,
    list_price: [
      { value: Number(money(v?.mrpCents ?? 0)), currency: v?.currency ?? m.currency, marketplace_id: m.id },
    ],
    purchasable_offer: [
      {
        currency: v?.currency ?? m.currency,
        our_price: [{ schedule: [{ value_with_tax: Number(money(v?.priceCents ?? 0)) }] }],
        marketplace_id: m.id,
      },
    ],
    // Inventory rides along on the listing rather than a separate call, for
    // merchant-fulfilled offers.
    fulfillment_availability: [
      {
        fulfillment_channel_code: ctx.config.fulfillment ?? "DEFAULT",
        quantity: v?.available ?? 0,
        marketplace_id: m.id,
      },
    ],
    item_package_weight: p.weightG
      ? [{ value: p.weightG, unit: "grams", marketplace_id: m.id }]
      : undefined,
    supplier_declared_has_product_identifier_exemption: mk(!v?.barcode),
    externally_assigned_product_identifier: v?.barcode
      ? [{ type: "ean", value: v.barcode, marketplace_id: m.id }]
      : undefined,
    gst_hsn_code: p.hsnCode ? mk(p.hsnCode) : undefined,
  };
}

export const amazon: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return { status: "HEALTHY", detail: `mock mode (${ctx.config.marketplace ?? "IN"})` };
    }
    try {
      const m = marketplace(ctx);
      // getMarketplaceParticipations is limited to 0.016 rps (burst 15) —
      // roughly one call a minute. Anything polling health faster than that
      // eats the burst and starts seeing 429s.
      await call(ctx, `/sellers/v1/marketplaceParticipations`);
      return { status: "HEALTHY", detail: `${m.id}` };
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
      const remoteId = mockRemoteId("AMZ", p.sku);
      ctx.log(`mock: created Amazon listing ${remoteId} for ${p.sku}`);
      return { remoteId, url: `https://www.amazon.in/dp/${remoteId}` };
    }

    const m = marketplace(ctx);
    const a = p.attributes as any;
    if (!a.amazon_product_type) {
      throw new ConnectorError("amazon_product_type is required", "VALIDATION");
    }

    // PUT is a full replace keyed by SKU, so a retry is naturally idempotent.
    const body = await call(
      ctx,
      `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(p.sku)}?marketplaceIds=${m.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          productType: a.amazon_product_type,
          requirements: "LISTING",
          attributes: toListingAttributes(ctx, p),
        }),
      },
    );

    rejectInvalid(body, "listing");
    // Amazon keys listings by the seller's own SKU; the ASIN only appears once
    // the listing is matched or created, so the SKU is the durable handle.
    return { remoteId: p.sku, raw: body };
  },

  async updateProduct(ctx, p, remoteId) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateProduct");
      ctx.log(`mock: updated Amazon listing ${remoteId}`);
      return;
    }
    const m = marketplace(ctx);
    const body = await call(
      ctx,
      `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(remoteId)}?marketplaceIds=${m.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          productType: (p.attributes as any).amazon_product_type,
          requirements: "LISTING",
          attributes: toListingAttributes(ctx, p),
        }),
      },
    );
    rejectInvalid(body, "listing update");
  },

  async updateInventory(ctx, u: InventoryUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateInventory");
      ctx.log(`mock: Amazon quantity ${u.sku} -> ${u.available}`);
      return;
    }
    const m = marketplace(ctx);
    // PATCH touches only fulfillment_availability, leaving the rest of the
    // listing untouched.
    const body = await call(
      ctx,
      `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(u.sku)}?marketplaceIds=${m.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          // patchListingsItem requires the listing's real product type and
          // rejects the patch when this one mismatches it. The "PRODUCT"
          // fallback only keeps the request well-formed — sellers should set
          // config.default_product_type to the type their listings actually
          // use.
          productType: ctx.config.default_product_type ?? "PRODUCT",
          patches: [
            {
              op: "replace",
              path: "/attributes/fulfillment_availability",
              value: [
                {
                  fulfillment_channel_code: ctx.config.fulfillment ?? "DEFAULT",
                  quantity: u.available,
                },
              ],
            },
          ],
        }),
      },
    );
    rejectInvalid(body, "inventory patch");
  },

  async updatePrice(ctx, u: PriceUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updatePrice");
      ctx.log(`mock: Amazon price ${u.sku} -> ${money(u.priceCents)}`);
      return;
    }
    const m = marketplace(ctx);
    const body = await call(
      ctx,
      `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(u.sku)}?marketplaceIds=${m.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          // Same constraint as updateInventory: the patch is rejected when
          // this product type mismatches the listing's real one, so
          // config.default_product_type should be set.
          productType: ctx.config.default_product_type ?? "PRODUCT",
          patches: [
            {
              op: "replace",
              path: "/attributes/purchasable_offer",
              value: [
                {
                  currency: u.currency,
                  our_price: [{ schedule: [{ value_with_tax: Number(money(u.priceCents)) }] }],
                  marketplace_id: m.id,
                },
              ],
            },
          ],
        }),
      },
    );
    rejectInvalid(body, "price patch");
  },

  async listOrders(ctx, since): Promise<RemoteOrder[]> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      const skus: string[] = ctx.config.mockOrderSkus ?? [];
      return skus.slice(0, 2).map((sku, i) => ({
        externalId: `AMZ-${mockRemoteId("", sku)}-${i}`,
        status: "NEW",
        currency: "INR",
        totalCents: 89900,
        placedAt: new Date().toISOString(),
        customer: { name: "Rahul Menon", email: "", phone: "" },
        shippingAddress: {
          line1: "7 Residency Road",
          city: "Kochi",
          state: "Kerala",
          postalCode: "682011",
          country: "IN",
        },
        items: [
          { sku, title: "Mock Amazon item", quantity: 1, priceCents: 89900, remoteItemId: `AMZI-${i}` },
        ],
      }));
    }

    const m = marketplace(ctx);

    // Buyer PII only travels on a Restricted Data Token, and an RDT is valid
    // solely for the restrictedResources it was minted for (GET
    // /orders/v0/orders) — so it rides the order pages only. The per-order
    // item fetches below stay on the plain LWA token: none of the mapped item
    // fields is a restricted data element, and reusing the RDT there would
    // 403 every fetch.
    const rdt = await restrictedToken(ctx);
    const auth = rdt ? { "x-amz-access-token": rdt } : undefined;

    const orders: any[] = [];
    let next: string | undefined;
    for (let page = 0; page < ORDER_PAGE_CAP; page++) {
      // NextToken supersedes the filter parameters on follow-up pages;
      // MarketplaceIds stays because the API requires it on every call.
      const query = next
        ? `MarketplaceIds=${m.id}&NextToken=${encodeURIComponent(next)}`
        : `MarketplaceIds=${m.id}&CreatedAfter=${encodeURIComponent(since.toISOString())}&MaxResultsPerPage=50`;
      const body = await call(ctx, `/orders/v0/orders?${query}`, { headers: auth });
      orders.push(...(body?.payload?.Orders ?? []));
      next = body?.payload?.NextToken;
      if (!next) break;
    }
    if (next) {
      ctx.log(
        `amazon: order pagination capped at ${ORDER_PAGE_CAP} pages; more orders remain in the window`,
      );
    }

    const out: RemoteOrder[] = [];
    for (const [i, o] of orders.entries()) {
      // Line items are a separate call per order; SP-API has no expand.
      if (i >= ITEM_BURST_HEADROOM) await sleep(ITEM_PACE_MS);
      let items: RemoteOrder["items"] = [];
      try {
        const li = await call(ctx, `/orders/v0/orders/${o.AmazonOrderId}/orderItems`);
        items = (li?.payload?.OrderItems ?? []).map((it: any) => ({
          sku: it.SellerSKU ?? "",
          title: it.Title ?? "",
          quantity: Number(it.QuantityOrdered ?? 1),
          priceCents: Math.round(Number(it.ItemPrice?.Amount ?? 0) * 100),
          remoteItemId: String(it.OrderItemId ?? ""),
        }));
      } catch (e) {
        // A failed line-item fetch should not lose the order header, but it
        // must not vanish silently either: the order lands with no items and
        // this log line is the only trace of why.
        const err = e as ConnectorError;
        ctx.log(`order ${o.AmazonOrderId}: line items not fetched (${err.class}): ${err.message}`);
      }

      out.push({
        externalId: String(o.AmazonOrderId),
        status: String(o.OrderStatus ?? "NEW"),
        currency: o.OrderTotal?.CurrencyCode ?? m.currency,
        totalCents: Math.round(Number(o.OrderTotal?.Amount ?? 0) * 100),
        placedAt: o.PurchaseDate ?? new Date().toISOString(),
        customer: {
          name: o.BuyerInfo?.BuyerName ?? "",
          email: o.BuyerInfo?.BuyerEmail ?? "",
          phone: "",
        },
        shippingAddress: o.ShippingAddress ?? {},
        items,
      });
    }
    return out;
  },
};
