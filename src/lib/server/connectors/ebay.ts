/**
 * eBay connector (Sell Inventory + Fulfillment APIs).
 *
 * eBay splits publishing into three steps: an inventory item keyed by SKU, an
 * offer that prices it for one marketplace, and a publish call that turns the
 * offer into a live listing. The connector hides that from the core -- the sync
 * engine only ever asks for "create product".
 *
 * Docs: https://developer.ebay.com/api-docs/sell/inventory/overview.html
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

const manifest: Manifest = {
  name: "ebay",
  group: "Global",
  status: "ready",
  idPrefix: "EBAY",
  displayName: "eBay",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2",
    fields: [
      { key: "client_id", label: "App ID (Client ID)", secret: false },
      { key: "client_secret", label: "Cert ID (Client Secret)", secret: true },
      { key: "refresh_token", label: "User Refresh Token", secret: true },
    ],
  },
  regions: ["US", "GB", "DE", "AU", "CA", "IN"],
  capabilities: {
    createProduct: true,
    updateProduct: true,
    deleteProduct: true,
    inventorySync: true,
    priceSync: true,
    orderImport: true,
    orderUpdate: true,
    webhooks: true,
    bulkOperations: true,
    variants: true,
  },
  requiredFields: [
    { path: "title", label: "Listing title", required: true, help: "80 characters max" },
    { path: "description", label: "Description", required: true },
    { path: "images", label: "At least one image", required: true },
    {
      path: "attributes.ebay_category_id",
      label: "eBay category ID",
      required: true,
      help: "Numeric leaf category from the eBay taxonomy",
    },
    {
      path: "attributes.condition",
      label: "Item condition",
      required: true,
      enum: ["NEW", "LIKE_NEW", "USED_EXCELLENT", "USED_GOOD", "USED_ACCEPTABLE"],
    },
    {
      path: "attributes.ebay_fulfillment_policy_id",
      label: "Fulfillment policy ID",
      required: true,
      help: "From Seller Hub > Business policies",
    },
    { path: "attributes.ebay_payment_policy_id", label: "Payment policy ID", required: true },
    { path: "attributes.ebay_return_policy_id", label: "Return policy ID", required: true },
    {
      path: "attributes.ebay_merchant_location_key",
      label: "Merchant location key",
      required: true,
    },
  ],
  rateLimits: { requestsPerSecond: 8, burst: 20 },
  docsUrl: "https://developer.ebay.com/api-docs/sell/inventory/overview.html",
  sellerPortalUrl: "https://www.ebay.com/sh/ord",
  orderUrlTemplate: "https://www.ebay.com/sh/ord/details?orderid={id}",
};

const base = (ctx: ConnectorContext) =>
  ctx.config.sandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

const marketplaceId = (ctx: ConnectorContext) => ctx.config.marketplace_id ?? "EBAY_US";

/**
 * Access tokens, cached for their stated lifetime.
 *
 * eBay user tokens last around two hours, and every call here needs one.
 * Exchanging per call turned a single product publish — inventory item, offer,
 * publish — into six requests, three of them against the token endpoint, which
 * carries a much tighter limit than the Sell APIs do. The first seller with a
 * few hundred SKUs would have been rate-limited out of their own catalogue.
 *
 * Keyed by a hash of the refresh token, never the token itself: this map is
 * process-wide and a credential should not be sitting in a key that any future
 * debug dump of it would print.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Renew a minute early, so a token cannot expire mid-flight on a slow call. */
const TOKEN_MARGIN_MS = 60_000;

