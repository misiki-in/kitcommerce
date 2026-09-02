/**
 * Meesho catalogue creation and update.
 */
import { money, type CanonicalProduct, type ConnectorContext, type RemoteProduct } from "../../connector";
import { call } from "./api";

export function toCatalog(ctx: ConnectorContext, p: CanonicalProduct) {
  return {
    supplier_id: ctx.credentials.supplier_id,
    product_name: p.title,
    description: p.description,
    brand: p.brand,
    category: p.category,
    hsn_code: p.hsnCode,
    gst_percentage: Number((p.attributes as any).gst_percentage ?? p.taxRateBp / 100),
    country_of_origin: (p.attributes as any).country_of_origin ?? "IN",
    images: p.images.map((i) => i.url),
    variations: p.variants.map((v) => ({
      sku: v.sku,
      options: v.options,
      mrp: money(v.mrpCents),
      price: money(v.priceCents),
      stock: v.available,
      weight_gm: v.weightG || p.weightG,
    })),
  };
}

export async function createProduct(ctx: ConnectorContext, p: CanonicalProduct): Promise<RemoteProduct> {
  const body = await call(ctx, "/v1/catalogs", {
    method: "POST",
    body: JSON.stringify(toCatalog(ctx, p)),
  });
  return { remoteId: String(body?.catalog_id ?? p.sku), raw: body };
}

export async function updateProduct(ctx: ConnectorContext, p: CanonicalProduct, remoteId: string): Promise<void> {
  await call(ctx, `/v1/catalogs/${encodeURIComponent(remoteId)}`, {
    method: "PUT",
    body: JSON.stringify(toCatalog(ctx, p)),
  });
}
