/**
 * Amazon SP-API inventory and price synchronization logic.
 */
import { money, type ConnectorContext, type InventoryUpdate, type PriceUpdate } from "../../connector";
import { call, marketplace, rejectInvalid, sellerId } from "./api";

export async function updateInventory(ctx: ConnectorContext, u: InventoryUpdate): Promise<void> {
  const m = marketplace(ctx);
  const body = await call(
    ctx,
    `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(u.sku)}?marketplaceIds=${m.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        productType: ctx.config.default_product_type ?? "PRODUCT",
        patches: [
          {
            op: "replace",
            path: "/attributes/fulfillment_availability",
            value: [
              {
                fulfillment_channel_code: ctx.config.fulfillment ?? "DEFAULT",
                quantity: u.available,
              },
            ],
          },
        ],
      }),
    },
  );
  rejectInvalid(body, "inventory patch");
}

export async function updatePrice(ctx: ConnectorContext, u: PriceUpdate): Promise<void> {
  const m = marketplace(ctx);
  const body = await call(
    ctx,
    `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(u.sku)}?marketplaceIds=${m.id}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        productType: ctx.config.default_product_type ?? "PRODUCT",
        patches: [
          {
            op: "replace",
            path: "/attributes/purchasable_offer",
            value: [
              {
                currency: u.currency,
                our_price: [{ schedule: [{ value_with_tax: Number(money(u.priceCents)) }] }],
                marketplace_id: m.id,
              },
            ],
          },
        ],
      }),
    },
  );
  rejectInvalid(body, "price patch");
}
