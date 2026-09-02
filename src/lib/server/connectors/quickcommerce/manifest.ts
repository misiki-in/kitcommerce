/**
 * Quick-commerce constants, specs, and manifests.
 */
import type { Capabilities, FieldSpec, Manifest } from "../../connector";

export interface QuickCommerceSpec {
  name: string;
  displayName: string;
  baseUrl: string;
  docsUrl: string;
  sellerPortalUrl?: string;
  setupGuide: string;
  credentialsNote: string;
  idPrefix: string;
  group?: string;
  status?: "ready" | "development";
  authHeaders: (creds: Record<string, string>) => Record<string, string>;
  authFields: Manifest["authentication"];
  extraRequired?: FieldSpec[];
  rateLimits: Manifest["rateLimits"];
}

export const SHARED_CAPABILITIES: Capabilities = {
  createProduct: true,
  updateProduct: true,
  deleteProduct: false,
  inventorySync: true,
  priceSync: true,
  orderImport: true,
  orderUpdate: false,
  webhooks: false,
  bulkOperations: true,
  variants: false,
};

export const SHARED_REQUIRED: FieldSpec[] = [
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

export const ZEPTO_SPEC: QuickCommerceSpec = {
  name: "zepto",
  displayName: "Zepto",
  baseUrl: "https://api.zepto.co.in/seller",
  docsUrl: "https://brands.zepto.co.in",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/zepto.md",
  credentialsNote:
    "Zepto onboarding is curated by category managers and there is no self-serve API key. Enter the vendor/brand code Zepto assigned you as Seller ID; leave API Key empty unless Zepto's integration team has provisioned one for you.",
  idPrefix: "ZPT",
  authFields: {
    type: "api_key",
    fields: [
      {
        key: "seller_id",
        label: "Seller ID",
        secret: false,
        help: "The vendor/brand code Zepto assigns during onboarding — it appears on your purchase orders; ask your category manager",
      },
      {
        key: "api_key",
        label: "API Key",
        secret: true,
        optional: true,
        help: "No self-serve issuance exists; only fill this if Zepto's integration team provisioned a key",
      },
    ],
  },
  authHeaders: (c) => ({
    "X-Seller-Id": c.seller_id ?? "",
    Authorization: c.api_key ? `Bearer ${c.api_key}` : "",
  }),
  extraRequired: [
    {
      path: "attributes.fssai_licence",
      label: "FSSAI licence number",
      required: true,
      help: "Mandatory for food, beverage, dairy and grocery listings",
    },
  ],
  rateLimits: { requestsPerSecond: 3, burst: 6 },
};

export const INSTAMART_SPEC: QuickCommerceSpec = {
  name: "instamart",
  displayName: "Swiggy Instamart",
  baseUrl: "https://partner.swiggy.com/instamart",
  docsUrl: "https://www.swiggy.com/instamart-partner",
  sellerPortalUrl: "https://partner.instamart.in",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/instamart.md",
  credentialsNote:
    "Swiggy Instamart has no self-serve developer program — brands are onboarded through category managers. Enter the Swiggy-assigned code from your purchase orders or Brand Portal as Partner ID; Client ID and Secret exist only if Swiggy's integration team has provisioned them for you.",
  idPrefix: "SIM",
  authFields: {
    type: "api_key",
    fields: [
      {
        key: "partner_id",
        label: "Partner ID",
        secret: false,
        help: "The vendor/brand code Swiggy assigns during onboarding — visible on purchase orders and in the Brand Portal",
      },
      {
        key: "client_id",
        label: "Client ID",
        secret: false,
        optional: true,
        help: "No self-serve issuance exists; only fill this if Swiggy's integration team provisioned credentials",
      },
      {
        key: "client_secret",
        label: "Client Secret",
        secret: true,
        optional: true,
        help: "Issued together with the Client ID, or not at all",
      },
    ],
  },
  authHeaders: (c) => ({
    "X-Partner-Id": c.partner_id ?? "",
    Authorization:
      c.client_id && c.client_secret
        ? `Basic ${Buffer.from(`${c.client_id}:${c.client_secret}`).toString("base64")}`
        : "",
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
};

export const BLINKIT_SPEC: QuickCommerceSpec = {
  name: "blinkit",
  displayName: "Blinkit",
  baseUrl: "https://api.blinkit.com/seller",
  docsUrl: "https://seller.blinkit.com",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/blinkit.md",
  credentialsNote:
    "Blinkit issues no API keys to sellers — integrations work by Blinkit whitelisting your Vendor ID for a named platform, arranged through your Blinkit point of contact. Enter the Vendor ID from your Seller Hub account; leave key and secret empty unless Blinkit's integration team has provisioned them.",
  idPrefix: "BLK",
  authFields: {
    type: "api_key",
    fields: [
      {
        key: "vendor_id",
        label: "Vendor ID",
        secret: false,
        help: "The vendor code Blinkit assigns at onboarding — visible in the Seller Hub and printed on purchase orders",
      },
      {
        key: "api_key",
        label: "API Key",
        secret: true,
        optional: true,
        help: "Blinkit does not issue seller API keys; only fill this if their integration team provisioned one",
      },
      {
        key: "api_secret",
        label: "API Secret",
        secret: true,
        optional: true,
        help: "Issued together with the API Key, or not at all",
      },
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
};
