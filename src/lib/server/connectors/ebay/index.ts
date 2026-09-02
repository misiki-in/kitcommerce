/**
 * eBay Marketplace Connector.
 */
import type { ConnectorError, MarketplaceConnector } from "../../connector";
import { manifest } from "./manifest";
import { accessToken } from "./api";
import { createProduct, updateProduct } from "./products";
import { updateInventory, updatePrice } from "./inventory";
import { listOrders } from "./orders";

export { manifest } from "./manifest";

export const ebay: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    try {
      await accessToken(ctx);
      return { status: "HEALTHY" };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        status: err.class === "AUTHENTICATION" ? "AUTH_FAILURE" : "API_FAILURE",
        detail: err.message,
      };
    }
  },

  createProduct,
  updateProduct,
  updateInventory,
  updatePrice,
  listOrders,
};
