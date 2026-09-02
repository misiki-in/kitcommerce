/**
 * Meesho connector constants and manifest.
 */
import type { Manifest } from "../../connector";

export const MEESHO_API_PROD = "https://merchant.meesho.com";
export const MEESHO_API_TEST = "https://merchant.meeshotest.in";

export const manifest: Manifest = {
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
