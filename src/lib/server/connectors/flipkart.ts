/**
 * Flipkart Seller API connector.
 *
 * Live endpoints follow the Flipkart Seller API v3 shape. Verify the listing
 * payload against your seller account's vertical/category schema before
 * flipping a channel to live -- Flipkart's required attributes vary per
 * vertical, which is exactly what `requiredFields` + mapping validation exist
 * to surface.
 *
 * Docs: https://seller.flipkart.com/api-docs/FMSAPI.html
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

const API = "https://api.flipkart.net";

const manifest: Manifest = {
  name: "flipkart",
  group: "India — horizontal",
  status: "ready",
  idPrefix: "FKS",
  displayName: "Flipkart",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2_client_credentials",
    fields: [
      { key: "client_id", label: "Application ID", secret: false },
      { key: "client_secret", label: "Application Secret", secret: true },
    ],
  },
  regions: ["IN"],
  capabilities: {
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
  requiredFields: [
    { path: "title", label: "Product title", required: true },
    { path: "brand", label: "Brand", required: true, help: "Must match a Flipkart-approved brand" },
    { path: "category", label: "Vertical / category", required: true },
    { path: "hsnCode", label: "HSN code", required: true, help: "Required for GST invoicing" },
    { path: "images", label: "At least one image", required: true },
    { path: "weightG", label: "Shipping weight (g)", required: true },
    {
      path: "attributes.country_of_origin",
      label: "Country of origin",
      required: true,
      help: "Mandatory under Indian labelling rules",
    },
  ],
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  docsUrl: "https://seller.flipkart.com/api-docs/FMSAPI.html",
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
 * Keyed by a hash of the secret, never the secret itself.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Renew a minute early, so a token cannot expire mid-flight on a slow call. */
const TOKEN_MARGIN_MS = 60_000;

async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { client_id, client_secret } = ctx.credentials;
  if (!client_id || !client_secret) {
    throw new ConnectorError("missing Flipkart client_id/client_secret", "AUTHENTICATION");
  }

  const cacheKey = createHash("sha256").update(`${client_id}|${client_secret}`).digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const basic = Buffer.from(`${client_id}:${client_secret}`).toString("base64");
  const res = await fetch(
    `${API}/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api`,
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
  const res = await fetch(`${API}${path}`, {
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

/** Canonical -> Flipkart listing payload. */
function toListing(ctx: ConnectorContext, p: CanonicalProduct) {
  const v = p.variants[0];
  return {
    sku_id: p.sku,
    product: {
      brand: p.brand,
      vertical: p.category,
      title: p.title,
      description: p.description,
      hsn: p.hsnCode,
      country_of_origin: (p.attributes as any).country_of_origin ?? "IN",
      images: p.images.map((i) => i.url),
      attributes: p.attributes,
      shipping: {
        weight_in_grams: p.weightG,
        length_in_mm: p.lengthMm,
        breadth_in_mm: p.widthMm,
        height_in_mm: p.heightMm,
      },
    },
    listing: {
      mrp: money(v?.mrpCents ?? 0),
      selling_price: money(v?.priceCents ?? 0),
      inventory: v?.available ?? 0,
      currency: v?.currency ?? ctx.seller.currency,
      tax_rate_bp: p.taxRateBp,
    },
  };
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
    const body = await call(ctx, "/sellers/listings/v3/create", {
      method: "POST",
      body: JSON.stringify({ listings: [toListing(ctx, p)] }),
    });
    const remoteId = body?.listings?.[0]?.fsn ?? body?.listings?.[0]?.sku_id ?? p.sku;
    return { remoteId, raw: body };
  },

  async updateProduct(ctx, p, remoteId) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateProduct");
      ctx.log(`mock: updated Flipkart listing ${remoteId}`);
      return;
    }
    await call(ctx, "/sellers/listings/v3/update", {
      method: "POST",
      body: JSON.stringify({ listings: [toListing(ctx, p)] }),
    });
  },

  async updateInventory(ctx, u: InventoryUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateInventory");
      ctx.log(`mock: Flipkart inventory ${u.sku} -> ${u.available}`);
      return;
    }
    await call(ctx, "/sellers/listings/v3/update", {
      method: "POST",
      body: JSON.stringify({
        listings: [{ sku_id: u.sku, listing: { inventory: u.available } }],
      }),
    });
  },

  async updatePrice(ctx, u: PriceUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updatePrice");
      ctx.log(`mock: Flipkart price ${u.sku} -> ${money(u.priceCents)}`);
      return;
    }
    await call(ctx, "/sellers/listings/v3/update", {
      method: "POST",
      body: JSON.stringify({
        listings: [
          {
            sku_id: u.sku,
            listing: { mrp: money(u.mrpCents), selling_price: money(u.priceCents) },
          },
        ],
      }),
    });
  },

  async listOrders(ctx, since): Promise<RemoteOrder[]> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return mockOrders(ctx, since);
    }
    const body = await call(ctx, "/sellers/v3/orders/search", {
      method: "POST",
      body: JSON.stringify({
        filter: { states: ["APPROVED", "PACKING_IN_PROGRESS"], orderDate: { from: since.toISOString() } },
        pagination: { pageSize: 50 },
      }),
    });
    return (body?.orderItems ?? []).map((o: any) => ({
      externalId: String(o.orderId),
      status: String(o.status ?? "NEW"),
      currency: "INR",
      totalCents: Math.round(Number(o.priceComponents?.sellingPrice ?? 0) * 100),
      placedAt: o.orderDate ?? new Date().toISOString(),
      customer: { name: o.shippingAddress?.name ?? "", email: "", phone: o.shippingAddress?.phone ?? "" },
      shippingAddress: o.shippingAddress ?? {},
      items: [
        {
          sku: o.sku ?? "",
          title: o.title ?? "",
          quantity: Number(o.quantity ?? 1),
          priceCents: Math.round(Number(o.priceComponents?.sellingPrice ?? 0) * 100),
          remoteItemId: String(o.orderItemId ?? ""),
        },
      ],
    }));
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
