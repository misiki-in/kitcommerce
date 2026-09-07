/**
 * eBay inventory item and offer creation/update logic.
 */
import { money, type CanonicalProduct, type ConnectorContext, type RemoteProduct } from "../../connector";
import { call, cm, marketplaceId, discoverAllEbayResources, ensureEbayLocation } from "./api";
import { taxonomyIdForEbayCategory } from "./taxonomy";

export function inventoryItemBody(p: CanonicalProduct) {
  const a = (p.attributes || {}) as any;
  const v = p.variants[0];

  // eBay aspect restrictions:
  // - Aspect names and values cannot be empty or null
  // - Filter out internal/system attributes (tags, materials, etsy_*, ebay_*, etc.)
  const ignoredKeys = new Set([
    "condition",
    "tags",
    "materials",
    "who_made",
    "when_made",
    "is_supply",
    "is_customizable",
    "publish_immediately",
  ]);

  const cleanAspects: Record<string, string[]> = {};

  // eBay requires Brand and MPN aspects in product.aspects for catalog matching
  const brandVal = (p.brand && p.brand.trim()) || "Unbranded";
  cleanAspects["Brand"] = [brandVal];
  cleanAspects["MPN"] = [p.sku ? String(p.sku).trim() : "Does not apply"];

  for (const [k, rawVal] of Object.entries(p.attributes || {})) {
    if (!k || k.startsWith("ebay_") || k.startsWith("etsy_") || ignoredKeys.has(k.toLowerCase())) {
      continue;
    }

    if (rawVal === undefined || rawVal === null) continue;

    let strValues: string[] = [];
    if (Array.isArray(rawVal)) {
      strValues = rawVal.map((item) => String(item ?? "").trim()).filter(Boolean);
    } else if (typeof rawVal === "object") {
      continue;
    } else {
      const s = String(rawVal).trim();
      if (s && s !== "null" && s !== "undefined") {
        strValues = [s];
      }
    }

    if (strValues.length > 0) {
      cleanAspects[k.trim()] = strValues;
    }
  }

  // eBay requires at least 1 valid imageUrl in inventory items
  let imageUrls = (p.images || [])
    .map((i) => i?.url)
    .filter((u): u is string => Boolean(u && typeof u === "string" && u.startsWith("http")));

  if (imageUrls.length === 0) {
    // Fallback placeholder image URL to satisfy eBay API requirement
    imageUrls = ["https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=800&auto=format&fit=crop&q=80"];
  }

  return {
    availability: { shipToLocationAvailability: { quantity: Math.max(1, v?.available ?? 1) } },
    condition: a.condition ?? "NEW",
    product: {
      title: p.title.slice(0, 80),
      description: p.description || p.title,
      brand: p.brand || undefined,
      imageUrls,
      aspects: Object.keys(cleanAspects).length > 0 ? cleanAspects : undefined,
    },
    packageWeightAndSize: {
      weight: { value: Math.max(1, p.weightG || 100), unit: "GRAM" },
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

  // 1. Inventory item (keyed by SKU -- naturally idempotent, PUT is a replace)
  await call(ctx, `/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`, {
    method: "PUT",
    body: JSON.stringify(inventoryItemBody(p)),
  });

  // 2. Ensure business policies and merchant location exist (auto-discover if missing)
  let fulfillmentPolicyId =
    a.ebay_fulfillment_policy_id || ctx.config.ebay_fulfillment_policy_id || ctx.config.default_fulfillment_policy_id;
  let paymentPolicyId =
    a.ebay_payment_policy_id || ctx.config.ebay_payment_policy_id || ctx.config.default_payment_policy_id;
  let returnPolicyId =
    a.ebay_return_policy_id || ctx.config.ebay_return_policy_id || ctx.config.default_return_policy_id;
  let merchantLocationKey =
    a.ebay_merchant_location_key || ctx.config.ebay_merchant_location_key || "DEFAULT_WAREHOUSE";

  if (!fulfillmentPolicyId || !returnPolicyId || !paymentPolicyId) {
    try {
      const disc = await discoverAllEbayResources(ctx);
      if (!fulfillmentPolicyId && disc.defaultFulfillmentPolicyId) {
        fulfillmentPolicyId = disc.defaultFulfillmentPolicyId;
        ctx.config.ebay_fulfillment_policy_id = fulfillmentPolicyId;
      }
      if (!returnPolicyId && disc.defaultReturnPolicyId) {
        returnPolicyId = disc.defaultReturnPolicyId;
        ctx.config.ebay_return_policy_id = returnPolicyId;
      }
      if (!paymentPolicyId && disc.defaultPaymentPolicyId) {
        paymentPolicyId = disc.defaultPaymentPolicyId;
        ctx.config.ebay_payment_policy_id = paymentPolicyId;
      }
      if (!merchantLocationKey && disc.defaultMerchantLocationKey) {
        merchantLocationKey = disc.defaultMerchantLocationKey;
        ctx.config.ebay_merchant_location_key = merchantLocationKey;
      }
    } catch (discErr: any) {
      console.warn(`[eBay createProduct] Auto-discovery warning: ${discErr.message}`);
    }
  }

  // Ensure the location exists and is registered on eBay before creating offer
  merchantLocationKey = await ensureEbayLocation(ctx, merchantLocationKey);

  // 3. Category resolution
  const categoryId =
    a.ebay_category_id ||
    ctx.config.ebay_category_id ||
    (p.category ? String(taxonomyIdForEbayCategory(p.category)) : "11450");

  const listingPolicies: Record<string, string> = {};
  if (fulfillmentPolicyId) listingPolicies.fulfillmentPolicyId = String(fulfillmentPolicyId);
  if (paymentPolicyId) listingPolicies.paymentPolicyId = String(paymentPolicyId);
  if (returnPolicyId) listingPolicies.returnPolicyId = String(returnPolicyId);

  // 4. Build offer payload
  const offerBody: any = {
    sku: p.sku,
    marketplaceId: marketplaceId(ctx),
    format: "FIXED_PRICE",
    availableQuantity: Math.max(1, v?.available ?? 1),
    categoryId: String(categoryId),
    listingDescription: p.description || p.title,
    listingPolicies,
    pricingSummary: {
      price: {
        value: money(v?.priceCents && v.priceCents > 0 ? v.priceCents : 100),
        currency: v?.currency || ctx.seller.currency || "USD",
      },
    },
    merchantLocationKey,
  };

  // 5. Create or update offer
  let offerId: string | null = null;
  let listingId: string | null = null;

  // First check if an offer already exists for this SKU
  try {
    const existingOffers = await call(ctx, `/sell/inventory/v1/offer?sku=${encodeURIComponent(p.sku)}`);
    if (existingOffers?.offers && existingOffers.offers.length > 0) {
      offerId = existingOffers.offers[0].offerId;
      listingId = existingOffers.offers[0].listing?.listingId || null;
    }
  } catch {}

  if (offerId) {
    // Update existing offer
    try {
      await call(ctx, `/sell/inventory/v1/offer/${offerId}`, {
        method: "PUT",
        body: JSON.stringify(offerBody),
      });
    } catch (putErr: any) {
      console.warn(`[eBay createProduct] Offer PUT warning for ${offerId}: ${putErr.message}`);
    }
  } else {
    // Attempt to create new offer
    try {
      const offer = await call(ctx, "/sell/inventory/v1/offer", {
        method: "POST",
        body: JSON.stringify(offerBody),
      });
      offerId = offer?.offerId;
    } catch (err: any) {
      // If eBay says offer already exists, extract offerId from error parameter or message
      const errStr = String(err.message || "");
      const match = errStr.match(/"name":"offerId","value":"(\d+)"/) || errStr.match(/offerId[":\s]+(\d+)/i);
      if (match && match[1]) {
        offerId = match[1];
        try {
          await call(ctx, `/sell/inventory/v1/offer/${offerId}`, {
            method: "PUT",
            body: JSON.stringify(offerBody),
          });
        } catch {}
      } else {
        throw err;
      }
    }
  }

  // 6. Publish offer
  let published: any = null;
  if (offerId) {
    try {
      published = await call(
        ctx,
        `/sell/inventory/v1/offer/${offerId}/publish`,
        { method: "POST" },
      );
      listingId = published?.listingId || listingId;
    } catch (pubErr: any) {
      console.warn(`[eBay createProduct] Offer publish warning for ${offerId}: ${pubErr.message}`);
    }
  }

  return { remoteId: listingId ?? offerId ?? p.sku, raw: { offerId, listingId, published } };
}

export async function updateProduct(ctx: ConnectorContext, p: CanonicalProduct, remoteId: string): Promise<void> {
  await call(ctx, `/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`, {
    method: "PUT",
    body: JSON.stringify(inventoryItemBody(p)),
  });
}
