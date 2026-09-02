/**
 * eBay order import via Fulfillment API.
 */
import type { ConnectorContext, RemoteOrder } from "../../connector";
import { call } from "./api";
import { EBAY_ORDER_MAX_PAGES, EBAY_ORDER_PAGE_SIZE } from "./manifest";

export async function listOrders(ctx: ConnectorContext, since: Date): Promise<RemoteOrder[]> {
  const filter = `creationdate:[${since.toISOString()}..]`;
  const orders: any[] = [];

  for (let page = 0; page < EBAY_ORDER_MAX_PAGES; page++) {
    const body = await call(
      ctx,
      `/sell/fulfillment/v1/order?filter=${encodeURIComponent(filter)}&limit=${EBAY_ORDER_PAGE_SIZE}&offset=${page * EBAY_ORDER_PAGE_SIZE}`,
    );
    const batch = body?.orders ?? [];
    orders.push(...batch);
    if (batch.length === 0 || !body?.next) break;
  }

  return orders.map((o: any) => {
    const ship = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
    const addr = ship?.contactAddress ?? {};
    return {
      externalId: String(o.orderId),
      status: String(o.orderFulfillmentStatus ?? "NEW"),
      currency: o.pricingSummary?.total?.currency ?? "USD",
      totalCents: Math.round(Number(o.pricingSummary?.total?.value ?? 0) * 100),
      placedAt: o.creationDate ?? new Date().toISOString(),
      customer: {
        name:
          o.buyer?.buyerRegistrationAddress?.fullName ??
          ship?.fullName ??
          o.buyer?.username ??
          "",
        email: o.buyer?.buyerRegistrationAddress?.email ?? "",
        phone: ship?.primaryPhone?.phoneNumber ?? "",
      },
      shippingAddress: {
        line1: addr.addressLine1 ?? "",
        line2: addr.addressLine2 ?? "",
        city: addr.city ?? "",
        state: addr.stateOrProvince ?? "",
        postalCode: addr.postalCode ?? "",
        country: addr.countryCode ?? "",
      },
      items: (o.lineItems ?? []).map((li: any) => {
        const quantity = Number(li.quantity ?? 1);
        return {
          sku: li.sku ?? "",
          title: li.title ?? "",
          quantity,
          priceCents:
            quantity > 0
              ? Math.round((Number(li.lineItemCost?.value ?? 0) * 100) / quantity)
              : 0,
          remoteItemId: String(li.lineItemId ?? ""),
        };
      }),
    };
  });
}
