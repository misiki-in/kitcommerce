/**
 * eBay inventory item and offer creation/update logic.
 */
import { money, type CanonicalProduct, type ConnectorContext, type RemoteProduct } from "../../connector";
import {
  call,
  cm,
  marketplaceId,
  discoverAllEbayResources,
  ensureEbayLocation,
  ensureValidFulfillmentPolicy,
  ensureValidReturnPolicy,
  ensureValidPaymentPolicy,
} from "./api";
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

  // eBay Inventory API aspect requirements:
  // - "Brand" is mandatory for almost all categories. Default to "Unbranded" if absent.
  // - "MPN" is mandatory when Brand is provided in many categories. Default to SKU or "Does Not Apply".
  // - eBay aspect values MUST be arrays of strings with non-empty characters.
  const brandVal = (p.brand && String(p.brand).trim()) || "Unbranded";
  const mpnVal = p.sku && String(p.sku).trim() ? String(p.sku).trim() : "Does Not Apply";

  cleanAspects["Brand"] = [brandVal];
  cleanAspects["MPN"] = [mpnVal];

  // Derive category-specific mandatory aspects for eBay (e.g. Style for Earrings/Rings/Jewelry/Clothing)
  const fullCategoryText = [p.category, p.title, ...(p.tags || [])].filter(Boolean).join(" ").toLowerCase();

  // Style derivation (mandatory for Earrings, Rings, Necklaces, Dresses, Tops)
  if (fullCategoryText.includes("cluster")) {
    cleanAspects["Style"] = ["Cluster"];
  } else if (fullCategoryText.includes("halo")) {
    cleanAspects["Style"] = ["Halo"];
  } else if (fullCategoryText.includes("stud")) {
    cleanAspects["Style"] = ["Stud"];
  } else if (fullCategoryText.includes("hoop")) {
    cleanAspects["Style"] = ["Hoop"];
  } else if (fullCategoryText.includes("drop") || fullCategoryText.includes("dangle")) {
    cleanAspects["Style"] = ["Dangle/Drop"];
  } else if (fullCategoryText.includes("huggie")) {
    cleanAspects["Style"] = ["Huggie"];
  } else if (fullCategoryText.includes("solitaire")) {
    cleanAspects["Style"] = ["Solitaire"];
  } else if (fullCategoryText.includes("band") || fullCategoryText.includes("wedding")) {
    cleanAspects["Style"] = ["Band"];
  } else if (fullCategoryText.includes("pendant")) {
    cleanAspects["Style"] = ["Pendant"];
  } else if (fullCategoryText.includes("earring")) {
    cleanAspects["Style"] = ["Stud"];
  } else if (fullCategoryText.includes("ring")) {
    cleanAspects["Style"] = ["Solitaire"];
  } else if (fullCategoryText.includes("dress")) {
    cleanAspects["Style"] = ["A-Line"];
  } else if (fullCategoryText.includes("shirt") || fullCategoryText.includes("top")) {
    cleanAspects["Style"] = ["Basic"];
  } else {
    cleanAspects["Style"] = ["Fashion"];
  }

  // Type derivation (Earrings, Rings, Necklaces, etc.)
  if (fullCategoryText.includes("earring")) {
    cleanAspects["Type"] = ["Earrings"];
  } else if (fullCategoryText.includes("ring")) {
    cleanAspects["Type"] = ["Ring"];
  } else if (fullCategoryText.includes("necklace")) {
    cleanAspects["Type"] = ["Necklace"];
  } else if (fullCategoryText.includes("bracelet")) {
    cleanAspects["Type"] = ["Bracelet"];
  }

  for (const [k, rawVal] of Object.entries(p.attributes || {})) {
    const normKey = k ? k.trim() : "";
    if (
      !normKey ||
      normKey.startsWith("ebay_") ||
      normKey.startsWith("etsy_") ||
      ignoredKeys.has(normKey.toLowerCase()) ||
      normKey.toLowerCase() === "brand" ||
      normKey.toLowerCase() === "mpn"
    ) {
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
      // Capitalize first letter of aspect key for standard eBay naming (e.g. style -> Style)
      const capitalizedKey = normKey.charAt(0).toUpperCase() + normKey.slice(1);
      cleanAspects[capitalizedKey] = strValues;
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
      brand: brandVal,
      mpn: mpnVal,
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

  // Ensure fulfillment policy has at least one valid shipping option
  fulfillmentPolicyId = await ensureValidFulfillmentPolicy(ctx, fulfillmentPolicyId);
  returnPolicyId = await ensureValidReturnPolicy(ctx, returnPolicyId);
  paymentPolicyId = await ensureValidPaymentPolicy(ctx, paymentPolicyId);

  // Ensure the location exists and is registered on eBay using demographic info from Account Settings
  merchantLocationKey = await ensureEbayLocation(ctx, merchantLocationKey);

  // 3. Category resolution: Compute dynamic leaf category for this specific product first
  let resolvedCat = (p.category || (p.tags && p.tags.join(",")) || p.title)
    ? String(taxonomyIdForEbayCategory(p.category || (p.tags && p.tags.join(",")) || p.title))
    : "";

  const categoryId = a.ebay_category_id || resolvedCat || ctx.config.ebay_category_id || "67726";

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

  // 6. Publish offer with auto-recovery for fulfillment policy or leaf category errors
  let published: any = null;
  if (offerId) {
    try {
      published = await call(
        ctx,
        `/sell/inventory/v1/offer/${offerId}/publish`,
        { method: "POST" },
      );
      listingId = published?.listingId || listingId;
      ctx.log(`[eBay createProduct] Successfully published offer ${offerId} -> listing ID: ${listingId}`);
    } catch (pubErr: any) {
      const errStr = String(pubErr.message || "");
      let recovered = false;

      // Auto-recovery 1: Non-leaf category selected (error 25005)
      if (errStr.includes("25005") || errStr.includes("not a leaf category")) {
        ctx.log(`[eBay createProduct] Error 25005: Non-leaf category detected. Dynamically falling back to leaf category for '${p.category || p.title}'...`);
        const leafCat = String(taxonomyIdForEbayCategory(p.category || (p.tags && p.tags.join(",")) || p.title || "jewelry"));
        offerBody.categoryId = leafCat;
        recovered = true;
      }

      // Auto-recovery 2: Fulfillment policy invalid or missing services (error 25007)
      if (errStr.includes("25007") || errStr.includes("Fulfillment policy") || errStr.includes("shipping service option")) {
        ctx.log(`[eBay createProduct] Fulfillment policy 25007 encountered. Auto-resolving valid shipping policy and retrying offer publish...`);
        const validPolicyId = await ensureValidFulfillmentPolicy(ctx);
        if (validPolicyId) {
          listingPolicies.fulfillmentPolicyId = validPolicyId;
          offerBody.listingPolicies = listingPolicies;
          recovered = true;
        }
      }

      // Auto-recovery 3: Missing mandatory aspect like Style (error 25002)
      if (errStr.includes("25002") || errStr.includes("item specific") || errStr.includes("missing")) {
        ctx.log(`[eBay createProduct] Aspect error 25002 encountered. Refreshing inventory item specifics and retrying...`);
        try {
          await call(ctx, `/sell/inventory/v1/inventory_item/${encodeURIComponent(p.sku)}`, {
            method: "PUT",
            body: JSON.stringify(inventoryItemBody(p)),
          });
          recovered = true;
        } catch {}
      }

      if (recovered) {
        try {
          await call(ctx, `/sell/inventory/v1/offer/${offerId}`, {
            method: "PUT",
            body: JSON.stringify(offerBody),
          });
          published = await call(
            ctx,
            `/sell/inventory/v1/offer/${offerId}/publish`,
            { method: "POST" },
          );
          listingId = published?.listingId || listingId;
          ctx.log(`[eBay createProduct] Successfully recovered and published offer ${offerId} -> listing ID: ${listingId}`);
          return { remoteId: listingId ?? offerId ?? p.sku, raw: { offerId, listingId, published } };
        } catch (retryErr: any) {
          ctx.log(`[eBay createProduct] Retry publish failed for ${offerId}: ${retryErr.message}`);
          throw retryErr;
        }
      }

      ctx.log(`[eBay createProduct] Offer publish failed for ${offerId}: ${pubErr.message}`);
      throw pubErr;
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
