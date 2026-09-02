/**
 * Shopify inventory and price updates via GraphQL.
 */
import { ConnectorError, money, type ConnectorContext, type InventoryUpdate, type PriceUpdate } from "../../connector";
import { assertNoUserErrors, gql, locationId } from "./api";
import { SET_INVENTORY, UPDATE_VARIANTS } from "./products";

export const VARIANT_BY_SKU = `
  query VariantBySku($query: String!) {
    productVariants(first: 1, query: $query) {
      edges { node { id sku price inventoryItem { id } product { id } } }
    }
  }`;

export async function variantBySku(ctx: ConnectorContext, sku: string) {
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

export async function updateInventory(ctx: ConnectorContext, u: InventoryUpdate): Promise<void> {
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
}

export async function updatePrice(ctx: ConnectorContext, u: PriceUpdate): Promise<void> {
  const variant = await variantBySku(ctx, u.sku);
  const data = await gql(ctx, UPDATE_VARIANTS, {
    productId: variant.product.id,
    variants: [{ id: variant.id, price: money(u.priceCents) }],
  });
  assertNoUserErrors(data.productVariantsBulkUpdate?.userErrors, "productVariantsBulkUpdate");
}
