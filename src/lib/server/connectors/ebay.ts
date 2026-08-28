/**
 * eBay connector (Sell Inventory + Fulfillment APIs).
 *
 * eBay splits publishing into three steps: an inventory item keyed by SKU, an
 * offer that prices it for one marketplace, and a publish call that turns the
 * offer into a live listing. The connector hides that from the core -- the sync
 * engine only ever asks for "create product".
 *
 * The remote ID the core stores is the listingId that publish returns -- the
 * buyer-facing listing number. Offers live in a separate identifier space, so
 * anything that needs an offerId (price updates) resolves it by SKU at call
 * time instead of trusting a stored one.
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
      {
        key: "refresh_token",
        label: "User Refresh Token",
        secret: true,
        help: "Minted when the seller approves the consent flow — the Connect button does this, or see the setup guide for the manual exchange. It is not shown anywhere in the developer portal.",
      },
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
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/ebay.md",
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
    // eBay's binding limit is a per-API *daily* quota (about 5,000 calls/day
    // until the free Application Growth Check raises it), not a per-second
    // window. Against an exhausted daily quota a short retry re-fails for
    // hours, so honour Retry-After when eBay sends it and otherwise back off
    // fifteen minutes.
    const retryAfterS = Number(res.headers.get("retry-after"));
    const retryAfterMs =
      Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS * 1000 : 15 * 60_000;
    throw new ConnectorError("eBay rate limit", "RATE_LIMITED", { retryAfterMs });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Canonical millimetres to eBay centimetres, one decimal place. */
const cm = (mm: number) => Math.round(mm) / 10;

/**
 * The complete inventory-item record for a canonical product.
 *
 * createOrReplaceInventoryItem is a full replacement, not a patch: any field
 * absent from the PUT is erased from the eBay record. Create and update share
 * this one builder so an update can never silently strip the weight,
 * dimensions or item specifics that the create call set.
 */
function inventoryItemBody(p: CanonicalProduct) {
  const a = p.attributes as any;
  const v = p.variants[0];
  return {
    availability: { shipToLocationAvailability: { quantity: v?.available ?? 0 } },
    condition: a.condition ?? "NEW",
    product: {
      title: p.title.slice(0, 80),
      description: p.description,
      brand: p.brand,
      imageUrls: p.images.map((i) => i.url),
      // Aspects publish verbatim as buyer-facing item specifics. The canonical
      // attributes bag also carries connector plumbing — the ebay_*-prefixed
      // category/policy/location IDs and the condition enum — which is routing
      // data, not product data, so it stays off the live listing.
      aspects: Object.fromEntries(
        Object.entries(p.attributes)
          .filter(([k]) => !k.startsWith("ebay_") && k !== "condition")
          .map(([k, val]) => [k, [String(val)]]),
      ),
    },
    packageWeightAndSize: {
      weight: { value: p.weightG, unit: "GRAM" },
      // The dimension unit enum is FEET/INCH/METER/CENTIMETER — there is no
      // millimetre — so canonical mm is converted rather than passed through.
      dimensions:
        p.lengthMm > 0
          ? {
              length: cm(p.lengthMm),
              width: cm(p.widthMm),
              height: cm(p.heightMm),
              unit: "CENTIMETER",
            }
          : undefined,
    },
  };
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
      body: JSON.stringify(inventoryItemBody(p)),
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

    // The listingId is what the core stores; the offerId survives in raw for
    // debugging, and price updates re-resolve it by SKU rather than read it.
    return { remoteId: published?.listingId ?? offer.offerId, raw: { offer, published } };
  },

  async updateProduct(ctx, p, remoteId) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateProduct");
      ctx.log(`mock: updated eBay listing ${remoteId}`);
      return;
    }
    // The same full record as create: the PUT is a complete replacement, so a
    // trimmed "update" payload would erase whatever it omitted — weight,
    // dimensions, item specifics — from the live listing.
    await call(ctx, `/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`, {
      method: "PUT",
      body: JSON.stringify(inventoryItemBody(p)),
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
    /*
     * The stored remoteId is the listingId that publish returned, but
     * bulk_update_price_quantity addresses offers — a different identifier
     * space, so passing the listingId there targets nothing. The offer is
     * resolved by SKU at call time rather than persisted: getOffers is
     * authoritative, and a stored offerId would go stale the moment the offer
     * is deleted and re-created.
     */
    const found = await call(ctx, `/sell/inventory/v1/offer?sku=${encodeURIComponent(u.sku)}`);
    const offer = (found?.offers ?? []).find((o: any) => o.marketplaceId === marketplaceId(ctx));
    if (!offer?.offerId) {
      throw new ConnectorError(
        `no eBay offer exists for SKU ${u.sku} on ${marketplaceId(ctx)}`,
        "NOT_FOUND",
      );
    }
    await call(ctx, "/sell/inventory/v1/bulk_update_price_quantity", {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            sku: u.sku,
            offers: [
              {
                offerId: offer.offerId,
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

    /*
     * getOrders pages at up to 200 orders (the documented maximum; the default
     * is 50). The offset loop stops when the response carries no `next` link,
     * with a hard page cap so a bad watermark — a `since` pointing years back —
     * costs at most ten requests instead of crawling the account's entire
     * order history against a daily call quota.
     */
    const PAGE_SIZE = 200;
    const MAX_PAGES = 10;
    const orders: any[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await call(
        ctx,
        `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      );
      const batch = body?.orders ?? [];
      orders.push(...batch);
      if (batch.length === 0 || !body?.next) break;
    }

    return orders.map((o: any) => {
      // shipTo is an ExtendedContact: the postal fields sit nested under
      // contactAddress with eBay's own names, so they are mapped one by one
      // onto the flat canonical address rather than passed through.
      const ship = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
      const addr = ship?.contactAddress ?? {};
      return {
        externalId: String(o.orderId),
        status: String(o.orderFulfillmentStatus ?? "NEW"),
        currency: o.pricingSummary?.total?.currency ?? "USD",
        totalCents: Math.round(Number(o.pricingSummary?.total?.value ?? 0) * 100),
        placedAt: o.creationDate ?? new Date().toISOString(),
        customer: {
          // buyer.username is the eBay handle, not a person's name — prefer
          // the real names eBay sends before falling back to it.
          name:
            o.buyer?.buyerRegistrationAddress?.fullName ??
            ship?.fullName ??
            o.buyer?.username ??
            "",
          email: o.buyer?.buyerRegistrationAddress?.email ?? "",
          phone: ship?.primaryPhone?.phoneNumber ?? "",
        },
        shippingAddress: {
          line1: addr.addressLine1 ?? "",
          line2: addr.addressLine2 ?? "",
          city: addr.city ?? "",
          state: addr.stateOrProvince ?? "",
          postalCode: addr.postalCode ?? "",
          country: addr.countryCode ?? "",
        },
        items: (o.lineItems ?? []).map((li: any) => {
          const quantity = Number(li.quantity ?? 1);
          return {
            sku: li.sku ?? "",
            title: li.title ?? "",
            quantity,
            // lineItemCost is the line TOTAL (unit price x quantity); the
            // canonical item shape wants the per-unit price.
            priceCents:
              quantity > 0
                ? Math.round((Number(li.lineItemCost?.value ?? 0) * 100) / quantity)
                : 0,
            remoteItemId: String(li.lineItemId ?? ""),
          };
        }),
      };
    });
  },
};
