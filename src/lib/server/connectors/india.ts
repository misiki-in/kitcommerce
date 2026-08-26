/**
 * Indian marketplace connectors: Myntra, Ajio, JioMart, Nykaa, Tata CLiQ,
 * Snapdeal.
 *
 * These six share a transport shape — a partner-gated JSON seller API with a
 * catalogue push, a stock endpoint, a price endpoint and an order pull — but
 * differ sharply in what they REQUIRE on a listing. Myntra will not accept
 * apparel without a size chart and article type; Nykaa wants shade and batch
 * data; JioMart wants pack size and a fulfilment model.
 *
 * So the transport is shared and the *manifest* is per-marketplace. That split
 * matters: `requiredFields` is what the planner validates against and what the
 * product form renders, so it is the part that must be honest per platform.
 *
 * NONE OF THESE APIs IS PUBLICLY DOCUMENTED. Each is gated behind a seller or
 * partner portal login. The transports follow the common shape their onboarding
 * documentation describes; expect to correct paths and field names in this one
 * file once you have real credentials. Mock mode is fully functional and needs
 * no account.
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

interface PortalSpec {
  name: string;
  displayName: string;
  baseUrl: string;
  docsUrl: string;
  idPrefix: string;
  group: string;
  status?: "ready" | "development";
  authFields: Manifest["authentication"];
  authHeaders: (creds: Record<string, string>) => Record<string, string>;
  capabilities?: Partial<Capabilities>;
  /** Marketplace-specific required fields, appended to the common set. */
  required: FieldSpec[];
  rateLimits: Manifest["rateLimits"];
  paths?: Partial<{ profile: string; create: string; update: string; inventory: string; price: string; orders: string }>;
  /** Extra platform-specific keys folded into the catalogue payload. */
  extend?: (p: CanonicalProduct, ctx: ConnectorContext) => Record<string, unknown>;
  mockCustomer: { name: string; city: string; state: string; postalCode: string };
  mockTotalCents: number;
}

const BASE_CAPABILITIES: Capabilities = {
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
};

/** Required by every Indian marketplace, for GST and Legal Metrology reasons. */
const COMMON_REQUIRED: FieldSpec[] = [
  { path: "title", label: "Product name", required: true },
  { path: "brand", label: "Brand", required: true },
  { path: "category", label: "Category", required: true },
  { path: "images", label: "At least one image", required: true },
  { path: "hsnCode", label: "HSN code", required: true, help: "Required for GST invoicing" },
  { path: "weightG", label: "Weight (g)", required: true },
  {
    path: "attributes.country_of_origin",
    label: "Country of origin",
    required: true,
    help: "Mandatory under Legal Metrology labelling rules",
  },
  {
    path: "attributes.gst_percentage",
    label: "GST %",
    required: true,
    enum: ["0", "3", "5", "12", "18", "28"],
  },
];

