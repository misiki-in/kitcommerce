/**
 * Amazon SP-API Orders polling and line-item fetch logic.
 */
import type { ConnectorContext, ConnectorError, RemoteOrder } from "../../connector";
import { call, marketplace, restrictedToken, sleep } from "./api";
import { AMAZON_ITEM_BURST_HEADROOM, AMAZON_ITEM_PACE_MS, AMAZON_ORDER_PAGE_CAP } from "./manifest";

export async function listOrders(ctx: ConnectorContext, since: Date): Promise<RemoteOrder[]> {
  const m = marketplace(ctx);
  const rdt = await restrictedToken(ctx);
  const auth = rdt ? { "x-amz-access-token": rdt } : undefined;

  const orders: any[] = [];
  let next: string | undefined;

  for (let page = 0; page < AMAZON_ORDER_PAGE_CAP; page++) {
    const query = next
      ? `MarketplaceIds=${m.id}&NextToken=${encodeURIComponent(next)}`
      : `MarketplaceIds=${m.id}&CreatedAfter=${encodeURIComponent(since.toISOString())}&MaxResultsPerPage=50`;
    const body = await call(ctx, `/orders/v0/orders?${query}`, { headers: auth });
    orders.push(...(body?.payload?.Orders ?? []));
    next = body?.payload?.NextToken;
    if (!next) break;
  }

  if (next) {
    ctx.log(
      `amazon: order pagination capped at ${AMAZON_ORDER_PAGE_CAP} pages; more orders remain in the window`,
    );
  }

  const out: RemoteOrder[] = [];
  for (const [i, o] of orders.entries()) {
    if (i >= AMAZON_ITEM_BURST_HEADROOM) await sleep(AMAZON_ITEM_PACE_MS);
    let items: RemoteOrder["items"] = [];
    try {
      const li = await call(ctx, `/orders/v0/orders/${o.AmazonOrderId}/orderItems`);
      items = (li?.payload?.OrderItems ?? []).map((it: any) => ({
        sku: it.SellerSKU ?? "",
        title: it.Title ?? "",
        quantity: Number(it.QuantityOrdered ?? 1),
        priceCents: Math.round(Number(it.ItemPrice?.Amount ?? 0) * 100),
        remoteItemId: String(it.OrderItemId ?? ""),
      }));
    } catch (e) {
      const err = e as ConnectorError;
      ctx.log(`order ${o.AmazonOrderId}: line items not fetched (${err.class}): ${err.message}`);
    }

    out.push({
      externalId: String(o.AmazonOrderId),
      status: String(o.OrderStatus ?? "NEW"),
      currency: o.OrderTotal?.CurrencyCode ?? m.currency,
      totalCents: Math.round(Number(o.OrderTotal?.Amount ?? 0) * 100),
      placedAt: o.PurchaseDate ?? new Date().toISOString(),
      customer: {
        name: o.BuyerInfo?.BuyerName ?? "",
        email: o.BuyerInfo?.BuyerEmail ?? "",
        phone: "",
      },
      shippingAddress: o.ShippingAddress ?? {},
      items,
    });
  }
  return out;
}
