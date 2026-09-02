/**
 * Amazon SP-API product creation and update logic.
 */
import { ConnectorError, money, type CanonicalProduct, type ConnectorContext, type RemoteProduct } from "../../connector";
import { call, marketplace, rejectInvalid, sellerId } from "./api";
import { AMAZON_CONDITION_MAP } from "./manifest";

export function toListingAttributes(ctx: ConnectorContext, p: CanonicalProduct) {
  const m = marketplace(ctx);
  const a = p.attributes as any;
  const v = p.variants[0];
  const mk = <T>(value: T) => [{ value, marketplace_id: m.id }];

  return {
    item_name: mk(p.title.slice(0, 200)),
    brand: mk(p.brand),
    product_description: mk(p.description),
    condition_type: [
      { value: AMAZON_CONDITION_MAP[String(a.condition ?? "NEW")] ?? "new_new", marketplace_id: m.id },
    ],
    country_of_origin: mk(a.country_of_origin ?? "IN"),
    recommended_browse_nodes: mk(String(a.amazon_browse_node_id ?? "")),
    main_product_image_locator: p.images[0]
      ? [{ media_location: p.images[0].url, marketplace_id: m.id }]
      : undefined,
    other_product_image_locator_1: p.images[1]
      ? [{ media_location: p.images[1].url, marketplace_id: m.id }]
      : undefined,
    list_price: [
      { value: Number(money(v?.mrpCents ?? 0)), currency: v?.currency ?? m.currency, marketplace_id: m.id },
    ],
    purchasable_offer: [
      {
        currency: v?.currency ?? m.currency,
        our_price: [{ schedule: [{ value_with_tax: Number(money(v?.priceCents ?? 0)) }] }],
        marketplace_id: m.id,
      },
    ],
    fulfillment_availability: [
      {
        fulfillment_channel_code: ctx.config.fulfillment ?? "DEFAULT",
        quantity: v?.available ?? 0,
        marketplace_id: m.id,
      },
    ],
    item_package_weight: p.weightG
      ? [{ value: p.weightG, unit: "grams", marketplace_id: m.id }]
      : undefined,
    supplier_declared_has_product_identifier_exemption: mk(!v?.barcode),
    externally_assigned_product_identifier: v?.barcode
      ? [{ type: "ean", value: v.barcode, marketplace_id: m.id }]
      : undefined,
    gst_hsn_code: p.hsnCode ? mk(p.hsnCode) : undefined,
  };
}

export async function createProduct(ctx: ConnectorContext, p: CanonicalProduct): Promise<RemoteProduct> {
  const m = marketplace(ctx);
  const a = p.attributes as any;
  if (!a.amazon_product_type) {
    throw new ConnectorError("amazon_product_type is required", "VALIDATION");
  }

  const body = await call(
    ctx,
    `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(p.sku)}?marketplaceIds=${m.id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        productType: a.amazon_product_type,
        requirements: "LISTING",
        attributes: toListingAttributes(ctx, p),
      }),
    },
  );

  rejectInvalid(body, "listing");
  return { remoteId: p.sku, raw: body };
}

export async function updateProduct(ctx: ConnectorContext, p: CanonicalProduct, remoteId: string): Promise<void> {
  const m = marketplace(ctx);
  const body = await call(
    ctx,
    `/listings/2021-08-01/items/${sellerId(ctx)}/${encodeURIComponent(remoteId)}?marketplaceIds=${m.id}`,
    {
      method: "PUT",
      body: JSON.stringify({
        productType: (p.attributes as any).amazon_product_type,
        requirements: "LISTING",
        attributes: toListingAttributes(ctx, p),
      }),
    },
  );
  rejectInvalid(body, "listing update");
}
