/**
 * Meesho supplier connector.
 *
 * NOTE: Meesho's supplier API is partner-gated — the API reference arrives by
 * email from meesholink-integration@meesho.com together with your
 * credentials, never publicly. What integrator guides do document, and what
 * this file follows, is the transport: production base
 * https://merchant.meesho.com (test: https://merchant.meeshotest.in), with
 * auth carried in the `merchant` / `security` / `timestamp` request headers
 * plus `supplier_identifier` for aggregators. The paths themselves remain a
 * sketch: Meesho's real surface is operation-named ("Get Shipment Order
 * Details"), not the generic /v1/... shape below, and multi-location
 * suppliers additionally receive a per-location refresh token this connector
 * does not yet model. Treat live mode as unverified until you have run it
 * against your own credentials — mock mode is fully functional in the
 * meantime.
 *
 * Docs: emailed by meesholink-integration@meesho.com with your credentials;
 * the Supplier Panel is https://supplier.meesho.com.
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

const manifest: Manifest = {
  name: "meesho",
  group: "India — horizontal",
  status: "development",
  idPrefix: "MSH",
  displayName: "Meesho",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "api_key",
    fields: [
      {
        key: "supplier_id",
        label: "Supplier / Merchant Identifier",
        secret: false,
        optional: true,
        help: "From your API onboarding email. Compulsory only for aggregators / multi-location accounts; sent as the supplier_identifier header when present.",
      },
      {
        key: "api_key",
        label: "Client ID",
        secret: true,
        help: "Also from the onboarding email. Field names vary slightly — match them to what Meesho sent.",
      },
      { key: "api_secret", label: "Secret key", secret: true, help: "The secret paired with the Client ID." },
    ],
  },
  /*
   * Meesho has no seller password to log in with — the Supplier Panel has been
   * OTP-only since 2023 — so this connects with the API credentials Meesho
   * issues to advanced sellers, not with account login details. Tools that ask
   * for a Meesho email and password are scraping the panel and relaying the
   * OTP, which is fragile and against Meesho's terms; this asks for the real
   * credentials instead. Those credentials come from Meesho's integration
   * team by email, not from any self-serve page in the panel.
   */
  credentialsNote:
    "Meesho login is OTP-only, so there is no password to enter. API credentials are issued by hand: email meesholink-integration@meesho.com from your registered Supplier Panel email — usually alongside your OMS partner — and paste the Client ID and Secret key from Meesho's reply here.",
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
    // Meesho models size/colour as separate catalogue entries rather than
    // variants of one parent, so the connector fans variants out on create.
    variants: true,
  },
  requiredFields: [
    { path: "title", label: "Product name", required: true },
    { path: "category", label: "Category", required: true },
    { path: "brand", label: "Brand", required: true },
    { path: "hsnCode", label: "HSN code", required: true, help: "Required for GST" },
    { path: "images", label: "At least one image", required: true, help: "Min 3 recommended" },
    { path: "weightG", label: "Weight (g)", required: true },
    {
      path: "attributes.gst_percentage",
      label: "GST %",
      required: true,
      enum: ["0", "3", "5", "12", "18", "28"],
    },
  ],
  rateLimits: { requestsPerSecond: 3, burst: 6 },
  docsUrl: "https://supplier.meesho.com",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/meesho.md",
  sellerPortalUrl: "https://supplier.meesho.com",
};

// Integrator guides agree on these hosts; refresh tokens and credentials are
// environment-specific, so a channel testing against meeshotest.in sets
// config.sandbox and uses the credentials Meesho issued for test.
const API = "https://merchant.meesho.com";
const API_TEST = "https://merchant.meeshotest.in";

