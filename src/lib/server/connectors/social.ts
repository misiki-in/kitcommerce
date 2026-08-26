/**
 * Social commerce connectors: Instagram, Facebook, TikTok.
 *
 * These are not marketplaces and the code should not pretend they are. Three
 * differences drive everything in this file:
 *
 * 1. Instagram and Facebook are two SURFACES OVER ONE CATALOGUE. Both read from
 *    the same Meta Product Catalog via the Graph API, so publishing to both is
 *    two channels writing the same catalog_id. They are separate connectors
 *    because a seller genuinely chooses them separately — and because their
 *    credentials, once scoped, can differ — but the transport is shared.
 *
 * 2. Native checkout is regional, so ORDERS MOSTLY DO NOT COME BACK. Meta
 *    checkout is US-only; everywhere else Instagram and Facebook shops send the
 *    buyer to your own site or to WhatsApp, and no order ever exists on Meta to
 *    import. Both therefore declare `orderImport: false`. Declaring it true and
 *    returning an empty list would be a lie the planner would faithfully act
 *    on, queueing an order-pull job forever.
 *
 * 3. TikTok Shop does not operate in India. TikTok has been banned there since
 *    2020, so `regions` omits IN entirely. It is the one channel here a seller
 *    in India cannot use, and the manifest is the right place to say so.
 *
 * All three are declared `status: "ready"`, which is what puts them in front of
 * a seller as something to connect rather than something being built. Meta's
 * Graph API and TikTok Shop's partner API are both documented publicly, so
 * these were written against a specification anyone can read rather than
 * against a portal nobody outside it can see.
 *
 * "Ready" covers the catalogue paths — publishing, price, availability. It does
 * not repeal the two limits above: Meta returns no orders outside its native
 * checkout, and TikTok Shop cannot be used from India at all. Both of those are
 * declared in the manifests and the planner obeys them.
 *
 * If a field name turns out to be wrong once real credentials are attached,
 * it is a correction in this one file. Mock mode is fully functional either
 * way and needs no account.
 */
import {
  ConnectorError,
  classifyStatus,
  money,
  type CanonicalProduct,
  type Capabilities,
  type ConnectorContext,
  type FieldSpec,
  type InventoryUpdate,
  type Manifest,
  type MarketplaceConnector,
  type PriceUpdate,
  type RemoteOrder,
  type RemoteProduct,
} from "../connector";
import { mockLatency, mockMaybeFail, mockRemoteId } from "./mock";

/**
 * What a catalogue needs to be shoppable in a feed.
 *
 * Shorter than any marketplace's list, and deliberately so: social catalogues
 * are merchandising surfaces, not compliance surfaces. There is no HSN code
 * here because Meta and TikTok do not ask for one — the tax fields on a
 * marketplace listing exist for the marketplace's invoicing, and these
 * platforms do not invoice on your behalf outside native checkout.
 */
const SOCIAL_REQUIRED: FieldSpec[] = [
  { path: "title", label: "Product name", required: true },
  { path: "description", label: "Description", required: true },
  { path: "brand", label: "Brand", required: true },
  {
    path: "images",
    label: "At least one image",
    required: true,
    help: "Feed placements crop to square; a centred subject survives it best",
  },
  {
    path: "attributes.condition",
    label: "Condition",
    required: true,
    // Canonical vocabulary, shared with every other connector. Meta's own
    // three values (new / refurbished / used) are translated in metaItem —
    // a platform's private enum never becomes the canonical one.
    enum: ["NEW", "LIKE_NEW", "USED_EXCELLENT", "USED_GOOD", "USED_ACCEPTABLE"],
  },
  {
    path: "attributes.landing_url",
    label: "Product landing page",
    required: true,
    help: "Where a tap goes. Required outside native checkout, which is most places",
  },
];

interface SocialSpec {
  name: string;
  displayName: string;
  baseUrl: string;
  docsUrl: string;
  sellerPortalUrl: string;
  idPrefix: string;
  group?: string;
  status?: "ready" | "development";
  regions: string[];
  capabilities: Partial<Capabilities>;
  authFields: Manifest["authentication"];
  authHeaders: (creds: Record<string, string>) => Record<string, string>;
  rateLimits: Manifest["rateLimits"];
  required?: FieldSpec[];
  /** Catalogue container the products are written into. */
  containerKey: string;
  paths: { profile: string; batch: string; orders?: string };
  /** Platform's own product payload shape. */
  toItem: (p: CanonicalProduct, variantIndex: number) => Record<string, unknown>;
  mockCustomer?: { name: string; city: string; state: string; postalCode: string; country: string };
  mockCurrency?: string;
  mockTotalCents?: number;
}

