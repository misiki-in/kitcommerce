/**
 * Etsy connector (Open API v3).
 *
 * Etsy requires every call to carry both the app's x-api-key and an OAuth2
 * bearer token, and listings are created as drafts before being activated.
 * Variants live in a separate inventory document keyed by listing ID.
 *
 * Docs: https://developers.etsy.com/documentation/reference
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

const API = "https://openapi.etsy.com/v3/application";

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
      { key: "access_token", label: "OAuth Access Token", secret: true },
      { key: "refresh_token", label: "OAuth Refresh Token", secret: true },
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
    webhooks: false, // Etsy has no seller webhooks; polling is the only path.
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
      // Etsy's own list. "vintage" is a category, not a value, and the recent
      // buckets are named for specific years — a wrong one here is rejected at
      // create time with a validation error the seller cannot act on.
      enum: [
        "made_to_order",
        "2020_2023",
        "2010_2019",
        "2004_2009",
        "2000_2003",
        "before_2004",
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
  sellerPortalUrl: "https://www.etsy.com/your/orders/sold",
};

const shopId = (ctx: ConnectorContext) => {
  const id = ctx.config.shop_id;
  if (!id) throw new ConnectorError("channel config is missing shop_id", "VALIDATION");
  return String(id);
};

function auth(ctx: ConnectorContext): { api_key: string; access_token: string } {
  const { api_key, access_token } = ctx.credentials;
  if (!api_key || !access_token) {
    throw new ConnectorError("missing Etsy api_key/access_token", "AUTHENTICATION");
  }
  return { api_key, access_token };
}

/** Shared response handling, so both encodings classify failures identically. */
async function parse(res: Response): Promise<any> {
  if (res.status === 429) {
    throw new ConnectorError("Etsy rate limit", "RATE_LIMITED", { retryAfterMs: 60_000 });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const { api_key, access_token } = auth(ctx);
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "x-api-key": api_key,
      Authorization: `Bearer ${access_token}`,
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
  const { api_key, access_token } = auth(ctx);

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
      "x-api-key": api_key,
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  return parse(res);
}

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

    /*
     * Always created as a draft.
     *
     * Etsy requires image_ids before a listing may be "active", and this
     * connector does not upload images yet — asking for active without them is
     * a guaranteed validation failure that reads like a bad payload. A draft
     * that the seller activates in Shop Manager is the honest outcome until
     * uploadListingImage is implemented.
     */
    if (ctx.config.publish_immediately) {
      ctx.log("etsy: created as draft — activating needs images, which this connector does not upload yet");
    }

    const listing = (await callForm(ctx, `/shops/${shopId(ctx)}/listings`, "POST", {
      quantity: v?.available ?? 0,
      title: p.title.slice(0, 140),
      description: p.description,
      price: money(v?.priceCents ?? 0),
      who_made: a.who_made ?? "i_did",
      when_made: a.when_made ?? "made_to_order",
      taxonomy_id: a.etsy_taxonomy_id,
      // Optional since January 2026. Omitted when the seller has not set one,
      // rather than sent empty.
      shipping_profile_id: a.etsy_shipping_profile_id,
      item_weight: p.weightG > 0 ? p.weightG : undefined,
      state: "draft",
    })) as { listing_id: number; url?: string };

    const listingId = String(listing.listing_id);

    // Variants become an inventory document on the created listing.
    if (p.variants.length > 1) {
      await call(ctx, `/listings/${listingId}/inventory`, {
        method: "PUT",
        body: JSON.stringify({
          products: p.variants.map((variant) => ({
            sku: variant.sku,
            property_values: Object.entries(variant.options).map(([name, value]) => ({
              property_name: name,
              values: [value],
            })),
            offerings: [
              {
                price: Number(money(variant.priceCents)),
                quantity: variant.available,
                is_enabled: true,
              },
            ],
          })),
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
    const products = (inv?.products ?? []).map((prod: any) => ({
      sku: prod.sku,
      property_values: prod.property_values ?? [],
      offerings: (prod.offerings ?? []).map((o: any) => ({
        price: Number(o.price?.amount ?? 0) / Number(o.price?.divisor ?? 100),
        quantity: prod.sku === u.sku ? u.available : o.quantity,
        is_enabled: o.is_enabled ?? true,
      })),
    }));
    await call(ctx, `/listings/${u.remoteId}/inventory`, {
      method: "PUT",
      body: JSON.stringify({ products }),
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
    const products = (inv?.products ?? []).map((prod: any) => ({
      sku: prod.sku,
      property_values: prod.property_values ?? [],
      offerings: (prod.offerings ?? []).map((o: any) => ({
        price: prod.sku === u.sku ? Number(money(u.priceCents)) : Number(o.price?.amount ?? 0) / Number(o.price?.divisor ?? 100),
        quantity: o.quantity,
        is_enabled: o.is_enabled ?? true,
      })),
    }));
    await call(ctx, `/listings/${u.remoteId}/inventory`, {
      method: "PUT",
      body: JSON.stringify({ products }),
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

    const minCreated = Math.floor(since.getTime() / 1000);
    const body = await call(
      ctx,
      `/shops/${shopId(ctx)}/receipts?min_created=${minCreated}&limit=50`,
    );
    return (body?.results ?? []).map((r: any) => ({
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
