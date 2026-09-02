/**
 * Amazon connector constants, region hosts, and manifest.
 */
import type { Manifest } from "../../connector";

export const AMAZON_REGION_HOSTS = {
  eu: "https://sellingpartnerapi-eu.amazon.com", // IN, UK, DE, FR, IT, ES, AE, SA
  na: "https://sellingpartnerapi-na.amazon.com", // US, CA, MX, BR
  fe: "https://sellingpartnerapi-fe.amazon.com", // JP, AU, SG
} as const;

export const AMAZON_MARKETPLACES: Record<
  string,
  { id: string; region: keyof typeof AMAZON_REGION_HOSTS; currency: string }
> = {
  IN: { id: "A21TJRUUN4KGV", region: "eu", currency: "INR" },
  US: { id: "ATVPDKIKX0DER", region: "na", currency: "USD" },
  UK: { id: "A1F83G8C2ARO7P", region: "eu", currency: "GBP" },
  DE: { id: "A1PA6795UKMFR9", region: "eu", currency: "EUR" },
  AE: { id: "A2VIGQ35RCS4UG", region: "eu", currency: "AED" },
  AU: { id: "A39IBJ37TRP1C6", region: "fe", currency: "AUD" },
  JP: { id: "A1VC38T7YXB528", region: "fe", currency: "JPY" },
};

export const AMAZON_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
export const AMAZON_TOKEN_MARGIN_MS = 60_000;
export const AMAZON_ORDER_PAGE_CAP = 10;
export const AMAZON_ITEM_BURST_HEADROOM = 25;
export const AMAZON_ITEM_PACE_MS = 2_000;

export const AMAZON_CONDITION_MAP: Record<string, string> = {
  NEW: "new_new",
  LIKE_NEW: "used_like_new",
  USED_EXCELLENT: "used_very_good",
  USED_GOOD: "used_good",
  USED_ACCEPTABLE: "used_acceptable",
};

export const manifest: Manifest = {
  name: "amazon",
  group: "India — horizontal",
  status: "development",
  idPrefix: "AMZ",
  displayName: "Amazon",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2_lwa",
    fields: [
      { key: "client_id", label: "LWA Client ID", secret: false },
      { key: "client_secret", label: "LWA Client Secret", secret: true },
      { key: "refresh_token", label: "Refresh Token", secret: true },
      { key: "seller_id", label: "Selling Partner ID", secret: false },
    ],
  },
  credentialsNote:
    "Amazon issues these only after a reviewed developer registration (Seller Central > Apps and Services > Develop Apps), which takes days to approve. If this installation has Amazon OAuth configured, the Connect button obtains everything except the review for you — the setup guide covers both routes.",
  regions: Object.keys(AMAZON_MARKETPLACES),
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
    { path: "title", label: "Item name", required: true, help: "200 characters max" },
    { path: "brand", label: "Brand", required: true, help: "Must be Brand Registry approved" },
    { path: "description", label: "Description", required: true },
    { path: "images", label: "Main image", required: true, help: "Min 1000px on the longest side" },
    {
      path: "attributes.amazon_product_type",
      label: "Product type",
      required: true,
      help: "From the Product Type Definitions API, e.g. SHIRT, LUGGAGE, FINERING",
    },
    {
      path: "attributes.amazon_browse_node_id",
      label: "Browse node ID",
      required: true,
      help: "Numeric category node for the target marketplace",
    },
    {
      path: "attributes.condition",
      label: "Condition",
      required: true,
      enum: ["NEW", "LIKE_NEW", "USED_EXCELLENT", "USED_GOOD", "USED_ACCEPTABLE"],
    },
    {
      path: "attributes.country_of_origin",
      label: "Country of origin",
      required: true,
      help: "Mandatory for Amazon India listings",
    },
    { path: "hsnCode", label: "HSN code", required: true, help: "Required for GST invoicing (IN)" },
    { path: "weightG", label: "Item weight (g)", required: true },
  ],
  rateLimits: { requestsPerSecond: 5, burst: 5 },
  docsUrl: "https://developer-docs.amazon.com/sp-api/",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/amazon.md",
  sellerPortalUrl: "https://sellercentral.amazon.in",
  orderUrlTemplate: "https://sellercentral.amazon.in/orders-v3/order/{id}",
};