const BASE_CAPABILITIES: Capabilities = {
  createProduct: true,
  updateProduct: true,
  deleteProduct: true,
  inventorySync: true,
  priceSync: true,
  orderImport: false,
  orderUpdate: false,
  webhooks: false,
  bulkOperations: true,
  variants: true,
};

function makeSocialConnector(spec: SocialSpec): MarketplaceConnector {
  const manifest: Manifest = {
    name: spec.name,
    displayName: spec.displayName,
    version: "0.1.0",
    platformType: "social",
    group: spec.group ?? "Social",
    status: spec.status ?? "development",
    idPrefix: spec.idPrefix,
    authentication: spec.authFields,
    regions: spec.regions,
    capabilities: { ...BASE_CAPABILITIES, ...spec.capabilities },
    requiredFields: [...SOCIAL_REQUIRED, ...(spec.required ?? [])],
    rateLimits: spec.rateLimits,
    docsUrl: spec.docsUrl,
    sellerPortalUrl: spec.sellerPortalUrl,
  };

  async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
    const headers = spec.authHeaders(ctx.credentials);
    if (Object.values(headers).some((v) => !v)) {
      throw new ConnectorError(`missing ${spec.displayName} credentials`, "AUTHENTICATION");
    }
    const container = ctx.credentials[spec.containerKey];
    if (!container) {
      throw new ConnectorError(
        `missing ${spec.displayName} ${spec.containerKey}`,
        "AUTHENTICATION",
      );
    }

    const res = await fetch(`${spec.baseUrl}${path.replace("{container}", container)}`, {
      ...init,
      headers: { ...headers, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? 60);
      throw new ConnectorError(`${spec.displayName} rate limit`, "RATE_LIMITED", {
        retryAfterMs: ra * 1000,
      });
    }
    if (!res.ok) throw classifyStatus(res.status, await res.text());
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * One feed item per variant.
   *
   * Both platforms model a variant as its own retailer_id grouped by an item
   * group, rather than as a child row under a parent the way a marketplace
   * does. A single-variant product still gets a group so that adding a second
   * size later does not restructure the listing.
   */
  function toItems(p: CanonicalProduct): Record<string, unknown>[] {
    return p.variants.map((_, i) => spec.toItem(p, i));
  }

  return {
    manifest: () => manifest,

    async health(ctx) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        return { status: "HEALTHY", detail: "mock mode" };
      }
      try {
        await call(ctx, spec.paths.profile);
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
        const remoteId = mockRemoteId(spec.idPrefix, p.sku);
        ctx.log(
          `mock: published ${spec.displayName} catalogue item ${remoteId} for ${p.sku}` +
            (p.variants.length > 1 ? ` (${p.variants.length} variants)` : ""),
        );
        return { remoteId };
      }
      const body = await call(ctx, spec.paths.batch, {
        method: "POST",
        body: JSON.stringify({ requests: toItems(p).map((data) => ({ method: "CREATE", data })) }),
      });
      return {
        remoteId: String(body?.handles?.[0] ?? body?.data?.[0]?.id ?? p.sku),
        raw: body,
      };
    },

    async updateProduct(ctx, p, remoteId) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updateProduct");
        ctx.log(`mock: updated ${spec.displayName} catalogue item ${remoteId}`);
        return;
      }
      await call(ctx, spec.paths.batch, {
        method: "POST",
        body: JSON.stringify({ requests: toItems(p).map((data) => ({ method: "UPDATE", data })) }),
      });
    },

    async updateInventory(ctx, u: InventoryUpdate) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updateInventory");
        ctx.log(`mock: ${spec.displayName} availability ${u.sku} -> ${u.available}`);
        return;
      }
      /*
       * Availability is a word here, not a number. Both platforms hide an
       * out-of-stock item rather than showing "0 left", so the useful signal
       * is the threshold crossing; the count rides along for the platforms
       * that surface it.
       */
      await call(ctx, spec.paths.batch, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              method: "UPDATE",
              data: {
                retailer_id: u.sku,
                availability: u.available > 0 ? "in stock" : "out of stock",
                inventory: u.available,
              },
            },
          ],
        }),
      });
    },

    async updatePrice(ctx, u: PriceUpdate) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updatePrice");
        ctx.log(`mock: ${spec.displayName} price ${u.sku} -> ${money(u.priceCents)}`);
        return;
      }
      await call(ctx, spec.paths.batch, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              method: "UPDATE",
              data: {
                retailer_id: u.sku,
                price: money(u.priceCents),
                sale_price: u.priceCents < u.mrpCents ? money(u.priceCents) : undefined,
              },
            },
          ],
        }),
      });
    },

    async listOrders(ctx, since): Promise<RemoteOrder[]> {
      /*
       * Guarded rather than merely empty. A connector whose manifest says
       * orderImport:false should never be asked for orders — the planner
       * checks capabilities before queueing — so reaching here means something
       * upstream ignored the manifest, and failing loudly is better than
       * returning [] and letting it look like a shop with no sales.
       */
      if (!manifest.capabilities.orderImport) {
        throw new ConnectorError(
          `${spec.displayName} has no native checkout in the configured regions, so there are no orders to import`,
          "VALIDATION",
        );
      }

      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        const skus: string[] = ctx.config.mockOrderSkus ?? [];
        const c = spec.mockCustomer!;
        return skus.slice(0, 1).map((sku, i) => ({
          externalId: `${spec.idPrefix}-ORD-${mockRemoteId("", sku)}-${i}`,
          status: "NEW",
          currency: spec.mockCurrency ?? "USD",
          totalCents: spec.mockTotalCents ?? 4999,
          placedAt: new Date().toISOString(),
          customer: { name: c.name, email: "", phone: "" },
          shippingAddress: {
            line1: "48 Commercial Street",
            city: c.city,
            state: c.state,
            postalCode: c.postalCode,
            country: c.country,
          },
          items: [
            {
              sku,
              title: `Mock ${spec.displayName} item`,
              quantity: 1,
              priceCents: spec.mockTotalCents ?? 4999,
              remoteItemId: `${spec.idPrefix}I-${i}`,
            },
          ],
        }));
      }

      const body = await call(
        ctx,
        `${spec.paths.orders}?since=${encodeURIComponent(since.toISOString())}&page_size=50`,
      );
      return (body?.orders ?? body?.data ?? []).map((o: any) => ({
        externalId: String(o.order_id ?? o.id),
        status: String(o.order_status ?? o.status ?? "NEW"),
        currency: String(o.currency ?? spec.mockCurrency ?? "USD"),
        totalCents: Math.round(Number(o.payment?.total_amount ?? o.total ?? 0) * 100),
        placedAt: o.create_time ?? o.created_at ?? new Date().toISOString(),
        customer: {
          name: o.recipient_address?.name ?? o.buyer_name ?? "",
          email: o.buyer_email ?? "",
          phone: o.recipient_address?.phone ?? "",
        },
        shippingAddress: o.recipient_address ?? o.shipping_address ?? {},
        items: (o.line_items ?? o.items ?? []).map((it: any) => ({
          sku: it.seller_sku ?? it.retailer_id ?? it.sku ?? "",
          title: it.product_name ?? it.name ?? "",
          quantity: Number(it.quantity ?? 1),
          priceCents: Math.round(Number(it.sale_price ?? it.price ?? 0) * 100),
          remoteItemId: String(it.line_item_id ?? it.id ?? ""),
        })),
      }));
    },
  };
}

