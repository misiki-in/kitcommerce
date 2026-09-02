/**
 * TikTok Shop inventory and price update endpoints.
 */
import { money, type ConnectorContext, type InventoryUpdate, type PriceUpdate } from "../../connector";
import { request } from "./api";
import { tiktokSkuId } from "./products";

export async function updateInventory(ctx: ConnectorContext, u: InventoryUpdate): Promise<void> {
  const { id: skuId, warehouseId } = await tiktokSkuId(ctx, u.remoteId, u.sku);
  const warehouse = warehouseId ?? String(ctx.config.tiktok_warehouse_id ?? "");
  await request(ctx, {
    method: "POST",
    path: `/product/202309/products/${encodeURIComponent(u.remoteId)}/inventory/update`,
    body: {
      skus: [
        {
          id: skuId,
          inventory: [
            warehouse
              ? { warehouse_id: warehouse, quantity: u.available }
              : { quantity: u.available },
          ],
        },
      ],
    },
    shopScoped: true,
  });
}

export async function updatePrice(ctx: ConnectorContext, u: PriceUpdate): Promise<void> {
  const { id: skuId } = await tiktokSkuId(ctx, u.remoteId, u.sku);
  await request(ctx, {
    method: "POST",
    path: `/product/202309/products/${encodeURIComponent(u.remoteId)}/prices/update`,
    body: {
      skus: [
        {
          id: skuId,
          price: {
            amount: money(u.priceCents),
            currency: String(ctx.config.currency ?? u.currency),
          },
        },
      ],
    },
    shopScoped: true,
  });
}
