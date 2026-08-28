/**
 * Shopify connector (GraphQL Admin API).
 *
 * GraphQL rather than REST on purpose. The REST Admin API became legacy in
 * October 2024 and since April 2025 new public apps must be built on GraphQL,
 * so a REST connector written today would ship already deprecated.
 *
 * Three calls make a product, because Shopify split variants out of
 * productCreate: create the product (with its options and media), bulk-create
 * its variants, then set inventory per location. Inventory is deliberately the
 * third step — quantities belong to an inventory item at a location, not to the
 * variant, and pretending otherwise is what makes multi-location stores drift.
 * A product whose variants carry no options takes a shorter road: productCreate
 * always makes one standalone default variant, so the connector updates that
 * variant in place instead of bulk-creating a replacement.
 *
 * GraphQL also means HTTP 200 is not success. Shopify returns userErrors inside
 * a 200 body for validation failures, so every mutation here is checked twice:
 * once for transport, once for the payload. Throttling arrives the same way —
 * a 200 body whose top-level errors carry extensions.code THROTTLED, not an
 * HTTP 429 — which is why gql() reads error codes before deciding a failure is
 * permanent.
 *
 * Two credential routes exist because Shopify closed one of them. Custom apps
 * created inside admin before Jan 1 2026 hold a permanent Admin API token; new
 * apps are created in the Dev Dashboard and hold a Client ID/Secret that must
 * be exchanged for a 24-hour token. The connector accepts either: a pasted
 * access_token wins, otherwise it mints and caches tokens itself.
 *
 * Docs: https://shopify.dev/docs/api/admin-graphql
 */
import {
  ConnectorError,
  classifyStatus,
  money,
  type CanonicalProduct,
  type ConnectorContext,
  type InventoryUpdate,
  type Manifest,
  type MarketplaceConnector,
  type PriceUpdate,
  type RemoteOrder,
  type RemoteProduct,
} from "../connector";
import { createHash } from "node:crypto";
import { mockLatency, mockMaybeFail, mockRemoteId } from "./mock";

/**
 * Pinned rather than "latest". Shopify ships quarterly versions and retires
 * them on a published schedule (2026-07 is stable until Jul 16 2027); a
 * connector following "latest" changes behaviour underneath a seller with no
 * commit to point at.
 */
const API_VERSION = "2026-07";

const manifest: Manifest = {
  name: "shopify",
  group: "Webstore platforms",
  // Written against the published schema, never run against a live shop.
  status: "development",
  idPrefix: "SHP",
  displayName: "Shopify",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "admin_access_token",
    /*
     * Everything except the domain is optional because there are two valid
     * credential sets, not one incomplete one: a legacy permanent token on its
     * own, or a Client ID/Secret pair the connector exchanges for short-lived
     * tokens. accessToken() decides at call time which route the supplied set
     * enables and names both when neither is satisfied.
     */
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
  /*
   * Location is deliberately absent here.
   *
   * requiredFields validates a *product*, and a Shopify location is a property
   * of the channel — the same one serves the whole catalogue. Listing it here
   * would mark every product incomplete until a seller typed the same location
   * onto each of them. It is read from the channel config instead, and a
   * product may still override it per-product if a seller needs that.
   */
  requiredFields: [
    { path: "title", label: "Product title", required: true },
    { path: "description", label: "Description", required: true },
    {
      path: "images",
      label: "At least one image",
      // productCreate accepts a product with no media, so this is stricter than
      // the API. A storefront product with no picture is not a listing anyone
      // buys from, and finding that out after a catalogue push is worse than
      // being held back here.
      required: true,
      help: "Shopify will accept a product without one, but nobody buys from an empty tile.",
    },
  ],
  rateLimits: { requestsPerSecond: 4, burst: 8 },
  docsUrl: "https://shopify.dev/docs/api/admin-graphql",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/shopify.md",
  sellerPortalUrl: "https://admin.shopify.com",
};

// ------------------------------------------------------------------ transport

