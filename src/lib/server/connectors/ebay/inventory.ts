/**
 * eBay inventory quantity and offer price updates.
 */
import { ConnectorError, money, type ConnectorContext, type InventoryUpdate, type PriceUpdate } from "../../connector";
import { call, marketplaceId } from "./api";

export async function updateInventory(ctx: ConnectorContext, u: InventoryUpdate): Promise<void> {
  await call(ctx, "/sell/inventory/v1/bulk_update_price_quantity", {
    method: "POST",
    body: JSON.stringify({
      requests: [{ sku: u.sku, shipToLocationAvailability: { quantity: u.available } }],
    }),
  });
}

export async function updatePrice(ctx: ConnectorContext, u: PriceUpdate): Promise<void> {
  const found = await call(ctx, `/sell/inventory/v1/offer?sku=${encodeURIComponent(u.sku)}`);
  const offer = (found?.offers ?? []).find((o: any) => o.marketplaceId === marketplaceId(ctx));
  if (!offer?.offerId) {
    throw new ConnectorError(
      `no eBay offer exists for SKU ${u.sku} on ${marketplaceId(ctx)}`,
      "NOT_FOUND",
    );
  }
  await call(ctx, "/sell/inventory/v1/bulk_update_price_quantity", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          sku: u.sku,
          offers: [
            {
              offerId: offer.offerId,
              price: { value: money(u.priceCents), currency: u.currency },
            },
          ],
        },
      ],
    }),
  });
}