// ------------------------------------------------------------------ Meta

/**
 * Meta's Graph API, shared by Instagram and Facebook.
 *
 * The catalogue is the product, the surface is a setting. Both connectors point
 * at `/{catalog_id}/items_batch` with the same payload shape; what differs is
 * which surface the seller has connected the catalogue to, which is done in
 * Commerce Manager rather than over the API.
 */
const META_GRAPH = "https://graph.facebook.com/v21.0";

const metaAuth: Manifest["authentication"] = {
  type: "oauth2_access_token",
  fields: [
    { key: "catalog_id", label: "Catalog ID", secret: false },
    { key: "business_id", label: "Business ID", secret: false },
    { key: "access_token", label: "System User Access Token", secret: true },
  ],
};

const metaHeaders = (c: Record<string, string>) => ({
  Authorization: `Bearer ${c.access_token ?? ""}`,
});

/**
 * Canonical condition -> Meta's three-value enum.
 *
 * Meta has no grade scale, so every used grade collapses to "used". That is a
 * real loss of information and the right place for it to happen is here, at
 * the boundary, rather than by weakening what the canonical model can express.
 */
const metaCondition = (canonical: string): string =>
  canonical === "NEW" ? "new" : canonical === "REFURBISHED" ? "refurbished" : "used";

/** One feed row per variant, grouped under the product's SKU. */
const metaItem = (p: CanonicalProduct, i: number) => {
  const v = p.variants[i]!;
  const a = p.attributes as any;
  return {
    retailer_id: v.sku,
    item_group_id: p.sku,
    name: p.title,
    description: p.description,
    brand: p.brand,
    category: p.category,
    condition: metaCondition(String(a.condition ?? "NEW")),
    availability: v.available > 0 ? "in stock" : "out of stock",
    inventory: v.available,
    price: money(v.mrpCents),
    sale_price: v.priceCents < v.mrpCents ? money(v.priceCents) : undefined,
    currency: "INR",
    url: a.landing_url ?? "",
    image_url: p.images[0]?.url ?? "",
    additional_image_urls: p.images.slice(1, 10).map((im) => im.url),
    ...Object.fromEntries(Object.entries(v.options ?? {}).map(([k, val]) => [k, val])),
  };
};

