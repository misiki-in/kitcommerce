/**
 * Indian marketplace connectors constants, specs, and manifests.
 */
import type { Capabilities, FieldSpec, Manifest } from "../../connector";

export interface PortalSpec {
  name: string;
  displayName: string;
  baseUrl: string;
  docsUrl: string;
  sellerPortalUrl?: string;
  credentialsNote: string;
  idPrefix: string;
  group: string;
  status?: "ready" | "development";
  authFields: Manifest["authentication"];
  authHeaders: (creds: Record<string, string>) => Record<string, string>;
  capabilities?: Partial<Capabilities>;
  required: FieldSpec[];
  rateLimits: Manifest["rateLimits"];
  paths?: Partial<{
    profile: string;
    create: string;
    update: string;
    inventory: string;
    price: string;
    orders: string;
  }>;
  extend?: (p: any, ctx: any) => Record<string, unknown>;
}

export const BASE_CAPABILITIES: Capabilities = {
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

export const COMMON_REQUIRED: FieldSpec[] = [
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

export const MYNTRA_SPEC: PortalSpec = {
  name: "myntra",
  displayName: "Myntra",
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
  rateLimits: { requestsPerSecond: 1.5, burst: 3 },
  paths: { create: "/v1/styles", update: "/v1/styles" },
  extend: (p) => ({
    style_code: p.sku,
    article_type: (p.attributes as any).article_type,
    gender: (p.attributes as any).gender,
    size_chart_id: (p.attributes as any).size_chart_id,
  }),
};

export const AJIO_SPEC: PortalSpec = {
  name: "ajio",
  displayName: "AJIO",
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
};

export const JIOMART_SPEC: PortalSpec = {
  name: "jiomart",
  displayName: "JioMart",
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
};

export const NYKAA_SPEC: PortalSpec = {
  name: "nykaa",
  displayName: "Nykaa",
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
};

export const TATACLIQ_SPEC: PortalSpec = {
  name: "tatacliq",
  displayName: "Tata CLiQ",
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
  authHeaders: (c) => ({
    "seller-id": c.seller_id ?? "",
    username: c.username ?? "",
    password: c.password ?? "",
    "slave-id": c.slave_id ?? "",
  }),
  required: [
    {
      path: "attributes.brand_authorisation",
      label: "Brand authorisation ID",
      required: true,
      help: "Tata CLiQ verifies brand authorisation before a listing goes live",
    },
    { path: "attributes.warranty_months", label: "Warranty (months)", required: true },
  ],
  rateLimits: { requestsPerSecond: 4, burst: 8 },
};

export const SNAPDEAL_SPEC: PortalSpec = {
  name: "snapdeal",
  displayName: "Snapdeal",
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
  authHeaders: (c) => ({
    clientId: c.client_id ?? "",
    "X-Auth-Token": c.auth_token ?? "",
    "X-Seller-Authz-Token": c.seller_authz_token ?? "",
  }),
  required: [
    { path: "attributes.warranty_months", label: "Warranty (months)", required: true },
  ],
  rateLimits: { requestsPerSecond: 3, burst: 6 },
  paths: { profile: "/seller/v2/info" },
};
