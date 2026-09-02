/**
 * TikTok Shop order search and retrieval logic.
 */
import type { ConnectorContext, RemoteOrder } from "../../connector";
import { request } from "./api";

export async function listOrders(ctx: ConnectorContext, since: Date): Promise<RemoteOrder[]> {
  const createTimeGe = Math.floor(since.getTime() / 1000);
  const raw: any[] = [];
  let pageToken = "";

  for (let page = 0; page < 10; page++) {
    const query: Record<string, string> = { page_size: "50" };
    if (pageToken) query.page_token = pageToken;
    const data = await request(ctx, {
      method: "POST",
      path: "/order/202309/orders/search",
      query,
      body: { create_time_ge: createTimeGe },
      shopScoped: true,
    });
    raw.push(...(data?.orders ?? []));
    pageToken = String(data?.next_page_token ?? "");
    if (!pageToken) break;
  }

  return raw.map((o: any): RemoteOrder => {
    const addr = o.recipient_address ?? {};
    const placed = Number(o.create_time);
    return {
      externalId: String(o.id ?? ""),
      status: String(o.status ?? o.order_status ?? "NEW"),
      currency: String(o.payment?.currency ?? "USD"),
      totalCents: Math.round(Number(o.payment?.total_amount ?? 0) * 100),
      placedAt:
        Number.isFinite(placed) && placed > 0
          ? new Date(placed * 1000).toISOString()
          : new Date().toISOString(),
      customer: {
        name: String(addr.name ?? ""),
        email: String(o.buyer_email ?? ""),
        phone: String(addr.phone_number ?? ""),
      },
      shippingAddress: {
        line1: String(addr.address_line1 ?? ""),
        line2: String(addr.address_line2 ?? ""),
        city: String(addr.city ?? ""),
        state: String(addr.state ?? ""),
        postalCode: String(addr.postal_code ?? ""),
        country: String(addr.region_code ?? ""),
      },
      items: (o.line_items ?? []).map((it: any) => ({
        sku: String(it.seller_sku ?? ""),
        title: String(it.product_name ?? ""),
        quantity: Number(it.quantity ?? 1),
        priceCents: Math.round(Number(it.sale_price ?? 0) * 100),
        remoteItemId: String(it.id ?? ""),
      })),
    };
  });
}
