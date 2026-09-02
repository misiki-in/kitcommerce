/**
 * eBay inventory item and offer creation/update logic.
 */
import { money, type CanonicalProduct, type ConnectorContext, type RemoteProduct } from "../../connector";
import { call, cm, marketplaceId } from "./api";

export function inventoryItemBody(p: CanonicalProduct) {
  const a = p.attributes as any;
  const v = p.variants[0];
  return {
    availability: { shipToLocationAvailability: { quantity: v?.available ?? 0 } },
    condition: a.condition ?? "NEW",
    product: {
      title: p.title.slice(0, 80),
      description: p.description,
      brand: p.brand,
      imageUrls: p.images.map((i) => i.url),
      aspects: Object.fromEntries(
        Object.entries(p.attributes)
          .filter(([k]) => !k.startsWith("ebay_") && k !== "condition")
          .map(([k, val]) => [k, [String(val)]]),
      ),
    },
    packageWeightAndSize: {
      weight: { value: p.weightG, unit: "GRAM" },
      dimensions:
        p.lengthMm > 0
          ? {
              length: cm(p.lengthMm),
              width: cm(p.widthMm),
              height: cm(p.heightMm),
              unit: "CENTIMETER",
            }
          : undefined,
    },
  };
}

export async function createProduct(ctx: ConnectorContext, p: CanonicalProduct): Promise<RemoteProduct> {
  const a = p.attributes as any;
  const v = p.variants[0];

  // 1. inventory item (keyed by SKU -- naturally idempotent, PUT is a replace)
  await call(ctx, `/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`, {
    method: "PUT",
    body: JSON.stringify(inventoryItemBody(p)),
  });

  // 2. offer
  const offer = await call(ctx, "/sell/inventory/v1/offer", {
    method: "POST",
    body: JSON.stringify({
      sku: p.sku,
      marketplaceId: marketplaceId(ctx),
      format: "FIXED_PRICE",
      availableQuantity: v?.available ?? 0,
      categoryId: a.ebay_category_id ? String(a.ebay_category_id) : undefined,
      listingDescription: p.description,
      listingPolicies: {
        fulfillmentPolicyId: a.ebay_fulfillment_policy_id,
        paymentPolicyId: a.ebay_payment_policy_id,
        returnPolicyId: a.ebay_return_policy_id,
      },
      pricingSummary: {
        price: { value: money(v?.priceCents ?? 0), currency: v?.currency ?? "USD" },
      },
      merchantLocationKey: a.ebay_merchant_location_key,
    }),
  });

  // 3. publish
  const published = await call(
    ctx,
    `/sell/inventory/v1/offer/${offer.offerId}/publish`,
    { method: "POST" },
  );

  return { remoteId: published?.listingId ?? offer.offerId, raw: { offer, published } };
}

export async function updateProduct(ctx: ConnectorContext, p: CanonicalProduct, remoteId: string): Promise<void> {
  await call(ctx, `/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`, {
    method: "PUT",
    body: JSON.stringify(inventoryItemBody(p)),
  });
}
