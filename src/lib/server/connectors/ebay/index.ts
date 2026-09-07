/**
 * eBay Marketplace Connector.
 */
import type { ConnectorError, MarketplaceConnector } from "../../connector";
import { manifest } from "./manifest";
import { accessToken, discoverAllEbayResources } from "./api";
import { createProduct, updateProduct } from "./products";
import { updateInventory, updatePrice } from "./inventory";
import { listOrders } from "./orders";

export { manifest } from "./manifest";
export { discoverAllEbayResources, accessToken, base, marketplaceId } from "./api";
export { taxonomyIdForEbayCategory, EBAY_CATEGORY_TAXONOMY_MAP } from "./taxonomy";

export const ebay: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    try {
      await accessToken(ctx);
      // Auto-discover policies if not configured
      if (
        !ctx.config.ebay_fulfillment_policy_id ||
        !ctx.config.ebay_return_policy_id ||
        !ctx.config.ebay_payment_policy_id
      ) {
        try {
          const disc = await discoverAllEbayResources(ctx);
          if (disc.defaultFulfillmentPolicyId) {
            ctx.config.ebay_fulfillment_policy_id = disc.defaultFulfillmentPolicyId;
          }
          if (disc.defaultReturnPolicyId) {
            ctx.config.ebay_return_policy_id = disc.defaultReturnPolicyId;
          }
          if (disc.defaultPaymentPolicyId) {
            ctx.config.ebay_payment_policy_id = disc.defaultPaymentPolicyId;
          }
          if (disc.defaultMerchantLocationKey) {
            ctx.config.ebay_merchant_location_key = disc.defaultMerchantLocationKey;
          }
        } catch {}
      }
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
  discover: discoverAllEbayResources,
};

