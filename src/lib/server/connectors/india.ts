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
 * Two of the six ARE publicly documented: Snapdeal's full seller-API
 * reference lives at sellerapis.snapdeal.com (three-header auth, documented
 * gateway host) and Myntra's Developer Centre at mmip.myntrainfo.com
 * documents the PPMP surface, though its API host is only revealed after
 * developer registration. The other four — AJIO, JioMart, Nykaa, Tata CLiQ —
 * share endpoints only after an account manager enables API access, so their
 * transports remain sketches of the shape integrator guides describe. Expect
 * to correct paths and header names in this one file once you hold real
 * credentials; `config.baseUrl` and `config.extraHeaders` exist so a
 * corrected host or an extra required header does not need a code change.
 * Mock mode is fully functional and needs no account.
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
  /** Seller panel, when it is a different property from the docs site. */
  sellerPortalUrl?: string;
  /**
   * Every one of these marketplaces hands out API credentials by hand — an
   * account manager, an integrations team, a registration form with a human
   * behind it. This note is what the connect dialog shows instead of the
   * generic "create these in the portal" line, so it must name the real
   * route.
   */
  credentialsNote: string;
  idPrefix: string;
  group: string;
  status?: "ready" | "development";
  authFields: Manifest["authentication"];
  /**
   * Builds the auth headers from decrypted credentials. Entries with empty
   * values are dropped before the request, so a header keyed on an optional
   * credential simply disappears when the credential is absent. Constant
   * headers (e.g. Myntra's x-partner-store) belong here too.
   */
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
    setupGuide: `https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/${spec.name}.md`,
    credentialsNote: spec.credentialsNote,
    // None of these portals has a public order deep-link, so the seller
    // panel home is the honest destination.
    sellerPortalUrl: spec.sellerPortalUrl ?? spec.docsUrl,
  };

  async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
    // Presence is judged against the manifest, not against the built headers:
    // a constant header must not mask a missing credential, and an optional
    // credential must not fail the whole call.
    for (const f of manifest.authentication.fields) {
      if (!f.optional && !ctx.credentials[f.key]) {
        throw new ConnectorError(
          `missing ${spec.displayName} credential: ${f.key}`,
          "AUTHENTICATION",
        );
      }
    }
    // Most of these hosts are unverified until the marketplace shares its API
    // spec alongside the credentials, so a channel can point at the real host
    // — and add any header the spec turns out to demand — from config,
    // without touching this file.
    const base =
      typeof ctx.config.baseUrl === "string" && ctx.config.baseUrl
        ? ctx.config.baseUrl
        : spec.baseUrl;
    const headers: Record<string, string> = {};
    const merged = { ...spec.authHeaders(ctx.credentials), ...(ctx.config.extraHeaders ?? {}) };
    for (const [k, v] of Object.entries(merged)) {
      if (v) headers[k] = String(v);
    }
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...headers, ...(init.headers ?? {}) },
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
  // Myntra's Developer Centre (mmip.myntrainfo.com) documents the PPMP v4
  // surface publicly but never discloses the API host — that lives inside the
  // gated Postman reference issued after developer registration. This host is
  // a placeholder; set config.baseUrl once Myntra's registration reply names
  // the real one. Note also that PPMP v4's order flow is push-shaped: Myntra
  // calls the partner's Create/Update Order endpoint (integrators register a
  // webhook token with Myntra), and integrator docs say no SKU-pull API
  // exists — so the shared polling listOrders is a sketch that will likely
  // need replacing with an inbound receiver.
  baseUrl: "https://api.myntra.com/ppmp",
  docsUrl: "https://mmip.myntrainfo.com",
  sellerPortalUrl: "https://partnerportal.myntra.com",
  credentialsNote:
    "Myntra issues API credentials by hand: after seller onboarding at partners.myntrainfo.com, ask your account manager — or file the registration request at mmip.myntrainfo.com — to enable PPMP APIs, and you receive a Merchant ID and Secret Key. Your Warehouse ID is under Operational Reports in the Partner Portal.",
  idPrefix: "MYN",
  group: "India — fashion & beauty",
  authFields: {
    type: "api_key",
    fields: [
      {
        key: "merchant_id",
        label: "Merchant ID",
        secret: false,
        help: "Issued when Myntra enables PPMP APIs — OMS migration tickets sometimes call it Store Code / Merchant ID",
      },
      {
        key: "secret_key",
        label: "Secret Key",
        secret: true,
        help: "Shared alongside the Merchant ID by the Myntra team",
      },
      {
        key: "warehouse_id",
        label: "Warehouse ID",
        secret: false,
        optional: true,
        help: "Partner Portal > Operational Reports — not yet sent on any request; will become required once the inventory payload shape is confirmed",
      },
    ],
  },
  // x-partner-store is documented as mandatory on PPMP v4 (seen on the
  // discount API). How the Merchant ID and Secret Key travel is only shown in
  // the gated Postman reference, so those two header names are a sketch.
  authHeaders: (c) => ({
    "x-partner-store": "myntra",
    "merchant-id": c.merchant_id ?? "",
    "secret-key": c.secret_key ?? "",
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
  // Documented on PPMP v4: inventory pushes go in batches of 10 with a limit
  // of 100 requests per minute — so hold the connector under ~1.5 rps rather
  // than let a burst cross the documented ceiling.
  rateLimits: { requestsPerSecond: 1.5, burst: 3 },
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
  // No AJIO API host is public anywhere — endpoints arrive with the POB
  // credential email from the account manager. Placeholder; set
  // config.baseUrl to the host that email names.
  baseUrl: "https://api.ajio.com/seller",
  docsUrl: "https://seller.ajio.com",
  credentialsNote:
    "AJIO has no self-serve API programme. In Seller Central create a POB user under Account > Modify Account Details (the ID starts with DV), then ask your AJIO account manager or POC to issue the API password for it.",
  idPrefix: "AJO",
  group: "India — fashion & beauty",
  authFields: {
    type: "credentials",
    fields: [
      {
        key: "pob_user_id",
        label: "POB User ID",
        secret: false,
        help: "Alphanumeric, starts with DV — created in Seller Central under Account > Modify Account Details",
      },
      {
        key: "api_password",
        label: "API Password",
        secret: true,
        help: "Issued for the POB user by your AJIO account manager",
      },
    ],
  },
  // AJIO documents the credential pair (POB User ID + API Password) but not
  // the transport — these header names are a sketch until the spec arrives
  // with the credentials; config.extraHeaders can add whatever it demands.
  authHeaders: (c) => ({
    "pob-user-id": c.pob_user_id ?? "",
    "api-password": c.api_password ?? "",
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
  // Nothing about JioMart's API transport is public — no docs, no host, no
  // header names; integrator guides say only that credentials come from the
  // category manager. Everything below is a sketch kept so live mode fails
  // loudly rather than silently; correct via config.baseUrl /
  // config.extraHeaders once JioMart's integration team shares the spec.
  baseUrl: "https://api.jiomart.com/seller",
  docsUrl: "https://seller.jiomart.com",
  credentialsNote:
    "JioMart issues API credentials only through your assigned category manager — there are no self-serve keys. Registered sellers should write from their registered email to Seller.Support@jiomart.com to be routed to the right contact.",
  idPrefix: "JIO",
  group: "India — horizontal",
  authFields: {
    type: "api_key",
    fields: [
      {
        key: "seller_id",
        label: "Seller ID",
        secret: false,
        help: "Visible in the JioMart seller portal after approval",
      },
      {
        key: "api_key",
        label: "API Key",
        secret: true,
        help: "As issued by your JioMart category manager — JioMart's own field names are not public, so match whatever the credential email calls it",
      },
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
  // No Nykaa API host is published anywhere — endpoints are shared only with
  // approved vendors. Placeholder; set config.baseUrl to what the Nykaa
  // integration team (or the seller panel's API integration settings) gives
  // you.
  baseUrl: "https://api.nykaa.com/seller",
  docsUrl: "https://seller.nykaa.com",
  credentialsNote:
    "Nykaa creates vendor logins by hand after brand approval — there is no open signup. The API Username and Password come from the seller panel's API integration settings or from your Nykaa category contact, along with your Seller ID.",
  idPrefix: "NYK",
  group: "India — fashion & beauty",
  authFields: {
    type: "credentials",
    fields: [
      {
        key: "api_username",
        label: "API Username",
        secret: false,
        help: "Issued by the Nykaa team; also visible under the seller panel's API integration settings",
      },
      { key: "api_password", label: "API Password", secret: true },
      { key: "seller_id", label: "Seller ID", secret: false },
      {
        key: "child_seller_id",
        label: "Child Seller ID",
        secret: false,
        optional: true,
        help: "Only for sub-accounts under a parent seller",
      },
    ],
  },
  // Nykaa documents the credential set (username/password/seller id) but not
  // the transport — these header names are a sketch; config.extraHeaders can
  // supply whatever the real spec demands.
  authHeaders: (c) => ({
    "api-username": c.api_username ?? "",
    "api-password": c.api_password ?? "",
    "seller-id": c.seller_id ?? "",
    "child-seller-id": c.child_seller_id ?? "",
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
  // No Tata CLiQ API host is published — endpoints are shared after the
  // Account Manager activates API access on the seller account. Placeholder;
  // set config.baseUrl to the host they name.
  baseUrl: "https://api.tatacliq.com/seller",
  docsUrl: "https://sellerzone.tatacliq.com",
  credentialsNote:
    "Tata CLiQ activates API access per account: give your Account Manager your Seller ID and ask for activation, collect the slave account's username and password from your SPOC, and read the Slave ID in Seller Zone under Slave Onboarding > Seller List View.",
  idPrefix: "TCQ",
  group: "India — horizontal",
  authFields: {
    type: "credentials",
    fields: [
      {
        key: "seller_id",
        label: "Seller ID",
        secret: false,
        help: "Numeric, provided by the Tata CLiQ team at onboarding",
      },
      {
        key: "username",
        label: "Panel username",
        secret: false,
        help: "The slave account's Seller Zone login username, from your SPOC",
      },
      { key: "password", label: "Panel password", secret: true },
      {
        key: "slave_id",
        label: "Slave ID",
        secret: false,
        help: "Seller Zone > Slave Onboarding > Seller List View — the part after the dash in SellerId-SlaveID",
      },
    ],
  },
  // Tata CLiQ documents the credential set (SellerId + slave username /
  // password + Slave ID) but not the transport — these header names are a
  // sketch; config.extraHeaders can supply what the real spec demands.
  authHeaders: (c) => ({
    "seller-id": c.seller_id ?? "",
    username: c.username ?? "",
    password: c.password ?? "",
    "slave-id": c.slave_id ?? "",
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
  // Documented production gateway. The sandbox is
  // http://staging-apigateway.snapdeal.com (plain http) with its own token
  // pair — point config.baseUrl at it for sandbox runs.
  baseUrl: "https://apigateway.snapdeal.com/seller-api",
  docsUrl: "https://sellerapis.snapdeal.com",
  sellerPortalUrl: "https://sellers.snapdeal.com",
  credentialsNote:
    "Snapdeal's API is self-serve but two-step: register as an API user at sellerapis.snapdeal.com (the API team replies in about two days with a Client ID and access token), then send the seller through authorize.snapdeal.com to mint the per-seller authorization token.",
  idPrefix: "SND",
  group: "India — horizontal",
  authFields: {
    type: "api_key",
    fields: [
      {
        key: "client_id",
        label: "Client ID",
        secret: false,
        help: "Issued when the Snapdeal API team approves your API-user registration",
      },
      {
        key: "auth_token",
        label: "API access token",
        secret: true,
        help: "The X-Auth-Token from the same approval — sandbox and production tokens differ",
      },
      {
        key: "seller_authz_token",
        label: "Seller authorization token",
        secret: true,
        help: "Returned in the redirect when the seller logs in at authorize.snapdeal.com for your appId",
      },
    ],
  },
  // The three-header model is documented on sellerapis.snapdeal.com.
  authHeaders: (c) => ({
    clientId: c.client_id ?? "",
    "X-Auth-Token": c.auth_token ?? "",
    "X-Seller-Authz-Token": c.seller_authz_token ?? "",
  }),
  required: [
    { path: "attributes.warranty_months", label: "Warranty (months)", required: true },
  ],
  rateLimits: { requestsPerSecond: 3, burst: 6 },
  // Only the profile path is confirmed from the public reference (the docs
  // host serves a mismatched *.readme.io TLS certificate, which blocks
  // automated reads). The catalogue/inventory/price/order paths inherit the
  // generic sketch and still need mapping to Snapdeal's documented endpoint
  // families (e.g. the /vendorself/... fulfilment routes).
  paths: { profile: "/seller/v2/info" },
  mockCustomer: { name: "Arjun Bhatia", city: "Jaipur", state: "Rajasthan", postalCode: "302001" },
  mockTotalCents: 74900,
});
