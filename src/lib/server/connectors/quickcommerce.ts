/**
 * Quick-commerce connectors: Zepto, Swiggy Instamart, Blinkit.
 *
 * These three are grouped because they share a model that genuinely differs
 * from every other marketplace here:
 *
 *   A listing is stocked PER DARK STORE, not from one seller-wide pool.
 *   "500 units" is meaningless; what they want is "40 at BLR-KOR-01,
 *   35 at BLR-IND-02, …".
 *
 * The canonical model currently holds a single `available` per variant, so this
 * family bridges the gap with an explicit, visible allocation policy on the
 * channel rather than pretending the mismatch does not exist:
 *
 *   { "locations": ["BLR-KOR-01", "BLR-IND-02"], "allocation": "split" }
 *
 *   mirror (default) — push the full quantity to every dark store. Correct when
 *                      the stores draw on a shared backing warehouse.
 *   split            — divide evenly across stores, remainder to the first.
 *
 * Real per-location inventory needs an `inventory_locations` table and a
 * canonical model change; that is a scheduled milestone, not something to fake
 * here. Until then a channel with no `locations` configured behaves like any
 * other connector and pushes one number.
 *
 * ALL THREE APIs ARE PARTNER-GATED. The transports below follow the shape of
 * their published seller/partner documentation, but none can be verified
 * without an onboarded account. Mock mode is fully functional; treat live mode
 * as unverified and expect to correct field names in this one file.
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

interface QuickCommerceSpec {
  name: string;
  displayName: string;
  baseUrl: string;
  docsUrl: string;
  idPrefix: string;
  group?: string;
  status?: "ready" | "development";
  /** Header names differ per platform; everything else is shared. */
  authHeaders: (creds: Record<string, string>) => Record<string, string>;
  authFields: Manifest["authentication"];
  extraRequired?: FieldSpec[];
  rateLimits: Manifest["rateLimits"];
  mockCustomer: { name: string; phone: string; city: string; state: string; postalCode: string };
}

const SHARED_CAPABILITIES: Capabilities = {
  createProduct: true,
  updateProduct: true,
  deleteProduct: false,
  inventorySync: true,
  priceSync: true,
  orderImport: true,
  // Fulfilment is the platform's own rider network; sellers do not update it.
  orderUpdate: false,
  webhooks: false,
  bulkOperations: true,
  variants: false, // one SKU per listing; variants are separate catalogue rows
};

const SHARED_REQUIRED: FieldSpec[] = [
  { path: "title", label: "Product name", required: true },
  { path: "brand", label: "Brand", required: true },
  { path: "category", label: "Category", required: true },
  { path: "images", label: "At least one image", required: true },
  { path: "hsnCode", label: "HSN code", required: true, help: "Required for GST" },
  { path: "weightG", label: "Net weight (g)", required: true },
  {
    path: "attributes.gst_percentage",
    label: "GST %",
    required: true,
    enum: ["0", "3", "5", "12", "18", "28"],
  },
  {
    path: "attributes.shelf_life_days",
    label: "Shelf life (days)",
    required: true,
    help: "Quick commerce requires shelf life on every consumable listing",
  },
  {
    path: "attributes.mrp_declared",
    label: "Declared MRP",
    required: true,
    help: "Must match the printed MRP on the pack, per Legal Metrology rules",
  },
];

/**
 * Resolve one canonical stock number into per-dark-store quantities.
 * Exported because the self-test asserts the split arithmetic directly.
 */
export function allocateStock(
  available: number,
  locations: string[],
  strategy: string,
): Array<{ location: string; quantity: number }> {
  if (locations.length === 0) return [{ location: "", quantity: available }];

  if (strategy === "split") {
    const base = Math.floor(available / locations.length);
    const remainder = available % locations.length;
    return locations.map((location, i) => ({
      location,
      quantity: base + (i < remainder ? 1 : 0),
    }));
  }
  // mirror: every store sees the full quantity.
  return locations.map((location) => ({ location, quantity: available }));
}

function locationsOf(ctx: ConnectorContext): string[] {
  const raw = ctx.config.locations;
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter(Boolean);
}

