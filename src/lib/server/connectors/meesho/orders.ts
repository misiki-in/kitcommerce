/**
 * Meesho order import polling.
 */
import type { ConnectorContext, RemoteOrder } from "../../connector";
import { call } from "./api";

export async function listOrders(ctx: ConnectorContext, since: Date): Promise<RemoteOrder[]> {
  const body = await call(
    ctx,
    `/v1/orders?from=${encodeURIComponent(since.toISOString())}&limit=50`,
  );
  return (body?.orders ?? []).map((o: any) => ({
    externalId: String(o.order_id),
    status: String(o.status ?? "NEW"),
    currency: "INR",
    totalCents: Math.round(Number(o.total_amount ?? 0) * 100),
    placedAt: o.created_at ?? new Date().toISOString(),
    customer: { name: o.customer_name ?? "", email: "", phone: o.customer_phone ?? "" },
    shippingAddress: o.shipping_address ?? {},
    items: (o.items ?? []).map((it: any) => ({
      sku: it.sku ?? "",
      title: it.product_name ?? "",
      quantity: Number(it.quantity ?? 1),
      priceCents: Math.round(Number(it.price ?? 0) * 100),
      remoteItemId: String(it.item_id ?? ""),
    })),
  }));
}
