/**
 * Shopify connector constants and manifest.
 */
import type { Manifest } from "../../connector";

export const SHOPIFY_API_VERSION = "2026-07";
export const SHOPIFY_TOKEN_MARGIN_MS = 60_000;
export const SHOPIFY_MAX_ORDER_PAGES = 10;

export const manifest: Manifest = {
  name: "shopify",
  group: "Webstore platforms",
  status: "development",
  idPrefix: "SHP",
  displayName: "Shopify",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "admin_access_token",
    fields: [
      { key: "shop_domain", label: "Shop domain (example.myshopify.com)", secret: false },
      {
        key: "access_token",
        label: "Admin API access token",
        secret: true,
        optional: true,
        help: "Only legacy admin custom apps (created before Jan 2026) have this permanent shpat_ token. Leave empty when using a Client ID/Secret.",
      },
      {
        key: "client_id",
        label: "Client ID (Dev Dashboard app)",
        secret: false,
        optional: true,
      },
      {
        key: "client_secret",
        label: "Client secret (Dev Dashboard app)",
        secret: true,
        optional: true,
      },
    ],
  },
  credentialsNote:
    "Shopify has two routes: stores with a custom app created in admin before Jan 2026 paste its permanent Admin API access token, everyone else creates an app in the Dev Dashboard (dev.shopify.com) and pastes its Client ID and Client secret — OpenCommerce exchanges those for 24-hour tokens automatically, since new custom apps can no longer be created inside admin.",
  regions: ["US", "GB", "IN", "CA", "AU", "DE", "FR", "AE"],
  capabilities: {
    createProduct: true,
    updateProduct: true,
    deleteProduct: false,
    inventorySync: true,
    priceSync: true,
    orderImport: true,
    orderUpdate: false,
    webhooks: true,
    bulkOperations: false,
    variants: true,
  },
  requiredFields: [
    { path: "title", label: "Product title", required: true },
    { path: "description", label: "Description", required: true },
    {
      path: "images",
      label: "At least one image",
      required: true,
      help: "Shopify will accept a product without one, but nobody buys from an empty tile.",
    },
  ],
  rateLimits: { requestsPerSecond: 4, burst: 8 },
  docsUrl: "https://shopify.dev/docs/api/admin-graphql",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/shopify.md",
  sellerPortalUrl: "https://admin.shopify.com",
};