async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const { api_key, api_secret, supplier_id } = ctx.credentials;
  if (!api_key || !api_secret) {
    throw new ConnectorError("missing Meesho api_key/api_secret", "AUTHENTICATION");
  }
  const base = ctx.config.sandbox ? API_TEST : API;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      // Documented header keys: `merchant` carries the Client-id, `security`
      // the Secret-key, plus a `timestamp`; `supplier_identifier` is
      // compulsory only for aggregators, so it is sent only when set.
      // Two things stay unverified until Meesho's onboarding email settles
      // them: whether `security` wants the raw secret or a timestamped
      // digest, and the timestamp format (epoch seconds until told
      // otherwise). Adjust here if either turns out different.
      merchant: api_key,
      security: api_secret,
      timestamp: String(Math.floor(Date.now() / 1000)),
      ...(supplier_id ? { supplier_identifier: supplier_id } : {}),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after") ?? 60);
    throw new ConnectorError("Meesho rate limit", "RATE_LIMITED", { retryAfterMs: ra * 1000 });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function toCatalog(ctx: ConnectorContext, p: CanonicalProduct) {
  return {
    supplier_id: ctx.credentials.supplier_id,
    product_name: p.title,
    description: p.description,
    brand: p.brand,
    category: p.category,
    hsn_code: p.hsnCode,
    gst_percentage: Number((p.attributes as any).gst_percentage ?? p.taxRateBp / 100),
    country_of_origin: (p.attributes as any).country_of_origin ?? "IN",
    images: p.images.map((i) => i.url),
    // Meesho wants one catalogue row per sellable combination.
    variations: p.variants.map((v) => ({
      sku: v.sku,
      options: v.options,
      mrp: money(v.mrpCents),
      price: money(v.priceCents),
      stock: v.available,
      weight_gm: v.weightG || p.weightG,
    })),
  };
}

export const meesho: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return { status: "HEALTHY", detail: "mock mode" };
    }
    try {
      await call(ctx, "/v1/supplier/profile");
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
      const remoteId = mockRemoteId("MSH", p.sku);
      ctx.log(`mock: created Meesho catalog ${remoteId} with ${p.variants.length} variation(s)`);
      return { remoteId, url: `https://www.meesho.com/mock/${remoteId}` };
    }
    const body = await call(ctx, "/v1/catalogs", {
      method: "POST",
      body: JSON.stringify(toCatalog(ctx, p)),
    });
    return { remoteId: String(body?.catalog_id ?? p.sku), raw: body };
  },

  async updateProduct(ctx, p, remoteId) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateProduct");
      ctx.log(`mock: updated Meesho catalog ${remoteId}`);
      return;
    }
    await call(ctx, `/v1/catalogs/${encodeURIComponent(remoteId)}`, {
      method: "PUT",
      body: JSON.stringify(toCatalog(ctx, p)),
    });
  },

  async updateInventory(ctx, u: InventoryUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateInventory");
      ctx.log(`mock: Meesho stock ${u.sku} -> ${u.available}`);
      return;
    }
    await call(ctx, "/v1/inventory", {
      method: "POST",
      body: JSON.stringify({ updates: [{ sku: u.sku, stock: u.available }] }),
    });
  },

  async updatePrice(ctx, u: PriceUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updatePrice");
      ctx.log(`mock: Meesho price ${u.sku} -> ${money(u.priceCents)}`);
      return;
    }
    await call(ctx, "/v1/prices", {
      method: "POST",
      body: JSON.stringify({
        updates: [{ sku: u.sku, price: money(u.priceCents), mrp: money(u.mrpCents) }],
      }),
    });
  },

  async listOrders(ctx, since): Promise<RemoteOrder[]> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      const skus: string[] = ctx.config.mockOrderSkus ?? [];
      return skus.slice(0, 1).map((sku, i) => ({
        externalId: `MSH-ORD-${mockRemoteId("", sku)}-${i}`,
        status: "NEW",
        currency: "INR",
        totalCents: 49900,
        placedAt: new Date().toISOString(),
        customer: { name: "Priya Sharma", email: "", phone: "+91-9700000000" },
        shippingAddress: {
          line1: "44 Anna Salai",
          city: "Chennai",
          state: "Tamil Nadu",
          postalCode: "600002",
          country: "IN",
        },
        items: [
          { sku, title: "Mock Meesho item", quantity: 1, priceCents: 49900, remoteItemId: `MSI-${i}` },
        ],
      }));
    }

    const body = await call(
      ctx,
      `/v1/orders?from=${encodeURIComponent(since.toISOString())}&limit=50`,
    );
    return (body?.orders ?? []).map((o: any) => ({
      externalId: String(o.order_id),
      status: String(o.status ?? "NEW"),
      currency: "INR",
      totalCents: Math.round(Number(o.total_amount ?? 0) * 100),
      placedAt: o.created_at ?? new Date().toISOString(),
      customer: { name: o.customer_name ?? "", email: "", phone: o.customer_phone ?? "" },
      shippingAddress: o.shipping_address ?? {},
      items: (o.items ?? []).map((it: any) => ({
        sku: it.sku ?? "",
        title: it.product_name ?? "",
        quantity: Number(it.quantity ?? 1),
        priceCents: Math.round(Number(it.price ?? 0) * 100),
        remoteItemId: String(it.item_id ?? ""),
      })),
    }));
  },
};