function shopDomain(ctx: ConnectorContext): string {
  const domain = ctx.credentials.shop_domain?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain) throw new ConnectorError("missing Shopify shop_domain", "AUTHENTICATION");
  return domain;
}

/**
 * Client-credentials tokens, cached for their stated lifetime.
 *
 * Dev Dashboard apps have no permanent token: the Client ID/Secret is
 * exchanged at https://{shop}/admin/oauth/access_token for a token that
 * expires after 24 hours (expires_in is documented as always 86399). Minting
 * per call would double every operation's request count, so tokens are cached
 * process-wide and renewed a minute before expiry.
 *
 * Keyed by a hash of the credentials, never the secret itself: this map is
 * process-wide and a credential should not be sitting in a key that any future
 * debug dump of it would print.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Renew a minute early, so a token cannot expire mid-flight on a slow call. */
const TOKEN_MARGIN_MS = 60_000;

/** Where a minted token lives in the cache, shared by mint and invalidation. */
const mintCacheKey = (domain: string, clientId: string, clientSecret: string): string =>
  createHash("sha256").update(`${domain}|${clientId}|${clientSecret}`).digest("hex");

/**
 * Resolves whichever credential route the seller supplied.
 *
 * A pasted access_token (legacy admin custom app) is used as-is. Otherwise a
 * Client ID/Secret pair mints a short-lived token via the documented
 * client-credentials grant — which only works when app and store share a
 * Shopify organization, so a rejection here usually means the app was created
 * under the wrong account, not a typo.
 */
async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { access_token, client_id, client_secret } = ctx.credentials;
  if (access_token) return access_token;
  if (!client_id || !client_secret) {
    throw new ConnectorError(
      "missing Shopify credentials: supply either an Admin API access_token (legacy admin custom app) or a client_id + client_secret (Dev Dashboard app)",
      "AUTHENTICATION",
    );
  }

  const domain = shopDomain(ctx);
  const cacheKey = mintCacheKey(domain, client_id, client_secret);

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id,
      client_secret,
    }),
  });
  if (!res.ok) {
    // The token endpoint throttles like any other: a 429 is a full bucket,
    // not a bad pair, and classifying it as AUTHENTICATION would flip the
    // channel to AUTH_FAILURE over a burst that a short wait would clear.
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 2);
      throw new ConnectorError("Shopify throttled the token endpoint", "RATE_LIMITED", {
        retryAfterMs: retryAfter * 1000,
      });
    }
    if (res.status >= 500) throw classifyStatus(res.status, await res.text());
    // Any other 4xx from the token endpoint is a credentials problem (bad
    // pair, app not installed, app and store in different organizations) —
    // surfacing it as AUTHENTICATION marks the channel instead of retrying a
    // lost cause.
    throw new ConnectorError(
      `Shopify rejected client credentials (${res.status}): ${(await res.text()).slice(0, 500)}`,
      "AUTHENTICATION",
    );
  }

  const body = (await res.json()) as { access_token: string; expires_in?: number };
  // expires_in is documented as always 86399 seconds; a missing value falling
  // back to zero would re-mint on every call, so default to the documented day.
  const lifetimeMs = (body.expires_in ?? 86_399) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - TOKEN_MARGIN_MS),
  });
  return body.access_token;
}

interface UserError {
  field?: string[] | null;
  message: string;
}

interface GqlError {
  message: string;
  extensions?: { code?: string; cost?: QueryCost };
}

interface QueryCost {
  requestedQueryCost?: number;
  throttleStatus?: { currentlyAvailable?: number; restoreRate?: number };
}

/**
 * How long until the leaky bucket has refilled enough to run this query.
 *
 * A throttled response reports the query's cost and the bucket's fill state
 * (currentlyAvailable, restoreRate in points per second), so the honest wait
 * is the deficit divided by the restore rate. When the cost block is missing,
 * two seconds covers the worst documented plan (100 points/s Standard).
 */