function makeConnector(spec: QuickCommerceSpec): MarketplaceConnector {
  const manifest: Manifest = {
    name: spec.name,
    displayName: spec.displayName,
    version: "0.1.0",
    platformType: "marketplace",
    group: spec.group ?? "India — quick commerce",
    status: spec.status ?? "development",
    idPrefix: spec.idPrefix,
    authentication: spec.authFields,
    regions: ["IN"],
    capabilities: SHARED_CAPABILITIES,
    requiredFields: [...SHARED_REQUIRED, ...(spec.extraRequired ?? [])],
    rateLimits: spec.rateLimits,
    docsUrl: spec.docsUrl,
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

  function toListing(ctx: ConnectorContext, p: CanonicalProduct) {
    const a = p.attributes as any;
    const v = p.variants[0];
    return {
      seller_sku: p.sku,
      name: p.title,
      description: p.description,
      brand: p.brand,
      category: p.category,
      hsn_code: p.hsnCode,
      gst_percentage: Number(a.gst_percentage ?? p.taxRateBp / 100),
      shelf_life_days: Number(a.shelf_life_days ?? 0),
      net_weight_g: p.weightG,
      images: p.images.map((i) => i.url),
      mrp: money(v?.mrpCents ?? 0),
      selling_price: money(v?.priceCents ?? 0),
      attributes: p.attributes,
      inventory: allocateStock(
        v?.available ?? 0,
        locationsOf(ctx),
        String(ctx.config.allocation ?? "mirror"),
      ).map((s) => ({ store_code: s.location, quantity: s.quantity })),
    };
  }

  return {
    manifest: () => manifest,

    async health(ctx) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        const n = locationsOf(ctx).length;
        return {
          status: "HEALTHY",
          detail: n ? `mock mode, ${n} dark store(s)` : "mock mode, no locations configured",
        };
      }
      try {
        await call(ctx, "/v1/seller/profile");
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
        const stores = locationsOf(ctx).length;
        ctx.log(
          `mock: created ${spec.displayName} listing ${remoteId} for ${p.sku}` +
            (stores ? ` across ${stores} dark store(s)` : ""),
        );
        return { remoteId };
      }
      const body = await call(ctx, "/v1/catalog/products", {
        method: "POST",
        body: JSON.stringify(toListing(ctx, p)),
      });
      return { remoteId: String(body?.product_id ?? body?.id ?? p.sku), raw: body };
    },

    async updateProduct(ctx, p, remoteId) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updateProduct");
        ctx.log(`mock: updated ${spec.displayName} listing ${remoteId}`);
        return;
      }
      await call(ctx, `/v1/catalog/products/${encodeURIComponent(remoteId)}`, {
        method: "PUT",
        body: JSON.stringify(toListing(ctx, p)),
      });
    },

    async updateInventory(ctx, u: InventoryUpdate) {
      const allocation = allocateStock(
        u.available,
        locationsOf(ctx),
        String(ctx.config.allocation ?? "mirror"),
      );

      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updateInventory");
        const detail = allocation[0]?.location
          ? allocation.map((s) => `${s.location}:${s.quantity}`).join(" ")
          : String(u.available);
        ctx.log(`mock: ${spec.displayName} stock ${u.sku} -> ${detail}`);
        return;
      }
      await call(ctx, "/v1/inventory", {
        method: "POST",
        body: JSON.stringify({
          updates: allocation.map((s) => ({
            seller_sku: u.sku,
            store_code: s.location,
            quantity: s.quantity,
          })),
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
      const locations = locationsOf(ctx);
      await call(ctx, "/v1/prices", {
        method: "POST",
        body: JSON.stringify({
          updates: (locations.length ? locations : [""]).map((store_code) => ({
            seller_sku: u.sku,
            store_code,
            mrp: money(u.mrpCents),
            selling_price: money(u.priceCents),
          })),
        }),
      });
    },

    async listOrders(ctx, since): Promise<RemoteOrder[]> {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        const skus: string[] = ctx.config.mockOrderSkus ?? [];
        const store = locationsOf(ctx)[0] ?? "DS-01";
        return skus.slice(0, 1).map((sku, i) => ({
          externalId: `${spec.idPrefix}-ORD-${mockRemoteId("", sku)}-${i}`,
          status: "NEW",
          currency: "INR",
          totalCents: 24900,
          placedAt: new Date().toISOString(),
          customer: { name: spec.mockCustomer.name, email: "", phone: spec.mockCustomer.phone },
          shippingAddress: {
            line1: `Fulfilled from ${store}`,
            city: spec.mockCustomer.city,
            state: spec.mockCustomer.state,
            postalCode: spec.mockCustomer.postalCode,
            country: "IN",
          },
          items: [
            {
              sku,
              title: `Mock ${spec.displayName} item`,
              quantity: 2,
              priceCents: 12450,
              remoteItemId: `${spec.idPrefix}I-${i}`,
            },
          ],
        }));
      }

      const body = await call(
        ctx,
        `/v1/orders?from=${encodeURIComponent(since.toISOString())}&limit=50`,
      );
      return (body?.orders ?? []).map((o: any) => ({
        externalId: String(o.order_id ?? o.id),
        status: String(o.status ?? "NEW"),
        currency: "INR",
        totalCents: Math.round(Number(o.total_amount ?? 0) * 100),
        placedAt: o.created_at ?? new Date().toISOString(),
        customer: { name: o.customer_name ?? "", email: "", phone: o.customer_phone ?? "" },
        shippingAddress: { store_code: o.store_code ?? "", country: "IN" },
        items: (o.items ?? []).map((it: any) => ({
          sku: it.seller_sku ?? it.sku ?? "",
          title: it.name ?? "",
          quantity: Number(it.quantity ?? 1),
          priceCents: Math.round(Number(it.price ?? 0) * 100),
          remoteItemId: String(it.item_id ?? ""),
        })),
      }));
    },
  };
}

