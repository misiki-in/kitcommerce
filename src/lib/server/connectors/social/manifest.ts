/**
 * Meta Social Commerce constants, specs, and manifests for Instagram and Facebook.
 */
import type { Capabilities, FieldSpec, Manifest } from "../../connector";

export interface MetaSpec {
  name: string;
  displayName: string;
  idPrefix: string;
  regions: string[];
  credentialsNote: string;
}

export const META_REQUIRED: FieldSpec[] = [
  { path: "title", label: "Product name", required: true },
  { path: "description", label: "Description", required: true },
  { path: "brand", label: "Brand", required: true },
  {
    path: "images",
    label: "At least one image",
    required: true,
    help: "Feed placements crop to square; a centred subject survives it best",
  },
  {
    path: "attributes.condition",
    label: "Condition",
    required: true,
    enum: ["NEW", "LIKE_NEW", "USED_EXCELLENT", "USED_GOOD", "USED_ACCEPTABLE"],
  },
  {
    path: "attributes.landing_url",
    label: "Product landing page",
    required: true,
    help: "Where a tap goes. Every purchase completes on your own site, so this must work",
  },
];

export const META_GRAPH = "https://graph.facebook.com/v26.0";
export const META_THROTTLE_CODES = new Set([4, 17, 613, 80014]);
export const META_THROTTLE_FALLBACK_MS = 15 * 60_000;
export const BATCH_STATUS_DELAY_MS = 2000;

export const META_OPTION_FIELDS: Record<string, string> = {
  color: "color",
  colour: "color",
  size: "size",
  material: "material",
  pattern: "pattern",
  gender: "gender",
};

export const metaAuth: Manifest["authentication"] = {
  type: "oauth2_access_token",
  fields: [
    {
      key: "app_id",
      label: "App ID / Client ID",
      secret: false,
      optional: true,
      help: "Meta App ID from Meta for Developers (developers.facebook.com/apps). Needed for 1-Click Connect & automated token refresh.",
    },
    {
      key: "app_secret",
      label: "App Secret",
      secret: true,
      optional: true,
      help: "Meta App Secret from Meta for Developers → App settings → Basic.",
    },
    {
      key: "catalog_id",
      label: "Catalog ID",
      secret: false,
      optional: true,
      help: "Catalog ID from Meta Commerce Manager (Settings → Catalog). If left empty, will be auto-discovered upon connect or refresh.",
    },
    {
      key: "access_token",
      label: "System User / OAuth Access Token",
      secret: true,
      optional: true,
      help: "Generated via 1-Click Connect, or System User Access Token from Business Settings → System users with catalog_management and business_management scopes.",
    },
    {
      key: "business_id",
      label: "Business ID",
      secret: false,
      optional: true,
      help: "Business Settings → Business info. Auto-discovered or informational.",
    },
  ],
};

export const META_CAPABILITIES: Capabilities = {
  createProduct: true,
  updateProduct: true,
  deleteProduct: true,
  inventorySync: true,
  priceSync: true,
  orderImport: false,
  orderUpdate: false,
  webhooks: false,
  bulkOperations: true,
  variants: true,
};

export const META_SPEC: MetaSpec = {
  name: "meta",
  displayName: "Meta (Facebook & Instagram)",
  idPrefix: "META",
  regions: ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "BR", "FR", "IT", "ES", "JP"],
  credentialsNote:
    "Meta Commerce synchronizes products to a shared catalogue for both Facebook Shop and Instagram Shopping. Connect automatically using your Meta App ID & App Secret, or provide a System User Access Token and Catalog ID from Meta Commerce Manager.",
};

export const INSTAGRAM_SPEC: MetaSpec = {
  name: "instagram",
  displayName: "Instagram",
  idPrefix: "IGS",
  regions: ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "BR"],
  credentialsNote:
    "These are not your Instagram login. Generate a system-user access token with the catalog_management and business_management scopes in Business Settings → System users, and copy the Catalog ID from your catalogue's settings in Commerce Manager. Product tags only appear once the Instagram account has passed Shopping review in Commerce Manager.",
};

export const FACEBOOK_SPEC: MetaSpec = {
  name: "facebook",
  displayName: "Facebook",
  idPrefix: "FBS",
  regions: ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "BR"],
  credentialsNote:
    "These are not your Facebook login. Generate a system-user access token with the catalog_management and business_management scopes in Business Settings → System users, and copy the Catalog ID from your catalogue's settings in Commerce Manager.",
};