function throttleRetryMs(cost: QueryCost | undefined): number {
  const requested = Number(cost?.requestedQueryCost);
  const available = Number(cost?.throttleStatus?.currentlyAvailable);
  const restore = Number(cost?.throttleStatus?.restoreRate);
  if (Number.isFinite(requested) && Number.isFinite(available) && restore > 0) {
    const deficit = Math.max(0, requested - available);
    return Math.max(1000, Math.ceil(deficit / restore) * 1000);
  }
  return 2000;
}

/**
 * One GraphQL round trip.
 *
 * `errors` is a top-level failure and `userErrors` is a mutation-payload
 * failure, and they arrive by different routes: the first at the top level of
 * the body, the second nested under whichever mutation ran. Top-level errors
 * are not uniformly permanent — Shopify's calculated-cost throttle returns
 * HTTP 200 with extensions.code THROTTLED (not a 429), so error codes are read
 * before classifying: THROTTLED retries with a derived wait, ACCESS_DENIED and
 * SHOP_INACTIVE mark the channel, INTERNAL_SERVER_ERROR retries, and only the
 * rest are treated as permanent validation failures.
 */
async function gql<T = any>(
  ctx: ConnectorContext,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let res = await postGraphql(ctx, query, variables);

  // A minted client-credentials token can die before its cached expiry —
  // reinstalling the app or releasing a new app version invalidates every
  // outstanding token. One fresh mint tells that apart from genuinely bad
  // credentials; a pasted permanent token gets no retry, because re-sending
  // the same string cannot change the answer.
  if ((res.status === 401 || res.status === 403) && !ctx.credentials.access_token) {
    const { client_id, client_secret } = ctx.credentials;
    if (client_id && client_secret) {
      tokenCache.delete(mintCacheKey(shopDomain(ctx), client_id, client_secret));
      res = await postGraphql(ctx, query, variables);
    }
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 2);
    throw new ConnectorError("Shopify throttled", "RATE_LIMITED", {
      retryAfterMs: retryAfter * 1000,
    });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const body = (await res.json()) as {
    data?: T;
    errors?: GqlError[];
    extensions?: { cost?: QueryCost };
  };
  if (body.errors?.length) {
    const codes = new Set(body.errors.map((e) => e.extensions?.code).filter(Boolean));
    const message = `Shopify: ${body.errors.map((e) => e.message).join("; ")}`;
    if (codes.has("THROTTLED")) {
      // The cost block documents itself at the body's extensions, but check
      // the error's own extensions too — community captures show both shapes.
      const cost = body.extensions?.cost ?? body.errors.find((e) => e.extensions?.cost)?.extensions?.cost;
      throw new ConnectorError(message, "RATE_LIMITED", {
        retryAfterMs: throttleRetryMs(cost),
        details: body.errors,
      });
    }
    if (codes.has("ACCESS_DENIED") || codes.has("SHOP_INACTIVE")) {
      throw new ConnectorError(message, "AUTHENTICATION", { details: body.errors });
    }
    if (codes.has("INTERNAL_SERVER_ERROR")) {
      throw new ConnectorError(message, "RETRYABLE", { details: body.errors });
    }
    throw new ConnectorError(message, "VALIDATION", { details: body.errors });
  }
  if (!body.data) throw new ConnectorError("Shopify returned no data", "UNKNOWN");
  return body.data;
}