export const instagram = makeSocialConnector({
  name: "instagram",
  displayName: "Instagram",
  baseUrl: META_GRAPH,
  docsUrl: "https://developers.facebook.com/docs/commerce-platform",
  sellerPortalUrl: "https://business.facebook.com/commerce",
  idPrefix: "IGS",
  status: "ready",
  // Product tagging works broadly; native checkout does not. See the header.
  regions: ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "BR"],
  capabilities: { orderImport: false },
  authFields: metaAuth,
  authHeaders: metaHeaders,
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  containerKey: "catalog_id",
  paths: { profile: "/{container}", batch: "/{container}/items_batch" },
  required: [
    {
      path: "attributes.instagram_shopping_enabled",
      label: "Shopping enabled on the account",
      required: true,
      help: "The Instagram account must be approved for Shopping before tags appear",
    },
  ],
  toItem: metaItem,
});

export const facebook = makeSocialConnector({
  name: "facebook",
  displayName: "Facebook",
  baseUrl: META_GRAPH,
  docsUrl: "https://developers.facebook.com/docs/commerce-platform",
  sellerPortalUrl: "https://business.facebook.com/commerce",
  idPrefix: "FBS",
  status: "ready",
  regions: ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "BR"],
  capabilities: { orderImport: false },
  authFields: metaAuth,
  authHeaders: metaHeaders,
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  containerKey: "catalog_id",
  paths: { profile: "/{container}", batch: "/{container}/items_batch" },
  toItem: metaItem,
});

// ---------------------------------------------------------------- TikTok

/**
 * TikTok Shop.
 *
 * Unlike Meta this is a full commerce platform with its own checkout and its
 * own orders, so it is the one connector here that sets orderImport: true.
 * It is also the one a seller in India cannot use at all — TikTok has been
 * banned there since 2020, which is why IN is absent from `regions` and why
 * this connector is not counted among the India-first ones.
 */
export const tiktok = makeSocialConnector({
  name: "tiktok",
  displayName: "TikTok Shop",
  baseUrl: "https://open-api.tiktokglobalshop.com",
  docsUrl: "https://partner.tiktokshop.com/docv2",
  sellerPortalUrl: "https://seller.tiktokglobalshop.com",
  idPrefix: "TTS",
  status: "ready",
  regions: ["US", "GB", "ID", "MY", "TH", "VN", "PH", "SG"],
  capabilities: { orderImport: true, deleteProduct: true },
  authFields: {
    type: "oauth2_authorization_code",
    fields: [
      { key: "shop_id", label: "Shop ID", secret: false },
      { key: "app_key", label: "App Key", secret: false },
      { key: "access_token", label: "Access Token", secret: true },
      { key: "app_secret", label: "App Secret", secret: true },
    ],
  },
  authHeaders: (c) => ({
    "x-tts-access-token": c.access_token ?? "",
    "x-tts-app-key": c.app_key ?? "",
  }),
  rateLimits: { requestsPerSecond: 10, burst: 20 },
  containerKey: "shop_id",
  paths: {
    profile: "/authorization/202309/shops",
    batch: "/product/202309/products",
    orders: "/order/202309/orders/search",
  },
  required: [
    {
      path: "attributes.tiktok_category_id",
      label: "TikTok category ID",
      required: true,
      help: "TikTok's own taxonomy leaf; product creation rejects a free-text category",
    },
    {
      path: "attributes.package_weight_g",
      label: "Package weight (g)",
      required: true,
      help: "Required to quote shipping at checkout",
    },
  ],
  mockCustomer: {
    name: "Jordan Ellis",
    city: "Manchester",
    state: "",
    postalCode: "M1 2AB",
    country: "GB",
  },
  mockCurrency: "GBP",
  mockTotalCents: 3499,
  toItem: (p, i) => {
    const v = p.variants[i]!;
    const a = p.attributes as any;
    return {
      product_name: p.title,
      description: p.description,
      category_id: a.tiktok_category_id ?? "",
      brand_name: p.brand,
      main_images: p.images.slice(0, 9).map((im) => ({ uri: im.url })),
      package_weight: { value: String(a.package_weight_g ?? p.weightG ?? 0), unit: "GRAM" },
      skus: [
        {
          seller_sku: v.sku,
          sales_attributes: Object.entries(v.options ?? {}).map(([name, value]) => ({
            name,
            value_name: value,
          })),
          price: { amount: money(v.priceCents), currency: "GBP" },
          inventory: [{ warehouse_id: a.tiktok_warehouse_id ?? "", quantity: v.available }],
        },
      ],
    };
  },
});