export const zepto = makeConnector({
  name: "zepto",
  displayName: "Zepto",
  baseUrl: "https://api.zepto.co.in/seller",
  docsUrl: "https://brands.zepto.co.in",
  idPrefix: "ZPT",
  authFields: {
    type: "api_key",
    fields: [
      { key: "seller_id", label: "Seller ID", secret: false },
      { key: "api_key", label: "API Key", secret: true },
    ],
  },
  authHeaders: (c) => ({ "X-Seller-Id": c.seller_id ?? "", Authorization: `Bearer ${c.api_key ?? ""}` }),
  rateLimits: { requestsPerSecond: 3, burst: 6 },
  mockCustomer: { name: "Aditi Nair", phone: "+91-9600000001", city: "Bengaluru", state: "Karnataka", postalCode: "560095" },
});

export const instamart = makeConnector({
  name: "instamart",
  displayName: "Swiggy Instamart",
  baseUrl: "https://partner.swiggy.com/instamart",
  docsUrl: "https://partner.swiggy.com",
  idPrefix: "SIM",
  authFields: {
    type: "oauth2_client_credentials",
    fields: [
      { key: "partner_id", label: "Partner ID", secret: false },
      { key: "client_id", label: "Client ID", secret: false },
      { key: "client_secret", label: "Client Secret", secret: true },
    ],
  },
  authHeaders: (c) => ({
    "X-Partner-Id": c.partner_id ?? "",
    Authorization: `Basic ${Buffer.from(`${c.client_id ?? ""}:${c.client_secret ?? ""}`).toString("base64")}`,
  }),
  extraRequired: [
    {
      path: "attributes.fssai_licence",
      label: "FSSAI licence number",
      required: true,
      help: "Mandatory for food and consumable listings on Swiggy",
    },
  ],
  rateLimits: { requestsPerSecond: 4, burst: 8 },
  mockCustomer: { name: "Karthik Iyer", phone: "+91-9600000002", city: "Hyderabad", state: "Telangana", postalCode: "500081" },
});

export const blinkit = makeConnector({
  name: "blinkit",
  displayName: "Blinkit",
  baseUrl: "https://api.blinkit.com/seller",
  docsUrl: "https://blinkit.com/partner",
  idPrefix: "BLK",
  authFields: {
    type: "api_key",
    fields: [
      { key: "vendor_id", label: "Vendor ID", secret: false },
      { key: "api_key", label: "API Key", secret: true },
      { key: "api_secret", label: "API Secret", secret: true },
    ],
  },
  authHeaders: (c) => ({
    "X-Vendor-Id": c.vendor_id ?? "",
    "X-Api-Key": c.api_key ?? "",
    "X-Api-Secret": c.api_secret ?? "",
  }),
  extraRequired: [
    {
      path: "attributes.fssai_licence",
      label: "FSSAI licence number",
      required: true,
      help: "Mandatory for food and consumable listings",
    },
  ],
  rateLimits: { requestsPerSecond: 3, burst: 6 },
  mockCustomer: { name: "Neha Gupta", phone: "+91-9600000003", city: "Gurugram", state: "Haryana", postalCode: "122002" },
});
