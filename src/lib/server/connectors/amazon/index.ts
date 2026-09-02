/**
 * Amazon SP-API Marketplace Connector.
 */
import type { ConnectorError, MarketplaceConnector } from "../../connector";
import { manifest, AMAZON_MARKETPLACES } from "./manifest";
import { call, marketplace } from "./api";
import { createProduct, updateProduct } from "./products";
import { updateInventory, updatePrice } from "./inventory";
import { listOrders } from "./orders";

export { manifest, AMAZON_MARKETPLACES as MARKETPLACES } from "./manifest";

export const amazon: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    try {
      const m = marketplace(ctx);
      await call(ctx, `/sellers/v1/marketplaceParticipations`);
      return { status: "HEALTHY", detail: `${m.id}` };
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