/** One authenticated POST to the GraphQL endpoint; gql() classifies the response. */
async function postGraphql(
  ctx: ConnectorContext,
  query: string,
  variables: Record<string, unknown>,
): Promise<Response> {
  const token = await accessToken(ctx);
  return fetch(`https://${shopDomain(ctx)}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
}

/** Throws on the userErrors a 200 response can still be carrying. */
function assertNoUserErrors(errors: UserError[] | undefined, op: string): void {
  if (!errors?.length) return;
  const detail = errors.map((e) => `${e.field?.join(".") ?? "?"}: ${e.message}`).join("; ");
  throw new ConnectorError(`Shopify ${op}: ${detail}`, "VALIDATION", { details: errors });
}

const locationId = (ctx: ConnectorContext, p?: CanonicalProduct): string | undefined =>
  (p?.attributes as any)?.shopify_location_id ?? ctx.config.location_id;

// ------------------------------------------------------------------ mutations

const CREATE_PRODUCT = `
  mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        handle
        onlineStoreUrl
        variants(first: 1) { edges { node { id inventoryItem { id } } } }
      }
      userErrors { field message }
    }
  }`;

/*
 * REMOVE_STANDALONE_VARIANT because productCreate always creates one default
 * variant; with the default strategy it would survive alongside the real
 * variants as a phantom "Default Title" a buyer can order.
 */
const CREATE_VARIANTS = `
  mutation CreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
      productVariants { id sku inventoryItem { id } }
      userErrors { field message }
    }
  }`;

const SET_INVENTORY = `
  mutation SetInventory($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { createdAt }
      userErrors { field message }
    }
  }`;

const UPDATE_PRODUCT = `
  mutation UpdateProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }`;

const VARIANT_BY_SKU = `
  query VariantBySku($query: String!) {
    productVariants(first: 1, query: $query) {
      edges { node { id sku price inventoryItem { id } product { id } } }
    }
  }`;

const UPDATE_VARIANTS = `
  mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }`;

const LIST_ORDERS = `
  query ListOrders($query: String!, $after: String) {
    orders(first: 50, query: $query, sortKey: CREATED_AT, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { displayName email phone }
          shippingAddress { name address1 address2 city province country zip phone }
          lineItems(first: 50) {
            pageInfo { hasNextPage }
            edges {
              node {
                id
                quantity
                sku
                title
                originalUnitPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    }
  }`;

/**
 * A runaway cursor cannot spin forever: 10 pages of 50 is 500 orders per sync
 * window, and a window that misses more than that catches up on the next run.
 */
const MAX_ORDER_PAGES = 10;

/** Shopify sends money as a decimal string; everything here is minor units. */
const cents = (amount: unknown): number => Math.round(Number(amount ?? 0) * 100);

/**
 * Shopify's address object with its nulls dropped.
 *
 * The canonical shape is a flat string map, and a null province on a
 * single-region country should be an absent key rather than the string "null".
 */
function address(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

/** Look a variant up by SKU, which is the only handle the sync engine carries. */
async function variantBySku(ctx: ConnectorContext, sku: string) {
  const data = await gql(ctx, VARIANT_BY_SKU, { query: `sku:'${sku.replace(/'/g, "")}'` });
  const node = data.productVariants?.edges?.[0]?.node;
  if (!node) throw new ConnectorError(`Shopify: no variant with sku ${sku}`, "NOT_FOUND");
  return node as {
    id: string;
    sku: string;
    price: string;
    inventoryItem: { id: string };
    product: { id: string };
  };
}

/**
 * The union of every variant's option names, values in first-seen order.
 *
 * productVariantsBulkCreate can only reference option *values* under options
 * that already exist on the product, so the options themselves must be
 * declared up front in productCreate's productOptions. Order matters twice:
 * option position on the product and value position in the picker both follow
 * this list.
 */
function collectOptions(p: CanonicalProduct): Map<string, string[]> {
  const options = new Map<string, string[]>();
  for (const v of p.variants) {
    for (const [name, value] of Object.entries(v.options)) {
      const values = options.get(name) ?? [];
      const str = String(value);
      if (!values.includes(str)) values.push(str);
      options.set(name, values);
    }
  }
  return options;
}

// ----------------------------------------------------------------- connector

