/**
 * Etsy connector constants and manifest.
 */
import type { Manifest } from "../../connector";

export const ETSY_API_BASE = "https://openapi.etsy.com/v3/application";
export const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
export const ETSY_TOKEN_MARGIN_MS = 60_000;
export const ETSY_MAX_ORDER_PAGES = 100;
export const ETSY_ORDER_PAGE_LIMIT = 100;

/**
 * Etsy's two custom variation slots. Real taxonomy properties would need a
 * getPropertiesByTaxonomyId lookup per category; the custom slots accept any
 * property_name, which is exactly what arbitrary OpenCommerce option names
 * are. Etsy supports at most two variation properties per listing.
 */
export const ETSY_CUSTOM_PROPERTY_IDS = [513, 514];

export const manifest: Manifest = {
  name: "etsy",
  group: "Global",
  status: "ready",
  idPrefix: "ETSY",
  displayName: "Etsy",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2_pkce",
    fields: [
      { key: "api_key", label: "Keystring (x-api-key)", secret: false },
      {
        key: "shared_secret",
        label: "Shared secret",
        secret: true,
        optional: true,
        help: "Sits next to the keystring on your app's page at etsy.com/developers/your-apps. Etsy requires it inside the x-api-key header on every call; leave this empty only if api_key already holds \"keystring:sharedsecret\".",
      },
      {
        key: "access_token",
        label: "OAuth Access Token",
        secret: true,
        optional: true,
        help: "Only lives one hour. With a refresh token present the connector mints its own, so this can stay empty.",
      },
      {
        key: "refresh_token",
        label: "OAuth Refresh Token",
        secret: true,
        optional: true,
        help: "From the one-time OAuth grant; valid 90 days and rotated on every renewal. Without it, live mode stops working an hour after the access token was minted.",
      },
    ],
  },
  regions: ["US", "GB", "DE", "FR", "CA", "AU", "IN"],
  capabilities: {
    createProduct: true,
    updateProduct: true,
    deleteProduct: true,
    inventorySync: true,
    priceSync: true,
    orderImport: true,
    orderUpdate: true,
    webhooks: false,
    bulkOperations: false,
    variants: true,
  },
  requiredFields: [
    { path: "title", label: "Listing title", required: true, help: "140 characters max" },
    { path: "description", label: "Description", required: true },
    { path: "images", label: "At least one image", required: true },
    {
      path: "attributes.etsy_taxonomy_id",
      label: "Etsy taxonomy ID",
      required: true,
      help: "Numeric leaf category from Etsy's seller taxonomy",
    },
    {
      path: "attributes.who_made",
      label: "Who made it",
      required: true,
      enum: ["i_did", "someone_else", "collective"],
    },
    {
      path: "attributes.when_made",
      label: "When was it made",
      required: true,
      enum: [
        "made_to_order",
        "2020_2026",
        "2010_2019",
        "2007_2009",
        "before_2007",
        "2000_2006",
        "1990s",
        "1980s",
        "1970s",
        "1960s",
        "1950s",
        "1940s",
        "1930s",
        "1920s",
        "1910s",
        "1900s",
        "1800s",
        "1700s",
        "before_1700",
      ],
    },
    {
      path: "attributes.etsy_shipping_profile_id",
      label: "Shipping profile ID",
      required: false,
      help: "From Etsy Shop Manager > Settings > Shipping. Needed before the listing can go live.",
    },
  ],
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  docsUrl: "https://developers.etsy.com/documentation/reference",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/etsy.md",
  sellerPortalUrl: "https://www.etsy.com/your/orders/sold",
};
