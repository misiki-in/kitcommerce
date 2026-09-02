/**
 * TikTok Shop Marketplace Connector.
 */
import type { ConnectorError, MarketplaceConnector } from "../../connector";
import { manifest } from "./manifest";
import { request } from "./api";
import { createProduct, updateProduct } from "./products";
import { updateInventory, updatePrice } from "./inventory";
import { listOrders } from "./orders";

export { manifest } from "./manifest";

export const tiktok: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    try {
      await request(ctx, { method: "GET", path: "/authorization/202309/shops" });
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