async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { client_id, client_secret, refresh_token } = ctx.credentials;
  if (!client_id || !client_secret || !refresh_token) {
    throw new ConnectorError("missing eBay client_id/client_secret/refresh_token", "AUTHENTICATION");
  }

  // The environment is part of the identity: the same refresh token is not
  // valid across sandbox and production.
  const cacheKey = createHash("sha256")
    .update(`${base(ctx)}|${client_id}|${refresh_token}`)
    .digest("hex");

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const basic = Buffer.from(`${client_id}:${client_secret}`).toString("base64");
  const res = await fetch(`${base(ctx)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      scope: "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    }),
  });
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const body = (await res.json()) as { access_token: string; expires_in?: number };
  // expires_in is seconds and is always sent, but a missing value defaulting to
  // zero would mean re-fetching on every call — the bug this cache exists to
  // fix — so fall back to eBay's documented two hours.
  const lifetimeMs = (body.expires_in ?? 7200) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - TOKEN_MARGIN_MS),
  });

  return body.access_token;
}

async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const token = await accessToken(ctx);
  const res = await fetch(`${base(ctx)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": ctx.config.content_language ?? "en-US",
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId(ctx),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429) {
    throw new ConnectorError("eBay rate limit", "RATE_LIMITED", { retryAfterMs: 60_000 });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const ebay: MarketplaceConnector = {
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

  async createProduct(ctx, p: CanonicalProduct): Promise<RemoteProduct> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "createProduct");
      const remoteId = mockRemoteId("EBAY", p.sku);
      ctx.log(`mock: published eBay listing ${remoteId} for ${p.sku}`);
      return { remoteId, url: `https://www.ebay.com/itm/${remoteId}` };
    }

    const a = p.attributes as any;
    const v = p.variants[0];

    // 1. inventory item (keyed by SKU -- naturally idempotent, PUT is a replace)
    await call(ctx, `/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`, {
      method: "PUT",
      body: JSON.stringify({
        availability: { shipToLocationAvailability: { quantity: v?.available ?? 0 } },
        condition: a.condition ?? "NEW",
        product: {
          title: p.title.slice(0, 80),
          description: p.description,
          brand: p.brand,
          imageUrls: p.images.map((i) => i.url),
          aspects: Object.fromEntries(
            Object.entries(p.attributes).map(([k, val]) => [k, [String(val)]]),
          ),
        },
        packageWeightAndSize: {
          weight: { value: p.weightG, unit: "GRAM" },
          dimensions:
            p.lengthMm > 0
              ? { length: p.lengthMm, width: p.widthMm, height: p.heightMm, unit: "MILLIMETER" }
              : undefined,
        },
      }),
    });

    // 2. offer
    const offer = await call(ctx, "/sell/inventory/v1/offer", {
      method: "POST",
      body: JSON.stringify({
        sku: p.sku,
        marketplaceId: marketplaceId(ctx),
        format: "FIXED_PRICE",
        availableQuantity: v?.available ?? 0,
        categoryId: a.ebay_category_id ? String(a.ebay_category_id) : undefined,
        listingDescription: p.description,
        listingPolicies: {
          fulfillmentPolicyId: a.ebay_fulfillment_policy_id,
          paymentPolicyId: a.ebay_payment_policy_id,
          returnPolicyId: a.ebay_return_policy_id,
        },
        pricingSummary: {
          price: { value: money(v?.priceCents ?? 0), currency: v?.currency ?? "USD" },
        },
        merchantLocationKey: a.ebay_merchant_location_key,
      }),
    });

    // 3. publish
    const published = await call(
      ctx,
      `/sell/inventory/v1/offer/${offer.offerId}/publish`,
      { method: "POST" },
    );

    return { remoteId: published?.listingId ?? offer.offerId, raw: { offer, published } };
  },

  async updateProduct(ctx, p, remoteId) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateProduct");
      ctx.log(`mock: updated eBay listing ${remoteId}`);
      return;
    }
    const v = p.variants[0];
    await call(ctx, `/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`, {
      method: "PUT",
      body: JSON.stringify({
        availability: { shipToLocationAvailability: { quantity: v?.available ?? 0 } },
        condition: (p.attributes as any).condition ?? "NEW",
        product: {
          title: p.title.slice(0, 80),
          description: p.description,
          brand: p.brand,
          imageUrls: p.images.map((i) => i.url),
        },
      }),
    });
  },

  async updateInventory(ctx, u: InventoryUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateInventory");
      ctx.log(`mock: eBay inventory ${u.sku} -> ${u.available}`);
      return;
    }
    await call(ctx, "/sell/inventory/v1/bulk_update_price_quantity", {
      method: "POST",
      body: JSON.stringify({
        requests: [{ sku: u.sku, shipToLocationAvailability: { quantity: u.available } }],
      }),
    });
  },

  async updatePrice(ctx, u: PriceUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updatePrice");
      ctx.log(`mock: eBay price ${u.sku} -> ${money(u.priceCents)}`);
      return;
    }
    await call(ctx, "/sell/inventory/v1/bulk_update_price_quantity", {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            sku: u.sku,
            offers: [
              {
                offerId: u.remoteId,
                price: { value: money(u.priceCents), currency: u.currency },
              },
            ],
          },
        ],
      }),
    });
  },

  async listOrders(ctx, since): Promise<RemoteOrder[]> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      const skus: string[] = ctx.config.mockOrderSkus ?? [];
      return skus.slice(0, 1).map((sku, i) => ({
        externalId: `EB-ORD-${mockRemoteId("", sku)}-${i}`,
        status: "NEW",
        currency: "USD",
        totalCents: 4999,
        placedAt: new Date().toISOString(),
        customer: { name: "Jordan Blake", email: "jordan@example.com", phone: "" },
        shippingAddress: {
          line1: "540 Market St",
          city: "San Francisco",
          state: "CA",
          postalCode: "94104",
          country: "US",
        },
        items: [
          { sku, title: "Mock eBay item", quantity: 1, priceCents: 4999, remoteItemId: `EBI-${i}` },
        ],
      }));
    }

    const filter = `creationdate:[${since.toISOString()}..]`;
    const body = await call(
      ctx,
      `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=50`,
    );
    return (body?.orders ?? []).map((o: any) => ({
      externalId: String(o.orderId),
      status: String(o.orderFulfillmentStatus ?? "NEW"),
      currency: o.pricingSummary?.total?.currency ?? "USD",
      totalCents: Math.round(Number(o.pricingSummary?.total?.value ?? 0) * 100),
      placedAt: o.creationDate ?? new Date().toISOString(),
      customer: {
        name: o.buyer?.username ?? "",
        email: o.buyer?.buyerRegistrationAddress?.email ?? "",
        phone: "",
      },
      shippingAddress: o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ?? {},
      items: (o.lineItems ?? []).map((li: any) => ({
        sku: li.sku ?? "",
        title: li.title ?? "",
        quantity: Number(li.quantity ?? 1),
        priceCents: Math.round(Number(li.lineItemCost?.value ?? 0) * 100),
        remoteItemId: String(li.lineItemId ?? ""),
      })),
    }));
  },
};
