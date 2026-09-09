/**
 * eBay API client, token management, and authentication helpers.
 */
import { ConnectorError, classifyStatus, type ConnectorContext } from "../../connector";
import { createHash } from "node:crypto";
import {
  EBAY_PROD_URL,
  EBAY_SANDBOX_URL,
  EBAY_SCOPES,
  EBAY_TOKEN_MARGIN_MS,
} from "./manifest";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export const base = (ctx: ConnectorContext): string =>
  ctx.config.sandbox ? EBAY_SANDBOX_URL : EBAY_PROD_URL;

export const marketplaceId = (ctx: ConnectorContext): string =>
  ctx.config.marketplace_id ?? "EBAY_US";

export async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { client_id, client_secret, refresh_token } = ctx.credentials;
  if (!client_id || !client_secret || !refresh_token) {
    throw new ConnectorError("missing eBay client_id/client_secret/refresh_token", "AUTHENTICATION");
  }

  const cacheKey = createHash("sha256")
    .update(`${base(ctx)}|${client_id}|${refresh_token}`)
    .digest("hex");

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const basic = Buffer.from(`${client_id}:${client_secret}`).toString("base64");
  const res = await fetch(`${base(ctx)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      scope: EBAY_SCOPES,
    }),
  });
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const body = (await res.json()) as { access_token: string; expires_in?: number };
  const lifetimeMs = (body.expires_in ?? 7200) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - EBAY_TOKEN_MARGIN_MS),
  });

  return body.access_token;
}

export async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const token = await accessToken(ctx);
  const res = await fetch(`${base(ctx)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Language": ctx.config.content_language ?? "en-US",
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId(ctx),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429) {
    const retryAfterS = Number(res.headers.get("retry-after"));
    const retryAfterMs =
      Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS * 1000 : 15 * 60_000;
    throw new ConnectorError("eBay rate limit", "RATE_LIMITED", { retryAfterMs });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const cm = (mm: number): number => Math.round(mm) / 10;

export interface EbayDiscoveryResult {
  fulfillmentPolicies: Array<{ id: string; name: string; description?: string }>;
  returnPolicies: Array<{ id: string; name: string; description?: string; returnsAccepted?: boolean }>;
  paymentPolicies: Array<{ id: string; name: string; description?: string }>;
  locations: Array<{ key: string; name: string; status?: string }>;
  defaultFulfillmentPolicyId?: string;
  defaultReturnPolicyId?: string;
  defaultPaymentPolicyId?: string;
  defaultMerchantLocationKey?: string;
  errors: string[];
}

/**
 * Discovers seller business policies and inventory locations from eBay API.
 */
export async function discoverAllEbayResources(ctx: ConnectorContext): Promise<EbayDiscoveryResult> {
  const errors: string[] = [];
  const mId = marketplaceId(ctx);

  let fulfillmentPolicies: Array<{ id: string; name: string; description?: string }> = [];
  let returnPolicies: Array<{ id: string; name: string; description?: string; returnsAccepted?: boolean }> = [];
  let paymentPolicies: Array<{ id: string; name: string; description?: string }> = [];
  let locations: Array<{ key: string; name: string; status?: string }> = [];

  // 1. Fetch fulfillment policies
  try {
    const res = await call(ctx, `/sell/account/v1/fulfillment_policy?marketplace_id=${mId}`);
    const list = res?.fulfillmentPolicies ?? [];
    fulfillmentPolicies = list
      .filter((p: any) => p && p.fulfillmentPolicyId)
      .map((p: any) => ({
        id: String(p.fulfillmentPolicyId),
        name: p.name || `Fulfillment Policy #${p.fulfillmentPolicyId}`,
        description: p.description,
        shippingOptionsCount: Array.isArray(p.shippingOptions) ? p.shippingOptions.length : 0,
      }));

    // If no fulfillment policies exist, or none have shipping service options, create a standard valid default fulfillment policy
    const validPolicy = list.find((p: any) => Array.isArray(p.shippingOptions) && p.shippingOptions.length > 0);
    if (!validPolicy) {
      try {
        const currency = mId === "EBAY_IN" ? "INR" : mId === "EBAY_GB" ? "GBP" : mId === "EBAY_DE" ? "EUR" : "USD";
        const shippingServiceCode =
          mId === "EBAY_IN" ? "IN_StandardDelivery" : mId === "EBAY_GB" ? "UK_RoyalMailTracked48" : "USPSPriority";
        const shippingCarrierCode =
          mId === "EBAY_IN" ? "India Post" : mId === "EBAY_GB" ? "Royal Mail" : "USPS";

        const defaultShippingPolicy = await call(ctx, "/sell/account/v1/fulfillment_policy", {
          method: "POST",
          body: JSON.stringify({
            name: `Standard Shipping (${mId}) - Auto`,
            description: "Standard domestic tracked shipping with standard handling time",
            marketplaceId: mId,
            categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
            handlingTime: { value: 3, unit: "DAY" },
            shippingOptions: [
              {
                optionType: "DOMESTIC",
                costType: "FLAT_RATE",
                shippingServices: [
                  {
                    shippingServiceCode,
                    shippingCarrierCode,
                    shippingCost: { value: "0.00", currency },
                    freeShipping: true,
                    buyerResponsibleForShipping: false,
                    sortOrder: 1,
                  },
                ],
              },
            ],
          }),
        });

        if (defaultShippingPolicy?.fulfillmentPolicyId) {
          const newId = String(defaultShippingPolicy.fulfillmentPolicyId);
          fulfillmentPolicies.unshift({
            id: newId,
            name: defaultShippingPolicy.name || "Standard Shipping - Auto",
            description: defaultShippingPolicy.description,
          });
        }
      } catch (createPolicyErr: any) {
        // If creation error (e.g. name conflict), try fetching again or record error
        errors.push(`Default fulfillment policy creation note: ${createPolicyErr.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`Fulfillment policies discovery failed: ${err.message}`);
  }

  // 2. Fetch return policies
  try {
    const res = await call(ctx, `/sell/account/v1/return_policy?marketplace_id=${mId}`);
    const list = res?.returnPolicies ?? [];
    returnPolicies = list.map((p: any) => ({
      id: String(p.returnPolicyId),
      name: p.name || `Return Policy #${p.returnPolicyId}`,
      description: p.description,
      returnsAccepted: Boolean(p.returnsAccepted),
    }));
  } catch (err: any) {
    errors.push(`Return policies discovery failed: ${err.message}`);
  }

  // 3. Fetch payment policies
  try {
    const res = await call(ctx, `/sell/account/v1/payment_policy?marketplace_id=${mId}`);
    const list = res?.paymentPolicies ?? [];
    paymentPolicies = list.map((p: any) => ({
      id: String(p.paymentPolicyId),
      name: p.name || `Payment Policy #${p.paymentPolicyId}`,
      description: p.description,
    }));
  } catch (err: any) {
    errors.push(`Payment policies discovery failed: ${err.message}`);
  }

  // 4. Fetch inventory locations
  try {
    const res = await call(ctx, `/sell/inventory/v1/location?limit=100`);
    const list = res?.locations ?? [];
    locations = list.map((loc: any) => ({
      key: String(loc.merchantLocationKey),
      name: loc.name || String(loc.merchantLocationKey),
      status: loc.merchantLocationStatus,
    }));

    // If no merchant location exists yet, auto-create a default location using Account Settings
    if (locations.length === 0) {
      const defaultKey = "DEFAULT_WAREHOUSE";
      try {
        const addr = ctx.seller?.address;
        const country = (addr?.country || (mId === "EBAY_IN" ? "IN" : mId === "EBAY_GB" ? "GB" : mId === "EBAY_DE" ? "DE" : "US")).toUpperCase();
        const postalCode = addr?.postalCode || "";
        const city = addr?.city || "";
        const stateOrProvince = addr?.state || "";
        const addressLine1 = addr?.line1 || "";

        if (addressLine1 && city && postalCode && country) {
          await call(ctx, `/sell/inventory/v1/location/${defaultKey}`, {
            method: "POST",
            body: JSON.stringify({
              location: {
                address: {
                  addressLine1,
                  city,
                  stateOrProvince: stateOrProvince || city,
                  postalCode,
                  country,
                },
              },
              locationTypes: ["WAREHOUSE"],
              merchantLocationStatus: "ENABLED",
              name: ctx.seller?.storeName ? `${ctx.seller.storeName} Warehouse` : "Main Warehouse",
            }),
          });
          locations.push({ key: defaultKey, name: ctx.seller?.storeName ? `${ctx.seller.storeName} Warehouse` : "Main Warehouse", status: "ENABLED" });
        }
      } catch (locErr: any) {
        errors.push(`Default location registration failed: ${locErr.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`Inventory locations discovery failed: ${err.message}`);
  }

  return {
    fulfillmentPolicies,
    returnPolicies,
    paymentPolicies,
    locations,
    defaultFulfillmentPolicyId: fulfillmentPolicies[0]?.id || ctx.config.ebay_fulfillment_policy_id,
    defaultReturnPolicyId: returnPolicies[0]?.id || ctx.config.ebay_return_policy_id,
    defaultPaymentPolicyId: paymentPolicies[0]?.id || ctx.config.ebay_payment_policy_id,
    defaultMerchantLocationKey: locations[0]?.key || ctx.config.ebay_merchant_location_key || "DEFAULT_WAREHOUSE",
    errors,
  };
}

/**
 * Ensures that an inventory location exists on eBay using store demographic info from Account Settings.
 */
export async function ensureEbayLocation(
  ctx: ConnectorContext,
  preferredKey?: string,
): Promise<string> {
  const key = preferredKey || ctx.config.ebay_merchant_location_key || "DEFAULT_WAREHOUSE";
  const mId = marketplaceId(ctx);

  // Take all demographic information from Account Settings (ctx.seller.address)
  const addr = ctx.seller?.address;
  const country = (addr?.country || (mId === "EBAY_IN" ? "IN" : mId === "EBAY_GB" ? "GB" : mId === "EBAY_DE" ? "DE" : "US")).toUpperCase();
  const postalCode = addr?.postalCode?.trim() || "";
  const city = addr?.city?.trim() || "";
  const stateOrProvince = addr?.state?.trim() || "";
  const addressLine1 = addr?.line1?.trim() || "";

  if (!postalCode || !city || !addressLine1) {
    console.warn(`[eBay ensureEbayLocation] Incomplete address in Account Settings: postalCode='${postalCode}', city='${city}', line1='${addressLine1}'`);
  }

  // Check if location exists and has valid postalCode
  try {
    const existing = await call(ctx, `/sell/inventory/v1/location/${encodeURIComponent(key)}`);
    if (existing && existing.merchantLocationStatus === "ENABLED" && existing.location?.address?.postalCode) {
      return key;
    }
  } catch {
    // Location does not exist or fetch failed, create/update it
  }

  // Create or update location with demographic data from Account Settings
  try {
    await call(ctx, `/sell/inventory/v1/location/${encodeURIComponent(key)}`, {
      method: "POST",
      body: JSON.stringify({
        location: {
          address: {
            addressLine1: addressLine1 || "Store Location",
            city: city || "City",
            stateOrProvince: stateOrProvince || city || "State",
            postalCode: postalCode || "",
            country: country || "US",
          },
        },
        locationTypes: ["WAREHOUSE"],
        merchantLocationStatus: "ENABLED",
        name: ctx.seller?.storeName ? `${ctx.seller.storeName} Warehouse` : "Main Warehouse",
      }),
    });
  } catch (err: any) {
    console.warn(`[eBay ensureEbayLocation] Note: ${err.message}`);
  }

  return key;
}

/**
 * Ensures a valid fulfillment policy with at least one domestic shipping service exists.
 */
export async function ensureValidFulfillmentPolicy(
  ctx: ConnectorContext,
  preferredPolicyId?: string,
): Promise<string> {
  const mId = marketplaceId(ctx);
  const candidateId = preferredPolicyId || ctx.config.ebay_fulfillment_policy_id || ctx.config.default_fulfillment_policy_id;

  // 1. If candidate ID provided, test if it has shipping services
  if (candidateId) {
    try {
      const pol = await call(ctx, `/sell/account/v1/fulfillment_policy/${candidateId}`);
      if (Array.isArray(pol?.shippingOptions) && pol.shippingOptions.length > 0) {
        return candidateId;
      }
    } catch {}
  }

  // 2. Fetch all fulfillment policies for this marketplace and find the first valid one
  try {
    const res = await call(ctx, `/sell/account/v1/fulfillment_policy?marketplace_id=${mId}`);
    const list: any[] = res?.fulfillmentPolicies ?? [];
    const valid = list.find((p) => Array.isArray(p.shippingOptions) && p.shippingOptions.length > 0);
    if (valid?.fulfillmentPolicyId) {
      const validId = String(valid.fulfillmentPolicyId);
      ctx.config.ebay_fulfillment_policy_id = validId;
      return validId;
    }
  } catch {}

  // 3. Auto-create a standard valid fulfillment policy with domestic tracked shipping
  try {
    const currency = mId === "EBAY_IN" ? "INR" : mId === "EBAY_GB" ? "GBP" : mId === "EBAY_DE" ? "EUR" : "USD";
    const shippingServiceCode =
      mId === "EBAY_IN" ? "IN_StandardDelivery" : mId === "EBAY_GB" ? "UK_RoyalMailTracked48" : "USPSPriority";
    const shippingCarrierCode =
      mId === "EBAY_IN" ? "India Post" : mId === "EBAY_GB" ? "Royal Mail" : "USPS";

    const created = await call(ctx, "/sell/account/v1/fulfillment_policy", {
      method: "POST",
      body: JSON.stringify({
        name: `Standard Shipping (${mId}) - Auto`,
        description: "Standard domestic tracked shipping with standard handling time",
        marketplaceId: mId,
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
        handlingTime: { value: 3, unit: "DAY" },
        shippingOptions: [
          {
            optionType: "DOMESTIC",
            costType: "FLAT_RATE",
            shippingServices: [
              {
                shippingServiceCode,
                shippingCarrierCode,
                shippingCost: { value: "0.00", currency },
                freeShipping: true,
                buyerResponsibleForShipping: false,
                sortOrder: 1,
              },
            ],
          },
        ],
      }),
    });

    if (created?.fulfillmentPolicyId) {
      const createdId = String(created.fulfillmentPolicyId);
      ctx.config.ebay_fulfillment_policy_id = createdId;
      return createdId;
    }
  } catch (err: any) {
    console.warn(`[eBay ensureValidFulfillmentPolicy] Warning: ${err.message}`);
  }

  return candidateId || "";
}

/**
 * Ensures a valid return policy exists or creates a default 30-day return policy.
 */
export async function ensureValidReturnPolicy(
  ctx: ConnectorContext,
  preferredPolicyId?: string,
): Promise<string> {
  const mId = marketplaceId(ctx);
  const candidateId = preferredPolicyId || ctx.config.ebay_return_policy_id || ctx.config.default_return_policy_id;

  if (candidateId) {
    try {
      const pol = await call(ctx, `/sell/account/v1/return_policy/${candidateId}`);
      if (pol?.returnPolicyId) return candidateId;
    } catch {}
  }

  try {
    const res = await call(ctx, `/sell/account/v1/return_policy?marketplace_id=${mId}`);
    const list: any[] = res?.returnPolicies ?? [];
    if (list[0]?.returnPolicyId) {
      const validId = String(list[0].returnPolicyId);
      ctx.config.ebay_return_policy_id = validId;
      return validId;
    }
  } catch {}

  // Auto-create standard 30-day return policy
  try {
    const created = await call(ctx, "/sell/account/v1/return_policy", {
      method: "POST",
      body: JSON.stringify({
        name: `Standard Returns (${mId}) - Auto`,
        description: "30-day buyer pays return shipping policy",
        marketplaceId: mId,
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
        returnsAccepted: true,
        returnPeriod: { value: 30, unit: "DAY" },
        refundMethod: "MONEY_BACK",
        returnShippingCostPayer: "BUYER",
      }),
    });

    if (created?.returnPolicyId) {
      const createdId = String(created.returnPolicyId);
      ctx.config.ebay_return_policy_id = createdId;
      return createdId;
    }
  } catch (err: any) {
    console.warn(`[eBay ensureValidReturnPolicy] Warning: ${err.message}`);
  }

  return candidateId || "";
}

/**
 * Ensures a valid payment policy exists or creates a default standard payment policy.
 */
export async function ensureValidPaymentPolicy(
  ctx: ConnectorContext,
  preferredPolicyId?: string,
): Promise<string> {
  const mId = marketplaceId(ctx);
  const candidateId = preferredPolicyId || ctx.config.ebay_payment_policy_id || ctx.config.default_payment_policy_id;

  if (candidateId) {
    try {
      const pol = await call(ctx, `/sell/account/v1/payment_policy/${candidateId}`);
      if (pol?.paymentPolicyId) return candidateId;
    } catch {}
  }

  try {
    const res = await call(ctx, `/sell/account/v1/payment_policy?marketplace_id=${mId}`);
    const list: any[] = res?.paymentPolicies ?? [];
    if (list[0]?.paymentPolicyId) {
      const validId = String(list[0].paymentPolicyId);
      ctx.config.ebay_payment_policy_id = validId;
      return validId;
    }
  } catch {}

  // Auto-create standard payment policy (eBay Managed Payments)
  try {
    const created = await call(ctx, "/sell/account/v1/payment_policy", {
      method: "POST",
      body: JSON.stringify({
        name: `Standard Managed Payments (${mId}) - Auto`,
        description: "Standard eBay managed payments policy with immediate payment",
        marketplaceId: mId,
        categoryTypes: [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES", default: true }],
        immediatePay: false,
      }),
    });

    if (created?.paymentPolicyId) {
      const createdId = String(created.paymentPolicyId);
      ctx.config.ebay_payment_policy_id = createdId;
      return createdId;
    }
  } catch (err: any) {
    console.warn(`[eBay ensureValidPaymentPolicy] Warning: ${err.message}`);
  }

  return candidateId || "";
}
