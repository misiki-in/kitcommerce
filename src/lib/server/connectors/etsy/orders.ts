/**
 * Etsy order import logic.
 */
import type { ConnectorContext, RemoteOrder } from "../../connector";
import { call, shopId } from "./api";
import { ETSY_MAX_ORDER_PAGES, ETSY_ORDER_PAGE_LIMIT } from "./manifest";

export async function listOrders(ctx: ConnectorContext, since: Date): Promise<RemoteOrder[]> {
  const minCreated = Math.floor(since.getTime() / 1000);
  const limit = ETSY_ORDER_PAGE_LIMIT;
  const receipts: any[] = [];

  for (let page = 0; page < ETSY_MAX_ORDER_PAGES; page++) {
    const body = await call(
      ctx,
      `/shops/${shopId(ctx)}/receipts?min_created=${minCreated}&limit=${limit}&offset=${page * limit}`,
    );
    const results = body?.results ?? [];
    receipts.push(...results);
    if (results.length < limit) break;
  }

  return receipts.map((r: any) => ({
    externalId: String(r.receipt_id),
    status: r.status ?? "NEW",
    currency: r.total_price?.currency_code ?? "USD",
    totalCents: Math.round(
      (Number(r.total_price?.amount ?? 0) / Number(r.total_price?.divisor ?? 100)) * 100,
    ),
    placedAt: new Date(Number(r.created_timestamp ?? 0) * 1000).toISOString(),
    customer: { name: r.name ?? "", email: r.buyer_email ?? "", phone: "" },
    shippingAddress: {
      line1: r.first_line ?? "",
      line2: r.second_line ?? "",
      city: r.city ?? "",
      state: r.state ?? "",
      postalCode: r.zip ?? "",
      country: r.country_iso ?? "",
    },
    items: (r.transactions ?? []).map((t: any) => ({
      sku: t.sku ?? "",
      title: t.title ?? "",
      quantity: Number(t.quantity ?? 1),
      priceCents: Math.round(
        (Number(t.price?.amount ?? 0) / Number(t.price?.divisor ?? 100)) * 100,
      ),
      remoteItemId: String(t.transaction_id ?? ""),
    })),
  }));
}