function makeConnector(spec: PortalSpec): MarketplaceConnector {
  const paths = {
    profile: "/v1/seller/profile",
    create: "/v1/catalog/products",
    update: "/v1/catalog/products",
    inventory: "/v1/inventory",
    price: "/v1/prices",
    orders: "/v1/orders",
    ...(spec.paths ?? {}),
  };

  const manifest: Manifest = {
    name: spec.name,
    displayName: spec.displayName,
    version: "0.1.0",
    platformType: "marketplace",
    group: spec.group,
    status: spec.status ?? "development",
    idPrefix: spec.idPrefix,
    authentication: spec.authFields,
    regions: ["IN"],
    capabilities: { ...BASE_CAPABILITIES, ...(spec.capabilities ?? {}) },
    requiredFields: [...COMMON_REQUIRED, ...spec.required],
    rateLimits: spec.rateLimits,
    docsUrl: spec.docsUrl,
    // These portals have no public order deep-link, so the portal home is
    // the honest destination.
    sellerPortalUrl: spec.docsUrl,
  };

  async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
    const headers = spec.authHeaders(ctx.credentials);
    if (Object.values(headers).some((v) => !v)) {
      throw new ConnectorError(`missing ${spec.displayName} credentials`, "AUTHENTICATION");
    }
    const res = await fetch(`${spec.baseUrl}${path}`, {
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

  function toCatalog(ctx: ConnectorContext, p: CanonicalProduct) {
    const a = p.attributes as any;
    return {
      seller_sku: p.sku,
      name: p.title,
      description: p.description,
      brand: p.brand,
      category: p.category,
      hsn_code: p.hsnCode,
      gst_percentage: Number(a.gst_percentage ?? p.taxRateBp / 100),
      country_of_origin: a.country_of_origin ?? "IN",
      images: p.images.map((i) => i.url),
      dimensions_mm: { length: p.lengthMm, width: p.widthMm, height: p.heightMm },
      weight_g: p.weightG,
      attributes: p.attributes,
      // Every one of these platforms models size/colour as separate sellable
      // rows under one style, which maps cleanly onto canonical variants.
      variants: p.variants.map((v) => ({
        seller_sku: v.sku,
        options: v.options,
        barcode: v.barcode,
        mrp: money(v.mrpCents),
        selling_price: money(v.priceCents),
        stock: v.available,
      })),
      ...(spec.extend?.(p, ctx) ?? {}),
    };
  }

  return {
    manifest: () => manifest,

    async health(ctx) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        return { status: "HEALTHY", detail: "mock mode" };
      }
      try {
        await call(ctx, paths.profile);
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
          `mock: created ${spec.displayName} listing ${remoteId} for ${p.sku}` +
            (p.variants.length > 1 ? ` with ${p.variants.length} variants` : ""),
        );
        return { remoteId };
      }
      const body = await call(ctx, paths.create, {
        method: "POST",
        body: JSON.stringify(toCatalog(ctx, p)),
      });
      return {
        remoteId: String(body?.style_id ?? body?.product_id ?? body?.id ?? p.sku),
        raw: body,
      };
    },

    async updateProduct(ctx, p, remoteId) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updateProduct");
        ctx.log(`mock: updated ${spec.displayName} listing ${remoteId}`);
        return;
      }
      await call(ctx, `${paths.update}/${encodeURIComponent(remoteId)}`, {
        method: "PUT",
        body: JSON.stringify(toCatalog(ctx, p)),
      });
    },

    async updateInventory(ctx, u: InventoryUpdate) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updateInventory");
        ctx.log(`mock: ${spec.displayName} stock ${u.sku} -> ${u.available}`);
        return;
      }
      await call(ctx, paths.inventory, {
        method: "POST",
        body: JSON.stringify({ updates: [{ seller_sku: u.sku, stock: u.available }] }),
      });
    },

    async updatePrice(ctx, u: PriceUpdate) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updatePrice");
        ctx.log(`mock: ${spec.displayName} price ${u.sku} -> ${money(u.priceCents)}`);
        return;
      }
      await call(ctx, paths.price, {
        method: "POST",
        body: JSON.stringify({
          updates: [
            { seller_sku: u.sku, mrp: money(u.mrpCents), selling_price: money(u.priceCents) },
          ],
        }),
      });
    },

    async listOrders(ctx, since): Promise<RemoteOrder[]> {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        const skus: string[] = ctx.config.mockOrderSkus ?? [];
        return skus.slice(0, 1).map((sku, i) => ({
          externalId: `${spec.idPrefix}-ORD-${mockRemoteId("", sku)}-${i}`,
          status: "NEW",
          currency: "INR",
          totalCents: spec.mockTotalCents,
          placedAt: new Date().toISOString(),
          customer: { name: spec.mockCustomer.name, email: "", phone: "+91-9500000000" },
          shippingAddress: {
            line1: "221 Linking Road",
            city: spec.mockCustomer.city,
            state: spec.mockCustomer.state,
            postalCode: spec.mockCustomer.postalCode,
            country: "IN",
          },
          items: [
            {
              sku,
              title: `Mock ${spec.displayName} item`,
              quantity: 1,
              priceCents: spec.mockTotalCents,
              remoteItemId: `${spec.idPrefix}I-${i}`,
            },
          ],
        }));
      }

      const body = await call(
        ctx,
        `${paths.orders}?from=${encodeURIComponent(since.toISOString())}&limit=50`,
      );
      return (body?.orders ?? body?.data ?? []).map((o: any) => ({
        externalId: String(o.order_id ?? o.id),
        status: String(o.status ?? "NEW"),
        currency: "INR",
        totalCents: Math.round(Number(o.total_amount ?? o.total ?? 0) * 100),
        placedAt: o.created_at ?? o.order_date ?? new Date().toISOString(),
        customer: {
          name: o.customer_name ?? o.buyer_name ?? "",
          email: o.customer_email ?? "",
          phone: o.customer_phone ?? "",
        },
        shippingAddress: o.shipping_address ?? o.delivery_address ?? {},
        items: (o.items ?? o.line_items ?? []).map((it: any) => ({
          sku: it.seller_sku ?? it.sku ?? "",
          title: it.name ?? it.product_name ?? "",
          quantity: Number(it.quantity ?? 1),
          priceCents: Math.round(Number(it.price ?? 0) * 100),
          remoteItemId: String(it.item_id ?? it.line_id ?? ""),
        })),
      }));
    },
  };
}

