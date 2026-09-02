/**
 * Etsy Marketplace Connector.
 */
import type { ConnectorError, MarketplaceConnector } from "../../connector";
import { manifest } from "./manifest";
import { call, shopId, deleteEtsyListing, discoverAllEtsyResources } from "./api";
import { createProduct, updateProduct } from "./products";
import { updateInventory, updatePrice } from "./inventory";
import { listOrders } from "./orders";

export { manifest } from "./manifest";
export {
  getShippingProfiles,
  getReturnPolicies,
  getMeShops,
  getShopDetails,
  uploadListingImage,
  discoverAllEtsyResources,
  deleteEtsyListing,
} from "./api";
export { taxonomyIdForCategory, CATEGORY_TAXONOMY_MAP } from "./taxonomy";

export const etsy: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    try {
      let targetShopId = ctx.config.shop_id;
      if (!targetShopId) {
        // Auto-discover shop ID if not configured yet
        try {
          const discovery = await discoverAllEtsyResources(ctx);
          if (discovery.shopId) {
            targetShopId = discovery.shopId;
            ctx.config.shop_id = String(discovery.shopId);
          }
        } catch {}
      }

      if (!targetShopId) {
        throw new ConnectorError("channel config is missing shop_id", "VALIDATION");
      }

      await call(ctx, `/shops/${targetShopId}`);
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
  deleteProduct: deleteEtsyListing,
  updateInventory,
  updatePrice,
  listOrders,
  discover: discoverAllEtsyResources,
};
