/**
 * Flipkart connector constants and manifest.
 */
import type { Manifest } from "../../connector";

export const FLIPKART_PROD_URL = "https://api.flipkart.net";
export const FLIPKART_SANDBOX_URL = "https://sandbox-api.flipkart.net";
export const FLIPKART_TOKEN_MARGIN_MS = 60_000;
export const FLIPKART_MAX_ORDER_PAGES = 10;
export const FLIPKART_DEFAULT_PAGE_SIZE = 20;

export const manifest: Manifest = {
  name: "flipkart",
  group: "India — horizontal",
  status: "development",
  idPrefix: "FKS",
  displayName: "Flipkart",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2_client_credentials",
    fields: [
      {
        key: "client_id",
        label: "Application ID",
        secret: false,
        help: "From Seller Dashboard > Manage Profile > Developer Access — not your seller login.",
      },
      {
        key: "client_secret",
        label: "Application Secret",
        secret: true,
        help: "Shown alongside the Application ID when the self-access application is created.",
      },
    ],
  },
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
    {
      path: "attributes.flipkart_fsn",
      label: "Flipkart product ID (FSN)",
      required: true,
      help:
        "The API only attaches listings to catalogue products that already exist on Flipkart. Create the product in Seller Hub first (brand approval where required) and paste its 13-16 character FSN here.",
    },
    { path: "hsnCode", label: "HSN code", required: true, help: "Required for GST invoicing" },
    { path: "weightG", label: "Shipping weight (g)", required: true },
    {
      path: "brand",
      label: "Brand",
      required: false,
      help:
        "Checked on the Seller Hub catalogue entry, not sent by this API — must match a Flipkart-approved brand there",
    },
    {
      path: "attributes.country_of_origin",
      label: "Country of origin",
      required: false,
      help:
        "Belongs to the Seller Hub catalogue entry, not this API — mandatory there under Indian labelling rules",
    },
  ],
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  docsUrl: "https://seller.flipkart.com/api-docs/FMSAPI.html",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/flipkart.md",
  sellerPortalUrl: "https://seller.flipkart.com",
};