// --------------------------------------------------------------- marketplaces

export const myntra = makeConnector({
  name: "myntra",
  displayName: "Myntra",
  baseUrl: "https://api.myntra.com/ppmp",
  docsUrl: "https://partners.myntra.com",
  idPrefix: "MYN",
  group: "India — fashion & beauty",
  authFields: {
    type: "oauth2_client_credentials",
    fields: [
      { key: "seller_id", label: "Seller ID", secret: false },
      { key: "client_id", label: "Client ID", secret: false },
      { key: "client_secret", label: "Client Secret", secret: true },
    ],
  },
  authHeaders: (c) => ({
    "X-Seller-Id": c.seller_id ?? "",
    Authorization: `Basic ${Buffer.from(`${c.client_id ?? ""}:${c.client_secret ?? ""}`).toString("base64")}`,
  }),
  required: [
    {
      path: "attributes.article_type",
      label: "Article type",
      required: true,
      help: "Myntra's apparel taxonomy leaf, e.g. Tshirts, Kurtas, Heels",
    },
    {
      path: "attributes.gender",
      label: "Gender",
      required: true,
      enum: ["men", "women", "boys", "girls", "unisex"],
    },
    {
      path: "attributes.size_chart_id",
      label: "Size chart ID",
      required: true,
      help: "Apparel and footwear cannot go live without a mapped size chart",
    },
    { path: "attributes.fabric", label: "Fabric / material", required: true },
    {
      path: "attributes.wash_care",
      label: "Wash care",
      required: true,
      help: "Required on all apparel listings",
    },
  ],
  rateLimits: { requestsPerSecond: 4, burst: 8 },
  paths: { create: "/v1/styles", update: "/v1/styles" },
  extend: (p) => ({
    style_code: p.sku,
    article_type: (p.attributes as any).article_type,
    gender: (p.attributes as any).gender,
    size_chart_id: (p.attributes as any).size_chart_id,
  }),
  mockCustomer: { name: "Sneha Kulkarni", city: "Pune", state: "Maharashtra", postalCode: "411001" },
  mockTotalCents: 189900,
});

export const ajio = makeConnector({
  name: "ajio",
  displayName: "AJIO",
  baseUrl: "https://api.ajio.com/seller",
  docsUrl: "https://seller.ajio.com",
  idPrefix: "AJO",
  group: "India — fashion & beauty",
  authFields: {
    type: "api_key",
    fields: [
      { key: "vendor_code", label: "Vendor Code", secret: false },
      { key: "api_key", label: "API Key", secret: true },
      { key: "api_secret", label: "API Secret", secret: true },
    ],
  },
  authHeaders: (c) => ({
    "X-Vendor-Code": c.vendor_code ?? "",
    "X-Api-Key": c.api_key ?? "",
    "X-Api-Secret": c.api_secret ?? "",
  }),
  required: [
    {
      path: "attributes.article_type",
      label: "Article type",
      required: true,
      help: "AJIO category leaf",
    },
    {
      path: "attributes.gender",
      label: "Gender",
      required: true,
      enum: ["men", "women", "kids", "unisex"],
    },
    { path: "attributes.colour_family", label: "Colour family", required: true },
    { path: "attributes.fabric", label: "Fabric / material", required: true },
  ],
  rateLimits: { requestsPerSecond: 3, burst: 6 },
  mockCustomer: { name: "Rohan Desai", city: "Ahmedabad", state: "Gujarat", postalCode: "380009" },
  mockTotalCents: 149900,
});

