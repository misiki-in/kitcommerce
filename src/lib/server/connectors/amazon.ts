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
  // the Listings Items endpoints.
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  docsUrl: "https://developer-docs.amazon.com/sp-api/",
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

/** LWA access tokens live ~1h; exchanged per run rather than cached to disk. */
async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { client_id, client_secret, refresh_token } = ctx.credentials;
  if (!client_id || !client_secret || !refresh_token) {
    throw new ConnectorError(
      "missing Amazon client_id/client_secret/refresh_token",
      "AUTHENTICATION",
    );
  }
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
  const body = (await res.json()) as { access_token: string };
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

    if (body?.status === "INVALID") {
      throw new ConnectorError(
        `Amazon rejected the listing: ${(body.issues ?? []).map((i: any) => i.message).join("; ")}`,
        "VALIDATION",
        { details: body.issues },
      );
    }
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
    await call(
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
    await call(
      ctx,
      `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(u.sku)}?marketplaceIds=${m.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
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
  },

  async updatePrice(ctx, u: PriceUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updatePrice");
      ctx.log(`mock: Amazon price ${u.sku} -> ${money(u.priceCents)}`);
      return;
    }
    const m = marketplace(ctx);
    await call(
      ctx,
      `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(u.sku)}?marketplaceIds=${m.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
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
    const body = await call(
      ctx,
      `/orders/v0/orders?MarketplaceIds=${m.id}&CreatedAfter=${encodeURIComponent(since.toISOString())}&MaxResultsPerPage=50`,
    );
    const orders = body?.payload?.Orders ?? [];

    const out: RemoteOrder[] = [];
    for (const o of orders) {
      // Line items are a separate call per order; SP-API has no expand.
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
      } catch {
        // A throttled line-item fetch should not lose the order header.
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
