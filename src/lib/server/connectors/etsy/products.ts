/**
 * Etsy product creation, image uploading, and inventory management logic.
 */
import { ConnectorError, money, type CanonicalProduct, type ConnectorContext, type RemoteProduct } from "../../connector";
import { call, callForm, shopId, uploadListingImage } from "./api";
import { ETSY_CUSTOM_PROPERTY_IDS } from "./manifest";
import { taxonomyIdForCategory } from "./taxonomy";

export async function createProduct(ctx: ConnectorContext, p: CanonicalProduct): Promise<RemoteProduct> {
  const a = (p.attributes || {}) as any;
  const v = p.variants[0];

  if (!v || p.variants.some((variant) => variant.priceCents <= 0)) {
    throw new ConnectorError(
      "Etsy rejects zero-price listings: every variant needs a positive price before publishing",
      "VALIDATION",
    );
  }

  let quantity = v.available;
  if (quantity < 1) {
    quantity = 1;
  }

  const numericShopId = shopId(ctx);
  const taxonomyId = Number(a.etsy_taxonomy_id) || taxonomyIdForCategory(p.category || p.title);
  
  // Resolve configuration with fallback order: product attributes -> ctx.config defaults
  const rawShippingProfile = a.etsy_shipping_profile_id ?? ctx.config.default_shipping_profile_id ?? ctx.config.shipping_profile_id;
  const shippingProfileId = rawShippingProfile ? Number(rawShippingProfile) : undefined;

  const rawReturnPolicy = a.etsy_return_policy_id ?? ctx.config.default_return_policy_id ?? ctx.config.return_policy_id;
  const returnPolicyId = rawReturnPolicy ? Number(rawReturnPolicy) : undefined;

  const rawReadinessStateId = a.etsy_readiness_state_id ?? ctx.config.default_readiness_state_id ?? ctx.config.readiness_state_id;
  const readinessStateId = rawReadinessStateId ? Number(rawReadinessStateId) : undefined;

  const whoMade = a.who_made || ctx.config.default_who_made || ctx.config.who_made || "i_did";
  const whenMade = a.when_made || ctx.config.default_when_made || ctx.config.when_made || "made_to_order";
  const isSupply = a.is_supply !== undefined ? Boolean(a.is_supply) : Boolean(ctx.config.default_is_supply ?? false);
  const isCustomizable = a.is_customizable !== undefined ? Boolean(a.is_customizable) : false;
  const publishState = ctx.config.publish_immediately ? "active" : "draft";

  const payload: Record<string, any> = {
    quantity,
    title: p.title.slice(0, 140),
    description: p.description,
    price: Number(money(v.priceCents)),
    who_made: whoMade,
    when_made: whenMade,
    taxonomy_id: taxonomyId,
    shipping_profile_id: shippingProfileId && !isNaN(shippingProfileId) ? shippingProfileId : undefined,
    return_policy_id: returnPolicyId && !isNaN(returnPolicyId) ? returnPolicyId : undefined,
    readiness_state_id: readinessStateId && !isNaN(readinessStateId) ? readinessStateId : undefined,
    is_supply: isSupply,
    is_customizable: isCustomizable,
    sku: p.sku,
    state: publishState,
  };

  if (Array.isArray(a.tags) && a.tags.length > 0) {
    payload.tags = a.tags.map((t: string) => String(t).slice(0, 20)).slice(0, 13);
  }
  if (Array.isArray(a.materials) && a.materials.length > 0) {
    payload.materials = a.materials.map((m: string) => String(m).slice(0, 45)).slice(0, 13);
  }

  const weight = p.weightG > 0 ? p.weightG : (a.item_weight ? Number(a.item_weight) : undefined);
  if (weight !== undefined && !isNaN(weight)) {
    payload.item_weight = weight;
    payload.item_weight_unit = "g";
  }

  const length = a.item_length ? Number(a.item_length) : undefined;
  const width = a.item_width ? Number(a.item_width) : undefined;
  const height = a.item_height ? Number(a.item_height) : undefined;
  if (length && width && height) {
    payload.item_length = length;
    payload.item_width = width;
    payload.item_height = height;
    payload.item_dimensions_unit = "cm";
  }

  // Clean empty/null values
  const cleanPayload: Record<string, any> = {};
  for (const [k, val] of Object.entries(payload)) {
    if (val !== undefined && val !== null && val !== "") {
      cleanPayload[k] = val;
    }
  }

  ctx.log(`etsy: creating listing for SKU=${p.sku} with payload: ${JSON.stringify(cleanPayload)}`);

  const listing = (await call(ctx, `/shops/${numericShopId}/listings`, {
    method: "POST",
    body: JSON.stringify(cleanPayload),
  })) as { listing_id: number; url?: string };

  const listingId = String(listing.listing_id);

  // Upload images (up to 10 images)
  if (Array.isArray(p.images) && p.images.length > 0) {
    for (let i = 0; i < Math.min(p.images.length, 10); i++) {
      const img = p.images[i];
      if (img?.url) {
        await uploadListingImage(ctx, listingId, img.url, i + 1);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  // Set inventory offerings / variations
  if (p.variants.length > 1) {
    const names: string[] = [];
    for (const variant of p.variants) {
      for (const n of Object.keys(variant.options || {})) {
        if (!names.includes(n)) names.push(n);
      }
    }

    if (names.length > 0 && names.length <= ETSY_CUSTOM_PROPERTY_IDS.length) {
      const propertyIdOf = new Map(names.map((n, i) => [n, ETSY_CUSTOM_PROPERTY_IDS[i]]));
      const valueIdsByName = new Map<string, Map<string, number>>();
      const valueIdFor = (name: string, value: string): number => {
        let ids = valueIdsByName.get(name);
        if (!ids) {
          ids = new Map();
          valueIdsByName.set(name, ids);
        }
        let id = ids.get(value);
        if (id === undefined) {
          id = ids.size + 1;
          ids.set(value, id);
        }
        return id;
      };

      const propertyIds = names.map((n) => propertyIdOf.get(n)!);

      await call(ctx, `/listings/${listingId}/inventory`, {
        method: "PUT",
        body: JSON.stringify({
          products: p.variants.map((variant) => ({
            sku: variant.sku,
            property_values: names
              .filter((n) => variant.options[n] !== undefined)
              .map((n) => ({
                property_id: propertyIdOf.get(n),
                property_name: n,
                value_ids: [valueIdFor(n, variant.options[n])],
                values: [variant.options[n]],
              })),
            offerings: [
              {
                price: Number(money(variant.priceCents)),
                quantity: Math.max(1, variant.available),
                is_enabled: true,
              },
            ],
          })),
          price_on_property: propertyIds,
          quantity_on_property: propertyIds,
          sku_on_property: propertyIds,
        }),
      });
    } else {
      // Single/fallback product inventory structure
      await call(ctx, `/listings/${listingId}/inventory`, {
        method: "PUT",
        body: JSON.stringify({
          products: p.variants.map((variant) => ({
            sku: variant.sku,
            offerings: [
              {
                price: Number(money(variant.priceCents)),
                quantity: Math.max(1, variant.available),
                is_enabled: true,
              },
            ],
          })),
          price_on_property: [],
          quantity_on_property: [],
          sku_on_property: [],
        }),
      });
    }
  }

  return { remoteId: listingId, url: listing.url, raw: listing };
}

export async function updateProduct(ctx: ConnectorContext, p: CanonicalProduct, remoteId: string): Promise<void> {
  const numericShopId = shopId(ctx);
  const a = (p.attributes || {}) as any;
  
  const rawShippingProfile = a.etsy_shipping_profile_id ?? ctx.config.default_shipping_profile_id ?? ctx.config.shipping_profile_id;
  const rawReturnPolicy = a.etsy_return_policy_id ?? ctx.config.default_return_policy_id ?? ctx.config.return_policy_id;
  const rawReadinessStateId = a.etsy_readiness_state_id ?? ctx.config.default_readiness_state_id ?? ctx.config.readiness_state_id;

  const patchFields: Record<string, string | number | undefined> = {
    title: p.title.slice(0, 140),
    description: p.description,
    who_made: a.who_made || ctx.config.default_who_made || ctx.config.who_made,
    when_made: a.when_made || ctx.config.default_when_made || ctx.config.when_made,
    shipping_profile_id: rawShippingProfile ? Number(rawShippingProfile) : undefined,
    return_policy_id: rawReturnPolicy ? Number(rawReturnPolicy) : undefined,
    readiness_state_id: rawReadinessStateId ? Number(rawReadinessStateId) : undefined,
  };

  await callForm(ctx, `/shops/${numericShopId}/listings/${remoteId}`, "PATCH", patchFields);
}
