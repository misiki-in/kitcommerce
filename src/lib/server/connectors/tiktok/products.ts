/**
 * TikTok product creation and update logic.
 */
import { ConnectorError, money, type CanonicalProduct, type CanonicalVariant, type ConnectorContext, type RemoteProduct } from "../../connector";
import { request, uploadImages } from "./api";

export const currencyFor = (ctx: ConnectorContext, v: CanonicalVariant): string =>
  String(ctx.config.currency ?? v.currency);

export function productBody(ctx: ConnectorContext, p: CanonicalProduct, imageUris: string[]) {
  const a = p.attributes as any;
  const warehouse = String(a.tiktok_warehouse_id ?? ctx.config.tiktok_warehouse_id ?? "");
  return {
    title: p.title,
    description: p.description,
    category_id: String(a.tiktok_category_id ?? ""),
    main_images: imageUris.map((uri) => ({ uri })),
    package_weight: { value: String(a.package_weight_g ?? p.weightG ?? 0), unit: "GRAM" },
    skus: p.variants.map((v) => ({
      seller_sku: v.sku,
      sales_attributes: Object.entries(v.options ?? {}).map(([name, value]) => ({
        name,
        value_name: value,
      })),
      price: { amount: money(v.priceCents), currency: currencyFor(ctx, v) },
      inventory: [
        warehouse
          ? { warehouse_id: warehouse, quantity: v.available }
          : { quantity: v.available },
      ],
    })),
  };
}

export async function tiktokSkuId(
  ctx: ConnectorContext,
  productId: string,
  sellerSku: string,
): Promise<{ id: string; warehouseId?: string }> {
  const data = await request(ctx, {
    method: "GET",
    path: `/product/202309/products/${encodeURIComponent(productId)}`,
    shopScoped: true,
  });
  const match = (data?.skus ?? []).find(
    (s: any) => String(s.seller_sku ?? "") === sellerSku,
  );
  if (!match?.id) {
    throw new ConnectorError(
      `SKU ${sellerSku} is not on TikTok product ${productId} — republish the product before syncing it`,
      "VALIDATION",
    );
  }
  const warehouseId = match.inventory?.[0]?.warehouse_id;
  return {
    id: String(match.id),
    warehouseId: warehouseId ? String(warehouseId) : undefined,
  };
}

export async function createProduct(ctx: ConnectorContext, p: CanonicalProduct): Promise<RemoteProduct> {
  const uris = await uploadImages(ctx, p.images);
  if (uris.length === 0) {
    throw new ConnectorError(
      "TikTok requires images hosted on TikTok and none of the product's images could be uploaded",
      "VALIDATION",
    );
  }

  const data = await request(ctx, {
    method: "POST",
    path: "/product/202309/products",
    body: productBody(ctx, p, uris),
    shopScoped: true,
  });
  if (!data?.product_id) {
    throw new ConnectorError(
      "TikTok create returned no product_id — the listing state is unknown",
      "UNKNOWN",
    );
  }
  return { remoteId: String(data.product_id), raw: data };
}

export async function updateProduct(ctx: ConnectorContext, p: CanonicalProduct, remoteId: string): Promise<void> {
  const uris = await uploadImages(ctx, p.images);
  if (uris.length === 0) {
    throw new ConnectorError(
      "TikTok requires images hosted on TikTok and none of the product's images could be uploaded",
      "VALIDATION",
    );
  }
  await request(ctx, {
    method: "PUT",
    path: `/product/202309/products/${encodeURIComponent(remoteId)}`,
    body: productBody(ctx, p, uris),
    shopScoped: true,
  });
}