export const shopify: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return { status: "HEALTHY", detail: "mock mode" };
    }
    const data = await gql(ctx, `{ shop { name } }`);
    return { status: "HEALTHY", detail: data.shop?.name };
  },

  async createProduct(ctx, p): Promise<RemoteProduct> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "createProduct");
      const remoteId = mockRemoteId(manifest.idPrefix, p.sku);
      ctx.log(`mock: created Shopify product ${remoteId}`);
      return { remoteId, url: `https://example.myshopify.com/products/${remoteId}` };
    }

    const options = collectOptions(p);

    // 1. the product itself, with its option scheme and media. Media rides on
    //    productCreate's sibling argument — the manifest requires an image, so
    //    the promise has to actually reach the store.
    const media = [...p.images]
      .sort((a, b) => a.position - b.position)
      .map((i) => ({
        originalSource: i.url,
        alt: i.alt || undefined,
        mediaContentType: "IMAGE",
      }));

    const created = await gql(ctx, CREATE_PRODUCT, {
      product: {
        title: p.title,
        descriptionHtml: p.description,
        vendor: p.brand || undefined,
        productType: p.category || undefined,
        status: ctx.config.publish_immediately ? "ACTIVE" : "DRAFT",
        productOptions: options.size
          ? [...options].map(([name, values]) => ({
              name,
              values: values.map((value) => ({ name: value })),
            }))
          : undefined,
      },
      media: media.length ? media : undefined,
    });
    assertNoUserErrors(created.productCreate?.userErrors, "productCreate");

    const product = created.productCreate.product as {
      id: string;
      handle: string;
      onlineStoreUrl?: string;
      variants?: { edges?: Array<{ node: { id: string; inventoryItem: { id: string } } }> };
    };

    // 2. variants, which productCreate no longer accepts. SKU is a property of
    //    the inventory item, not the variant, so it travels inside
    //    inventoryItem — ProductVariantsBulkInput has no top-level sku field.
    let createdVariants: Array<{ sku: string; inventoryItem: { id: string } }>;

    if (options.size) {
      const variants = await gql(ctx, CREATE_VARIANTS, {
        productId: product.id,
        variants: p.variants.map((v) => ({
          price: money(v.priceCents),
          barcode: v.barcode || undefined,
          inventoryItem: { sku: v.sku },
          optionValues: Object.entries(v.options).map(([name, value]) => ({
            optionName: name,
            name: String(value),
          })),
        })),
      });
      assertNoUserErrors(variants.productVariantsBulkCreate?.userErrors, "productVariantsBulkCreate");
      createdVariants = (variants.productVariantsBulkCreate.productVariants ?? []) as Array<{
        sku: string;
        inventoryItem: { id: string };
      }>;
    } else {
      // No options means Shopify's single default variant is the product's
      // only variant — bulk-creating another would just collide with it, so
      // the one productCreate made is updated in place with price and SKU.
      const v = p.variants[0];
      const defaultVariant = product.variants?.edges?.[0]?.node;
      if (!v) {
        createdVariants = [];
      } else if (!defaultVariant) {
        throw new ConnectorError("Shopify productCreate returned no default variant", "UNKNOWN");
      } else {
        const updated = await gql(ctx, UPDATE_VARIANTS, {
          productId: product.id,
          variants: [
            {
              id: defaultVariant.id,
              price: money(v.priceCents),
              barcode: v.barcode || undefined,
              inventoryItem: { sku: v.sku },
            },
          ],
        });
        assertNoUserErrors(updated.productVariantsBulkUpdate?.userErrors, "productVariantsBulkUpdate");
        createdVariants = [{ sku: v.sku, inventoryItem: { id: defaultVariant.inventoryItem.id } }];
      }
    }

    // 3. inventory, which belongs to the item at a location rather than to the
    //    variant. Skipped without a location rather than guessed at.
    const location = locationId(ctx, p);

    if (location && createdVariants.length) {
      const bySku = new Map(p.variants.map((v) => [v.sku, v.available]));
      await gql(ctx, SET_INVENTORY, {
        input: {
          name: "available",
          reason: "correction",
          // Nothing to compare against on a variant created seconds ago, and a
          // compare-and-set against an unknown prior value fails outright.
          ignoreCompareQuantity: true,
          quantities: createdVariants.map((v) => ({
            inventoryItemId: v.inventoryItem.id,
            locationId: location,
            quantity: bySku.get(v.sku) ?? 0,
          })),
        },
      });
    } else if (!location) {
      ctx.log("shopify: no location_id — product created without stock");
    }

    return { remoteId: product.id, url: product.onlineStoreUrl, raw: product };
  },

  async updateProduct(ctx, p, remoteId) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateProduct");
      ctx.log(`mock: updated Shopify product ${remoteId}`);
      return;
    }
    const data = await gql(ctx, UPDATE_PRODUCT, {
      product: {
        id: remoteId,
        title: p.title,
        descriptionHtml: p.description,
        vendor: p.brand || undefined,
      },
    });
    assertNoUserErrors(data.productUpdate?.userErrors, "productUpdate");
  },

  async updateInventory(ctx, u: InventoryUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateInventory");
      ctx.log(`mock: Shopify quantity ${u.sku} -> ${u.available}`);
      return;
    }

    const location = locationId(ctx);
    if (!location) throw new ConnectorError("missing Shopify location_id", "VALIDATION");

    const variant = await variantBySku(ctx, u.sku);
    const data = await gql(ctx, SET_INVENTORY, {
      input: {
        name: "available",
        reason: "correction",
        ignoreCompareQuantity: true,
        quantities: [
          {
            inventoryItemId: variant.inventoryItem.id,
            locationId: location,
            quantity: u.available,
          },
        ],
      },
    });
    assertNoUserErrors(data.inventorySetQuantities?.userErrors, "inventorySetQuantities");
  },

  async updatePrice(ctx, u: PriceUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updatePrice");
      ctx.log(`mock: Shopify price ${u.sku} -> ${money(u.priceCents)}`);
      return;
    }

    const variant = await variantBySku(ctx, u.sku);
    const data = await gql(ctx, UPDATE_VARIANTS, {
      productId: variant.product.id,
      variants: [{ id: variant.id, price: money(u.priceCents) }],
    });
    assertNoUserErrors(data.productVariantsBulkUpdate?.userErrors, "productVariantsBulkUpdate");
  },

  /**
   * Cursor-paginated, because the orders connection returns at most one page.
   *
   * Two limits a caller should know about: each order carries at most the
   * first 50 line items (a longer order is truncated, and logged), and with
   * only the read_orders scope Shopify serves the last 60 days of orders —
   * older history needs read_all_orders, which requires a separate access
   * request, so a first sync of an old store starts 60 days back regardless
   * of the `since` it was asked for.
   */
  async listOrders(ctx, since: Date): Promise<RemoteOrder[]> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return [];
    }

    const out: RemoteOrder[] = [];
    let after: string | null = null;

    for (let page = 0; page < MAX_ORDER_PAGES; page++) {
      const data = await gql(ctx, LIST_ORDERS, {
        query: `created_at:>='${since.toISOString()}'`,
        after,
      });

      const edges = (data.orders?.edges ?? []) as Array<{ node: any }>;
      for (const { node } of edges) {
        // The 50-line-item cap is silent in the data — a truncated order looks
        // exactly like a complete one — so the connection's own pageInfo is
        // the only witness, and it goes to the log by order id.
        if (node.lineItems?.pageInfo?.hasNextPage) {
          ctx.log(`shopify: order ${node.id} has more than 50 line items — the rest were not imported`);
        }
        out.push({
          // The gid, not the "#1001" display name: orders dedupe on source plus
          // external ID, and a shop can renumber its display names.
          externalId: node.id,
          status: node.displayFinancialStatus ?? "",
          currency: node.totalPriceSet?.shopMoney?.currencyCode ?? "USD",
          totalCents: cents(node.totalPriceSet?.shopMoney?.amount),
          placedAt: node.createdAt,
          customer: {
            name: node.customer?.displayName ?? "",
            email: node.customer?.email ?? "",
            phone: node.customer?.phone ?? "",
          },
          shippingAddress: address(node.shippingAddress),
          items: (node.lineItems?.edges ?? []).map(({ node: line }: { node: any }) => ({
            sku: line.sku ?? "",
            title: line.title ?? "",
            quantity: line.quantity ?? 0,
            priceCents: cents(line.originalUnitPriceSet?.shopMoney?.amount),
            remoteItemId: line.id ?? "",
          })),
        });
      }

      const pageInfo = data.orders?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      after = pageInfo.endCursor;
    }

    return out;
  },
};
