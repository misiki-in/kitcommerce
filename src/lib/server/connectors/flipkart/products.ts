/**
 * Flipkart product listing attachment and payload builders.
 */
import { ConnectorError, money, type CanonicalProduct, type ConnectorContext, type RemoteProduct } from "../../connector";
import { call, checkSkuResult, fsnCache, fsnKey, locationId } from "./api";

export function toListing(ctx: ConnectorContext, p: CanonicalProduct) {
  const fsn = (p.attributes as any).flipkart_fsn;
  if (!fsn) {
    throw new ConnectorError(
      "attributes.flipkart_fsn is required — the v3 Listing API attaches offers to existing catalogue products",
      "VALIDATION",
    );
  }
  const v = p.variants[0];
  return {
    product_id: String(fsn),
    price: {
      mrp: Number(money(v?.mrpCents ?? 0)),
      selling_price: Number(money(v?.priceCents ?? 0)),
      currency: v?.currency ?? ctx.seller.currency,
    },
    tax: {
      hsn: p.hsnCode,
      is_gst_sellable: true,
      goods_services_rate: Number((p.attributes as any).gst_percentage ?? p.taxRateBp / 100),
    },
    listing_status: "ACTIVE",
    fulfillment_profile: ctx.config.fulfillment_profile ?? "NON_FBF",
    fulfillment: { dispatch_sla: Number(ctx.config.dispatch_sla ?? 2) },
    packages: [
      {
        id: `pkg-${p.sku}`,
        dimensions: {
          length: (p.lengthMm || 0) / 10,
          breadth: (p.widthMm || 0) / 10,
          height: (p.heightMm || 0) / 10,
        },
        weight: (v?.weightG || p.weightG || 0) / 1000,
      },
    ],
    locations: [{ id: locationId(ctx), inventory: v?.available ?? 0 }],
  };
}

export async function createProduct(ctx: ConnectorContext, p: CanonicalProduct): Promise<RemoteProduct> {
  const listing = toListing(ctx, p);
  const body = await call(ctx, "/sellers/listings/v3", {
    method: "POST",
    body: JSON.stringify({ [p.sku]: listing }),
  });
  checkSkuResult(ctx, body, p.sku, "listing create");
  fsnCache.set(fsnKey(ctx, p.sku), listing.product_id);
  return { remoteId: p.sku, raw: body };
}

export async function updateProduct(ctx: ConnectorContext, p: CanonicalProduct, remoteId: string): Promise<void> {
  const listing = toListing(ctx, p);
  const body = await call(ctx, "/sellers/listings/v3/update", {
    method: "POST",
    body: JSON.stringify({ [p.sku]: listing }),
  });
  checkSkuResult(ctx, body, p.sku, "listing update");
  fsnCache.set(fsnKey(ctx, p.sku), listing.product_id);
}
