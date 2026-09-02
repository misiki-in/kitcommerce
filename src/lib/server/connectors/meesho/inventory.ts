/**
 * Meesho inventory and price update endpoints.
 */
import { money, type ConnectorContext, type InventoryUpdate, type PriceUpdate } from "../../connector";
import { call } from "./api";

export async function updateInventory(ctx: ConnectorContext, u: InventoryUpdate): Promise<void> {
  await call(ctx, "/v1/inventory", {
    method: "POST",
    body: JSON.stringify({ updates: [{ sku: u.sku, stock: u.available }] }),
  });
}

export async function updatePrice(ctx: ConnectorContext, u: PriceUpdate): Promise<void> {
  await call(ctx, "/v1/prices", {
    method: "POST",
    body: JSON.stringify({
      updates: [{ sku: u.sku, price: money(u.priceCents), mrp: money(u.mrpCents) }],
    }),
  });
}