export const jiomart = makeConnector({
  name: "jiomart",
  displayName: "JioMart",
  baseUrl: "https://api.jiomart.com/seller",
  docsUrl: "https://seller.jiomart.com",
  idPrefix: "JIO",
  group: "India — horizontal",
  authFields: {
    type: "api_key",
    fields: [
      { key: "seller_id", label: "Seller ID", secret: false },
      { key: "api_key", label: "API Key", secret: true },
    ],
  },
  authHeaders: (c) => ({
    "X-Seller-Id": c.seller_id ?? "",
    Authorization: `Bearer ${c.api_key ?? ""}`,
  }),
  required: [
    {
      path: "attributes.pack_size",
      label: "Pack size",
      required: true,
      help: 'Net quantity as printed, e.g. "500 g", "1 L", "pack of 6"',
    },
    {
      path: "attributes.fulfilment_model",
      label: "Fulfilment model",
      required: true,
      enum: ["seller_fulfilled", "jio_fulfilled", "store_fulfilled"],
    },
    {
      path: "attributes.shelf_life_days",
      label: "Shelf life (days)",
      required: true,
      help: "Required for grocery and consumables",
    },
  ],
  rateLimits: { requestsPerSecond: 4, burst: 8 },
  mockCustomer: { name: "Meera Joshi", city: "Mumbai", state: "Maharashtra", postalCode: "400058" },
  mockTotalCents: 64900,
});

export const nykaa = makeConnector({
  name: "nykaa",
  displayName: "Nykaa",
  baseUrl: "https://api.nykaa.com/seller",
  docsUrl: "https://seller.nykaa.com",
  idPrefix: "NYK",
  group: "India — fashion & beauty",
  authFields: {
    type: "api_key",
    fields: [
      { key: "seller_code", label: "Seller Code", secret: false },
      { key: "api_key", label: "API Key", secret: true },
    ],
  },
  authHeaders: (c) => ({
    "X-Seller-Code": c.seller_code ?? "",
    Authorization: `Bearer ${c.api_key ?? ""}`,
  }),
  required: [
    {
      path: "attributes.shelf_life_days",
      label: "Shelf life (days)",
      required: true,
      help: "Beauty listings are rejected without a declared shelf life",
    },
    {
      path: "attributes.ingredients",
      label: "Ingredients",
      required: true,
      help: "Full INCI list, required for cosmetics",
    },
    {
      path: "attributes.is_cruelty_free",
      label: "Cruelty-free declaration",
      required: true,
      enum: ["yes", "no"],
    },
  ],
  rateLimits: { requestsPerSecond: 3, burst: 6 },
  mockCustomer: { name: "Ishita Rao", city: "Delhi", state: "Delhi", postalCode: "110016" },
  mockTotalCents: 89900,
});

export const tatacliq = makeConnector({
  name: "tatacliq",
  displayName: "Tata CLiQ",
  baseUrl: "https://api.tatacliq.com/seller",
  docsUrl: "https://seller.tatacliq.com",
  idPrefix: "TCQ",
  group: "India — horizontal",
  authFields: {
    type: "oauth2_client_credentials",
    fields: [
      { key: "seller_id", label: "Seller ID", secret: false },
      { key: "client_id", label: "Client ID", secret: false },
      { key: "client_secret", label: "Client Secret", secret: true },
    ],
  },
  authHeaders: (c) => ({
    "X-Seller-Id": c.seller_id ?? "",
    Authorization: `Basic ${Buffer.from(`${c.client_id ?? ""}:${c.client_secret ?? ""}`).toString("base64")}`,
  }),
  required: [
    { path: "attributes.brand_authorisation", label: "Brand authorisation ID", required: true,
      help: "Tata CLiQ verifies brand authorisation before a listing goes live" },
    { path: "attributes.warranty_months", label: "Warranty (months)", required: true },
  ],
  rateLimits: { requestsPerSecond: 4, burst: 8 },
  mockCustomer: { name: "Vikram Shetty", city: "Chennai", state: "Tamil Nadu", postalCode: "600028" },
  mockTotalCents: 249900,
});

export const snapdeal = makeConnector({
  name: "snapdeal",
  displayName: "Snapdeal",
  baseUrl: "https://api.snapdeal.com/seller",
  docsUrl: "https://seller.snapdeal.com",
  idPrefix: "SND",
  group: "India — horizontal",
  authFields: {
    type: "api_key",
    fields: [
      { key: "seller_code", label: "Seller Code", secret: false },
      { key: "api_key", label: "API Key", secret: true },
    ],
  },
  authHeaders: (c) => ({
    "X-Seller-Code": c.seller_code ?? "",
    Authorization: `Bearer ${c.api_key ?? ""}`,
  }),
  required: [
    { path: "attributes.warranty_months", label: "Warranty (months)", required: true },
  ],
  rateLimits: { requestsPerSecond: 3, burst: 6 },
  mockCustomer: { name: "Arjun Bhatia", city: "Jaipur", state: "Rajasthan", postalCode: "302001" },
  mockTotalCents: 74900,
});
