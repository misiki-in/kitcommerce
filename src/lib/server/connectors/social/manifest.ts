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
    { key: "catalog_id", label: "Catalog ID", secret: false },
    {
      key: "business_id",
      label: "Business ID",
      secret: false,
      optional: true,
      help: "Business Settings → Business info. Not needed for catalogue calls",
    },
    { key: "access_token", label: "System User Access Token", secret: true },
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
