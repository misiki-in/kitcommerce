/**
 * Flipkart shipment/order import via preDispatch filters.
 */
import type { ConnectorContext, RemoteOrder } from "../../connector";
import { call, nextPagePath } from "./api";
import { FLIPKART_DEFAULT_PAGE_SIZE, FLIPKART_MAX_ORDER_PAGES } from "./manifest";

export async function listOrders(ctx: ConnectorContext, since: Date): Promise<RemoteOrder[]> {
  const orders = new Map<string, RemoteOrder>();
  let init: RequestInit | undefined = {
    method: "POST",
    body: JSON.stringify({
      filter: {
        type: "preDispatch",
        states: ["APPROVED", "PACKING_IN_PROGRESS"],
        orderDate: { from: since.toISOString(), to: new Date().toISOString() },
      },
      pagination: { pageSize: FLIPKART_DEFAULT_PAGE_SIZE },
    }),
  };
  let next: string | null = "/sellers/v3/shipments/filter";

  for (let page = 0; next && page < FLIPKART_MAX_ORDER_PAGES; page++) {
    const body = await call(ctx, next, init);
    init = undefined;

    for (const shipment of body?.shipments ?? []) {
      for (const o of shipment?.orderItems ?? []) {
        const orderId = String(o?.orderId ?? "");
        if (!orderId) continue;
        const priceCents = Math.round(Number(o.priceComponents?.sellingPrice ?? 0) * 100);
        let order = orders.get(orderId);
        if (!order) {
          order = {
            externalId: orderId,
            status: String(o.status ?? "NEW"),
            currency: "INR",
            totalCents: 0,
            placedAt: o.orderDate ?? new Date().toISOString(),
            customer: { name: "", email: "", phone: "" },
            shippingAddress: {},
            items: [],
          };
          orders.set(orderId, order);
        }
        order.items.push({
          sku: o.sku ?? "",
          title: o.title ?? "",
          quantity: Number(o.quantity ?? 1),
          priceCents,
          remoteItemId: String(o.orderItemId ?? ""),
        });
        order.totalCents += priceCents;
      }
    }

    next =
      body?.hasMore && typeof body?.nextPageUrl === "string" && body.nextPageUrl
        ? nextPagePath(body.nextPageUrl)
        : null;
  }

  if (next) {
    ctx.log(
      `flipkart: order sync stopped at the ${FLIPKART_MAX_ORDER_PAGES}-page cap with more shipments pending — results are partial until the next sync`,
    );
  }

  return [...orders.values()];
}
