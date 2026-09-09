/**
 * TikTok Shop connector constants and manifest.
 */
import type { Manifest } from "../../connector";

export const TIKTOK_OPEN_API = "https://open-api.tiktokglobalshop.com";
export const TIKTOK_AUTH_API = "https://auth.tiktok-shops.com";
export const TIKTOK_TOKEN_MARGIN_MS = 60_000;

export const manifest: Manifest = {
  name: "tiktok",
  displayName: "TikTok Shop",
  version: "0.1.0",
  platformType: "social",
  group: "Social",
  status: "development",
  idPrefix: "TTS",
  authentication: {
    type: "oauth2_authorization_code",
    fields: [
      { key: "app_key", label: "App Key", secret: false },
      { key: "app_secret", label: "App Secret", secret: true },
      {
        key: "access_token",
        label: "Access Token",
        secret: true,
        help: "From the one-time token exchange after the seller authorizes the app",
      },
      {
        key: "refresh_token",
        label: "Refresh Token",
        secret: true,
        optional: true,
        help: "Strongly recommended: lets the connector renew the access token before it expires",
      },
      {
        key: "shop_cipher",
        label: "Shop Cipher",
        secret: false,
        optional: true,
        help: "Discovered automatically when left blank",
      },
      {
        key: "shop_id",
        label: "Shop ID",
        secret: false,
        optional: true,
        help: "Only needed when the app is authorized for more than one shop",
      },
    ],
  },
  credentialsNote:
    "App Key and App Secret come from your app in TikTok Shop Partner Center. The tokens are not shown in any portal — they come from a one-time shop-authorization exchange described in the setup guide. Leave Shop Cipher and Shop ID blank; the connector discovers them.",
  regions: [
    "US",
    "GB",
    "IE",
    "ES",
    "FR",
    "DE",
    "IT",
    "MX",
    "BR",
    "JP",
    "ID",
    "MY",
    "TH",
    "VN",
    "PH",
    "SG",
  ],
  capabilities: {
    createProduct: true,
    updateProduct: true,
    deleteProduct: true,
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
    { path: "description", label: "Description", required: true },
    {
      path: "images",
      label: "At least one image",
      required: true,
      help: "Re-hosted on TikTok at publish time; the source URL must be publicly fetchable",
    },
    {
      path: "attributes.tiktok_category_id",
      label: "TikTok category ID",
      required: true,
      help: "TikTok's own taxonomy leaf; product creation rejects a free-text category",
    },
    {
      path: "attributes.package_weight_g",
      label: "Package weight (g)",
      required: true,
      help: "Required to quote shipping at checkout",
    },
  ],
  rateLimits: { requestsPerSecond: 10, burst: 20 },
  docsUrl: "https://partner.tiktokshop.com/docv2",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/tiktok.md",
  sellerPortalUrl: "https://seller.tiktokglobalshop.com",
};
