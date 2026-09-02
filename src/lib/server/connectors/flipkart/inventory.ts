/**
 * Flipkart inventory and price updates via v3 endpoints.
 */
import { money, type ConnectorContext, type InventoryUpdate, type PriceUpdate } from "../../connector";
import { call, checkSkuResult, locationId, resolveFsn } from "./api";

export async function updateInventory(ctx: ConnectorContext, u: InventoryUpdate): Promise<void> {
  const fsn = await resolveFsn(ctx, u.sku);
  const body = await call(ctx, "/sellers/listings/v3/update/inventory", {
    method: "POST",
    body: JSON.stringify({
      [u.sku]: {
        product_id: fsn,
        locations: [{ id: locationId(ctx), inventory: u.available }],
      },
    }),
  });
  checkSkuResult(ctx, body, u.sku, "inventory update");
}

export async function updatePrice(ctx: ConnectorContext, u: PriceUpdate): Promise<void> {
  const fsn = await resolveFsn(ctx, u.sku);
  const body = await call(ctx, "/sellers/listings/v3/update/price", {
    method: "POST",
    body: JSON.stringify({
      [u.sku]: {
        product_id: fsn,
        price: {
          mrp: Number(money(u.mrpCents)),
          selling_price: Number(money(u.priceCents)),
          currency: u.currency,
        },
      },
    }),
  });
  checkSkuResult(ctx, body, u.sku, "price update");
}
