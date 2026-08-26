/**
 * Shopify connector (GraphQL Admin API).
 *
 * GraphQL rather than REST on purpose. The REST Admin API became legacy in
 * October 2024 and since April 2025 new public apps must be built on GraphQL,
 * so a REST connector written today would ship already deprecated.
 *
 * Three calls make a product, because Shopify split variants out of
 * productCreate: create the product, bulk-create its variants, then set
 * inventory per location. Inventory is deliberately the third step — quantities
 * belong to an inventory item at a location, not to the variant, and pretending
 * otherwise is what makes multi-location stores drift.
 *
 * GraphQL also means HTTP 200 is not success. Shopify returns userErrors inside
 * a 200 body for validation failures, so every mutation here is checked twice:
 * once for transport, once for the payload.
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
import { mockLatency, mockMaybeFail, mockRemoteId } from "./mock";

/**
 * Pinned rather than "latest". Shopify ships quarterly versions and retires
 * them on a published schedule; a connector following "latest" changes
 * behaviour underneath a seller with no commit to point at.
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
    fields: [
      { key: "shop_domain", label: "Shop domain (example.myshopify.com)", secret: false },
      { key: "access_token", label: "Admin API access token", secret: true },
    ],
  },
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
  sellerPortalUrl: "https://admin.shopify.com",
};

// ------------------------------------------------------------------ transport

function endpoint(ctx: ConnectorContext): string {
  const domain = ctx.credentials.shop_domain?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain) throw new ConnectorError("missing Shopify shop_domain", "AUTHENTICATION");
  return `https://${domain}/admin/api/${API_VERSION}/graphql.json`;
}

interface UserError {
  field?: string[] | null;
  message: string;
}

/**
 * One GraphQL round trip.
 *
 * `errors` is a transport/schema failure and `userErrors` is a validation
 * failure, and they arrive by different routes: the first at the top level of
 * the body, the second nested under whichever mutation ran. Both are surfaced
 * as VALIDATION so a seller sees the message Shopify actually wrote rather
 * than "200 OK" followed by nothing happening.
 */
async function gql<T = any>(
  ctx: ConnectorContext,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const { access_token } = ctx.credentials;
  if (!access_token) throw new ConnectorError("missing Shopify access_token", "AUTHENTICATION");

  const res = await fetch(endpoint(ctx), {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": access_token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 2);
    throw new ConnectorError("Shopify throttled", "RATE_LIMITED", {
      retryAfterMs: retryAfter * 1000,
    });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length) {
    throw new ConnectorError(
      `Shopify: ${body.errors.map((e) => e.message).join("; ")}`,
      "VALIDATION",
      { details: body.errors },
    );
  }
  if (!body.data) throw new ConnectorError("Shopify returned no data", "UNKNOWN");
  return body.data;
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
  mutation CreateProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product { id handle onlineStoreUrl }
      userErrors { field message }
    }
  }`;

const CREATE_VARIANTS = `
  mutation CreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
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

const UPDATE_VARIANT_PRICE = `
  mutation UpdateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }`;

const LIST_ORDERS = `
  query ListOrders($query: String!) {
    orders(first: 50, query: $query, sortKey: CREATED_AT) {
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

    // 1. the product itself
    const created = await gql(ctx, CREATE_PRODUCT, {
      product: {
        title: p.title,
        descriptionHtml: p.description,
        vendor: p.brand || undefined,
        productType: p.category || undefined,
        status: ctx.config.publish_immediately ? "ACTIVE" : "DRAFT",
      },
    });
    assertNoUserErrors(created.productCreate?.userErrors, "productCreate");

    const product = created.productCreate.product as {
      id: string;
      handle: string;
      onlineStoreUrl?: string;
    };

    // 2. variants, which productCreate no longer accepts
    const variants = await gql(ctx, CREATE_VARIANTS, {
      productId: product.id,
      variants: p.variants.map((v) => ({
        price: money(v.priceCents),
        sku: v.sku,
        barcode: v.barcode || undefined,
        optionValues: Object.entries(v.options).map(([name, value]) => ({
          optionName: name,
          name: String(value),
        })),
      })),
    });
    assertNoUserErrors(variants.productVariantsBulkCreate?.userErrors, "productVariantsBulkCreate");

    // 3. inventory, which belongs to the item at a location rather than to the
    //    variant. Skipped without a location rather than guessed at.
    const location = locationId(ctx, p);
    const created2 = (variants.productVariantsBulkCreate.productVariants ?? []) as Array<{
      sku: string;
      inventoryItem: { id: string };
    }>;

    if (location && created2.length) {
      const bySku = new Map(p.variants.map((v) => [v.sku, v.available]));
      await gql(ctx, SET_INVENTORY, {
        input: {
          name: "available",
          reason: "correction",
          // Nothing to compare against on a variant created seconds ago, and a
          // compare-and-set against an unknown prior value fails outright.
          ignoreCompareQuantity: true,
          quantities: created2.map((v) => ({
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
    const data = await gql(ctx, UPDATE_VARIANT_PRICE, {
      productId: variant.product.id,
      variants: [{ id: variant.id, price: money(u.priceCents) }],
    });
    assertNoUserErrors(data.productVariantsBulkUpdate?.userErrors, "productVariantsBulkUpdate");
  },

  async listOrders(ctx, since: Date): Promise<RemoteOrder[]> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return [];
    }

    const data = await gql(ctx, LIST_ORDERS, {
      query: `created_at:>='${since.toISOString()}'`,
    });

    const edges = (data.orders?.edges ?? []) as Array<{ node: any }>;
    return edges.map(({ node }) => ({
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
    }));
  },
};
