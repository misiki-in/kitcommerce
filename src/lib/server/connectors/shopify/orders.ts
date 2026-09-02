/**
 * Shopify order query and pagination via GraphQL.
 */
import type { ConnectorContext, RemoteOrder } from "../../connector";
import { gql } from "./api";
import { SHOPIFY_MAX_ORDER_PAGES } from "./manifest";

export const LIST_ORDERS = `
  query ListOrders($query: String!, $after: String) {
    orders(first: 50, query: $query, sortKey: CREATED_AT, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { displayName email phone }
          shippingAddress { name address1 address2 city province country zip phone }
          lineItems(first: 50) {
            pageInfo { hasNextPage }
            edges {
              node {
                id
                quantity
                sku
                title
                originalUnitPriceSet { shopMoney { amount } }
              }
            }
          }
        }
      }
    }
  }`;

export const cents = (amount: unknown): number => Math.round(Number(amount ?? 0) * 100);

export function address(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string" && value) out[key] = value;
  }
  return out;
}

export async function listOrders(ctx: ConnectorContext, since: Date): Promise<RemoteOrder[]> {
  const out: RemoteOrder[] = [];
  let after: string | null = null;

  for (let page = 0; page < SHOPIFY_MAX_ORDER_PAGES; page++) {
    const data = await gql(ctx, LIST_ORDERS, {
      query: `created_at:>='${since.toISOString()}'`,
      after,
    });

    const edges = (data.orders?.edges ?? []) as Array<{ node: any }>;
    for (const { node } of edges) {
      if (node.lineItems?.pageInfo?.hasNextPage) {
        ctx.log(`shopify: order ${node.id} has more than 50 line items — the rest were not imported`);
      }
      out.push({
        externalId: node.id,
        status: node.displayFinancialStatus ?? "",
        currency: node.totalPriceSet?.shopMoney?.currencyCode ?? "USD",
        totalCents: cents(node.totalPriceSet?.shopMoney?.amount),
        placedAt: node.createdAt,
        customer: {
          name: node.customer?.displayName ?? "",
          email: node.customer?.email ?? "",
          phone: node.customer?.phone ?? "",
        },
        shippingAddress: address(node.shippingAddress),
        items: (node.lineItems?.edges ?? []).map(({ node: line }: { node: any }) => ({
          sku: line.sku ?? "",
          title: line.title ?? "",
          quantity: line.quantity ?? 0,
          priceCents: cents(line.originalUnitPriceSet?.shopMoney?.amount),
          remoteItemId: line.id ?? "",
        })),
      });
    }

    const pageInfo = data.orders?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }

  return out;
}
