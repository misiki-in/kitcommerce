/**
 * Marketplace connector SDK.
 *
 * A connector knows one sales channel and nothing else. It never sees Litekart
 * types, never sees another connector, and receives only the canonical model.
 * Adding a connector must not require touching the core.
 */

// -------------------------------------------------------------- canonical in

export interface CanonicalImage {
  url: string;
  alt: string;
  position: number;
}

export interface CanonicalVariant {
  id: string;
  sku: string;
  barcode: string;
  options: Record<string, string>;
  priceCents: number;
  mrpCents: number;
  currency: string;
  available: number;
  weightG: number;
}

export interface CanonicalProduct {
  id: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  attributes: Record<string, unknown>;
  images: CanonicalImage[];
  variants: CanonicalVariant[];
  taxRateBp: number;
  hsnCode: string;
  weightG: number;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  version: number;
}

export interface SellerProfile {
  storeName: string;
  description: string;
  logoUrl: string;
  legalName: string;
  businessType: string;
  taxId: string;
  registrationNo: string;
  supportEmail: string;
  supportPhone: string;
  website: string;
  address: {
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  currency: string;
}

// ------------------------------------------------------------- capabilities

export interface Capabilities {
  createProduct: boolean;
  updateProduct: boolean;
  deleteProduct: boolean;
  inventorySync: boolean;
  priceSync: boolean;
  orderImport: boolean;
  orderUpdate: boolean;
  webhooks: boolean;
  bulkOperations: boolean;
  variants: boolean;
}

export interface FieldSpec {
  /** Path into the canonical product, e.g. "attributes.material". */
  path: string;
  label: string;
  required: boolean;
  /** Allowed values, when the marketplace constrains them. */
  enum?: string[];
  help?: string;
}

export interface RateLimits {
  requestsPerSecond: number;
  burst: number;
}

export interface Manifest {
  name: string;
  displayName: string;
  version: string;
  /**
   * "social" is not decoration. A social channel publishes a catalogue that is
   * browsed in-feed, and outside a handful of countries it has no native
   * checkout at all — so those connectors declare `orderImport: false` and mean
   * it. Anything reading this field should treat social as "can receive a
   * catalogue", never as "will return orders".
   */
  platformType: "marketplace" | "social";
  /**
   * Which group the connector picker and the landing page file this under.
   *
   * Declared by the connector rather than listed in the registry: a name in a
   * separate array is a name that can be forgotten, and a connector missing
   * from that array vanishes from the picker without failing anything.
   */
  group: string;
  /**
   * Whether a seller can point a real catalogue at this today.
   *
   * "ready" means the connector has been exercised against the live API.
   * "development" means its API is partner-gated or unproven — the landing page
   * greys these out and the marketing copy counts them separately. Flipping one
   * word here promotes a connector everywhere at once.
   */
  status: "ready" | "development";
  /** Prefix for remote IDs, e.g. "ETSY" -> "ETSY-1O28DM9-0". */
  idPrefix: string;
  authentication: {
    type: string;
    /**
     * `optional` marks a credential the connector can work without — e.g. one
     * of two alternative auth routes. The connect form renders it as a
     * non-required input; the connector decides at call time which route the
     * supplied set enables.
     */
    fields: Array<{ key: string; label: string; secret: boolean; help?: string; optional?: boolean }>;
  };
  /**
   * How a seller obtains these credentials, when it is not simply "create them
   * in the portal". Some marketplaces issue API credentials by hand through an
   * integrations team, and their seller login is OTP-only with no password to
   * give — so a generic "create these in the portal" line sends the seller to
   * make something that does not exist. When set, the connect dialog shows this
   * instead.
   */
  credentialsNote?: string;
  regions: string[];
  capabilities: Capabilities;
  /** Drives mapping validation and the "what's missing" UI (spec 43). */
  requiredFields: FieldSpec[];
  rateLimits: RateLimits;
  /** Developer API reference. */
  docsUrl: string;
  /**
   * Step-by-step onboarding guide for this marketplace — how to open the
   * seller account, register the app, and mint each credential the connect
   * form asks for. Full URL, because the dashboard may be running anywhere;
   * the canonical guides live under docs/setup/ in the repository.
   */
  setupGuide?: string;
  /** Where the merchant manages this marketplace. Always safe to open. */
  sellerPortalUrl?: string;
  /**
   * Deep link to a single order; `{id}` is the marketplace's own order ID.
   *
   * Only set where the URL shape is actually known. When absent the UI falls
   * back to sellerPortalUrl rather than guessing a path that 404s.
   */
  orderUrlTemplate?: string;
}

/** Resolve an order's marketplace URL, or the portal, or nothing. */
export function orderUrl(manifest: Manifest, externalId: string): string {
  if (manifest.orderUrlTemplate && externalId) {
    return manifest.orderUrlTemplate.replace("{id}", encodeURIComponent(externalId));
  }
  return manifest.sellerPortalUrl ?? "";
}

// ---------------------------------------------------------- error taxonomy

export type ErrorClass =
  | "RETRYABLE"
  | "RATE_LIMITED"
  | "AUTHENTICATION"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNKNOWN";

export class ConnectorError extends Error {
  readonly class: ErrorClass;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    cls: ErrorClass,
    opts: { retryAfterMs?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ConnectorError";
    this.class = cls;
    // Validation and auth failures are permanent: retrying them burns rate
    // limit and hides the real problem from the merchant.
    this.retryable = cls === "RETRYABLE" || cls === "RATE_LIMITED" || cls === "CONFLICT";
    this.retryAfterMs = opts.retryAfterMs;
    this.details = opts.details;
  }
}

/** Maps an HTTP status onto the taxonomy. Connectors may override per-API. */
export function classifyStatus(status: number, body?: string): ConnectorError {
  const snippet = (body ?? "").slice(0, 500);
  if (status === 401 || status === 403)
    return new ConnectorError(`auth failed (${status}): ${snippet}`, "AUTHENTICATION");
  if (status === 404) return new ConnectorError(`not found: ${snippet}`, "NOT_FOUND");
  if (status === 409) return new ConnectorError(`conflict: ${snippet}`, "CONFLICT");
  if (status === 422 || status === 400)
    return new ConnectorError(`validation failed (${status}): ${snippet}`, "VALIDATION");
  if (status === 429) return new ConnectorError("rate limited", "RATE_LIMITED");
  if (status >= 500) return new ConnectorError(`upstream ${status}: ${snippet}`, "RETRYABLE");
  return new ConnectorError(`unexpected ${status}: ${snippet}`, "UNKNOWN");
}

// ------------------------------------------------------------------ context

export interface ConnectorContext {
  /** Channel-level settings (shop id, marketplace, price rules, ...). */
  config: Record<string, any>;
  /** Decrypted credentials. Never logged, never serialised to a response. */
  credentials: Record<string, string>;
  seller: SellerProfile;
  log: (msg: string, meta?: Record<string, unknown>) => void;
}

// ---------------------------------------------------------------- interface

export interface RemoteProduct {
  remoteId: string;
  url?: string;
  raw?: unknown;
}

export interface InventoryUpdate {
  sku: string;
  remoteId: string;
  available: number;
}

export interface PriceUpdate {
  sku: string;
  remoteId: string;
  priceCents: number;
  mrpCents: number;
  currency: string;
}

export interface RemoteOrder {
  externalId: string;
  status: string;
  currency: string;
  totalCents: number;
  placedAt: string;
  customer: { name: string; email: string; phone: string };
  shippingAddress: Record<string, string>;
  items: Array<{
    sku: string;
    title: string;
    quantity: number;
    priceCents: number;
    remoteItemId: string;
  }>;
}

export interface MarketplaceConnector {
  manifest(): Manifest;
  health(ctx: ConnectorContext): Promise<{ status: string; detail?: string }>;
  createProduct(ctx: ConnectorContext, p: CanonicalProduct): Promise<RemoteProduct>;
  updateProduct(ctx: ConnectorContext, p: CanonicalProduct, remoteId: string): Promise<void>;
  deleteProduct?(ctx: ConnectorContext, remoteId: string): Promise<boolean>;
  updateInventory(ctx: ConnectorContext, u: InventoryUpdate): Promise<void>;
  updatePrice(ctx: ConnectorContext, u: PriceUpdate): Promise<void>;
  listOrders(ctx: ConnectorContext, since: Date): Promise<RemoteOrder[]>;
  discover?(ctx: ConnectorContext): Promise<Record<string, any>>;
}

// ------------------------------------------------------------------- helpers

/** Reads "attributes.material" / "variants.0.sku" out of a canonical product. */
export function readPath(p: CanonicalProduct, path: string): unknown {
  return path.split(".").reduce<any>((acc, k) => (acc == null ? acc : acc[k]), p as any);
}

/** Returns the manifest-required fields this product does not satisfy. */
export function missingRequiredFields(m: Manifest, p: CanonicalProduct): FieldSpec[] {
  return m.requiredFields.filter((f) => {
    if (!f.required) return false;
    const v = readPath(p, f.path);
    if (v === undefined || v === null) return true;
    if (typeof v === "string" && v.trim() === "") return true;
    if (Array.isArray(v) && v.length === 0) return true;
    if (typeof v === "number" && v === 0) return true;
    return false;
  });
}

export function money(cents: number): string {
  return (cents / 100).toFixed(2);
}
