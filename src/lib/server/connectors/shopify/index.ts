/**
 * Shopify GraphQL Marketplace Connector.
 */
import type { MarketplaceConnector } from "../../connector";
import { manifest } from "./manifest";
import { gql } from "./api";
import { createProduct, updateProduct } from "./products";
import { updateInventory, updatePrice } from "./inventory";
import { listOrders } from "./orders";

export { manifest } from "./manifest";

export const shopify: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    const data = await gql(ctx, `{ shop { name } }`);
    return { status: "HEALTHY", detail: data.shop?.name };
  },

  createProduct,
  updateProduct,
  updateInventory,
  updatePrice,
  listOrders,
};
