/**
 * Shopify product and variant GraphQL mutations.
 */
import { ConnectorError, money, type CanonicalProduct, type ConnectorContext, type RemoteProduct } from "../../connector";
import { assertNoUserErrors, gql, locationId } from "./api";

export const CREATE_PRODUCT = `
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

export const CREATE_VARIANTS = `
  mutation CreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
      productVariants { id sku inventoryItem { id } }
      userErrors { field message }
    }
  }`;

export const SET_INVENTORY = `
  mutation SetInventory($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      inventoryAdjustmentGroup { createdAt }
      userErrors { field message }
    }
  }`;

export const UPDATE_PRODUCT = `
  mutation UpdateProduct($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product { id }
      userErrors { field message }
    }
  }`;

export const UPDATE_VARIANTS = `
  mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }`;

export function collectOptions(p: CanonicalProduct): Map<string, string[]> {
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

export async function createProduct(ctx: ConnectorContext, p: CanonicalProduct): Promise<RemoteProduct> {
  const options = collectOptions(p);

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

  const location = locationId(ctx, p);

  if (location && createdVariants.length) {
    const bySku = new Map(p.variants.map((v) => [v.sku, v.available]));
    await gql(ctx, SET_INVENTORY, {
      input: {
        name: "available",
        reason: "correction",
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
}

export async function updateProduct(ctx: ConnectorContext, p: CanonicalProduct, remoteId: string): Promise<void> {
  const data = await gql(ctx, UPDATE_PRODUCT, {
    product: {
      id: remoteId,
      title: p.title,
      descriptionHtml: p.description,
      vendor: p.brand || undefined,
    },
  });
  assertNoUserErrors(data.productUpdate?.userErrors, "productUpdate");
}
