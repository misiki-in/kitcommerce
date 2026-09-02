/**
 * Etsy inventory and price synchronization logic.
 */
import { money, type ConnectorContext, type InventoryUpdate, type PriceUpdate } from "../../connector";
import { call } from "./api";

export const writablePropertyValues = (propertyValues: any[]): any[] =>
  (propertyValues ?? []).map((pv: any) => ({
    property_id: pv.property_id,
    property_name: pv.property_name,
    scale_id: pv.scale_id ?? undefined,
    value_ids: pv.value_ids ?? [],
    values: pv.values ?? [],
  }));

export function skuMatcher(products: any[], sku: string): (prod: any) => boolean {
  if (products.some((prod) => prod.sku === sku)) return (prod) => prod.sku === sku;
  if (products.length === 1) return () => true;
  return () => false;
}

export const onPropertyFields = (inv: any) => ({
  price_on_property: inv?.price_on_property ?? [],
  quantity_on_property: inv?.quantity_on_property ?? [],
  sku_on_property: inv?.sku_on_property ?? [],
  readiness_state_on_property: inv?.readiness_state_on_property ?? [],
});

export async function updateInventory(ctx: ConnectorContext, u: InventoryUpdate): Promise<void> {
  const inv = await call(ctx, `/listings/${u.remoteId}/inventory`);
  const targets = skuMatcher(inv?.products ?? [], u.sku);
  const products = (inv?.products ?? []).map((prod: any) => ({
    sku: prod.sku,
    property_values: writablePropertyValues(prod.property_values),
    offerings: (prod.offerings ?? []).map((o: any) => ({
      price: Number(o.price?.amount ?? 0) / Number(o.price?.divisor ?? 100),
      quantity: targets(prod) ? u.available : o.quantity,
      is_enabled: o.is_enabled ?? true,
    })),
  }));
  await call(ctx, `/listings/${u.remoteId}/inventory`, {
    method: "PUT",
    body: JSON.stringify({ products, ...onPropertyFields(inv) }),
  });
}

export async function updatePrice(ctx: ConnectorContext, u: PriceUpdate): Promise<void> {
  const inv = await call(ctx, `/listings/${u.remoteId}/inventory`);
  const targets = skuMatcher(inv?.products ?? [], u.sku);
  const products = (inv?.products ?? []).map((prod: any) => ({
    sku: prod.sku,
    property_values: writablePropertyValues(prod.property_values),
    offerings: (prod.offerings ?? []).map((o: any) => ({
      price: targets(prod) ? Number(money(u.priceCents)) : Number(o.price?.amount ?? 0) / Number(o.price?.divisor ?? 100),
      quantity: o.quantity,
      is_enabled: o.is_enabled ?? true,
    })),
  }));
  await call(ctx, `/listings/${u.remoteId}/inventory`, {
    method: "PUT",
    body: JSON.stringify({ products, ...onPropertyFields(inv) }),
  });
}
