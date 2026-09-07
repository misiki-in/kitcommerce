/**
 * eBay connector constants and manifest.
 */
import type { Manifest } from "../../connector";

export const EBAY_PROD_URL = "https://api.ebay.com";
export const EBAY_SANDBOX_URL = "https://api.sandbox.ebay.com";
export const EBAY_TOKEN_MARGIN_MS = 60_000;
export const EBAY_ORDER_PAGE_SIZE = 200;
export const EBAY_ORDER_MAX_PAGES = 10;
export const EBAY_SCOPES =
  "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.account";

export const manifest: Manifest = {
  name: "ebay",
  group: "Global",
  status: "ready",
  idPrefix: "EBAY",
  displayName: "eBay",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2",
    fields: [
      { key: "client_id", label: "App ID (Client ID)", secret: false },
      { key: "client_secret", label: "Cert ID (Client Secret)", secret: true },
      { key: "ru_name", label: "eBay RuName", secret: false, optional: true, help: "From eBay Developer Portal > User Tokens > Your Application Redirect URL." },
      {
        key: "refresh_token",
        label: "User Refresh Token",
        secret: true,
        optional: true,
        help: "Minted automatically when clicking Connect with eBay.",
      },
    ],
  },
  regions: ["US", "GB", "DE", "AU", "CA", "IN"],
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
    { path: "title", label: "Listing title", required: true, help: "80 characters max" },
    { path: "description", label: "Description", required: true },
    { path: "images", label: "At least one image", required: true },
    {
      path: "attributes.ebay_category_id",
      label: "eBay category ID",
      required: true,
      help: "Numeric leaf category from the eBay taxonomy",
    },
    {
      path: "attributes.condition",
      label: "Item condition",
      required: true,
      enum: ["NEW", "LIKE_NEW", "USED_EXCELLENT", "USED_GOOD", "USED_ACCEPTABLE"],
    },
    {
      path: "attributes.ebay_fulfillment_policy_id",
      label: "Fulfillment policy ID",
      required: true,
      help: "From Seller Hub > Business policies",
    },
    { path: "attributes.ebay_payment_policy_id", label: "Payment policy ID", required: true },
    { path: "attributes.ebay_return_policy_id", label: "Return policy ID", required: true },
    {
      path: "attributes.ebay_merchant_location_key",
      label: "Merchant location key",
      required: true,
    },
  ],
  rateLimits: { requestsPerSecond: 8, burst: 20 },
  docsUrl: "https://developer.ebay.com/api-docs/sell/inventory/overview.html",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/ebay.md",
  sellerPortalUrl: "https://www.ebay.com/sh/ord",
  orderUrlTemplate: "https://www.ebay.com/sh/ord/details?orderid={id}",
};
