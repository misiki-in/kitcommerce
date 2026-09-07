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
    fulfillmentPolicies = list.map((p: any) => ({
      id: String(p.fulfillmentPolicyId),
      name: p.name || `Fulfillment Policy #${p.fulfillmentPolicyId}`,
      description: p.description,
    }));
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

    // If no merchant location exists yet, auto-create a default location
    if (locations.length === 0) {
      const defaultKey = "DEFAULT_WAREHOUSE";
      try {
        await call(ctx, `/sell/inventory/v1/location/${defaultKey}`, {
          method: "POST",
          body: JSON.stringify({
            location: {
              address: {
                addressLine1: ctx.seller?.address?.line1 || "123 Commerce Way",
                addressLine2: ctx.seller?.address?.line2 || undefined,
                city: ctx.seller?.address?.city || "San Jose",
                stateOrProvince: ctx.seller?.address?.state || "CA",
                postalCode: ctx.seller?.address?.postalCode || "95125",
                country: ctx.seller?.address?.country || "US",
              },
            },
            locationTypes: ["WAREHOUSE"],
            merchantLocationStatus: "ENABLED",
            name: ctx.seller?.storeName ? `${ctx.seller.storeName} Warehouse` : "Main Warehouse",
          }),
        });
        locations.push({ key: defaultKey, name: "Main Warehouse", status: "ENABLED" });
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
 * Ensures an active merchant location key is available on eBay.
 * Creates DEFAULT_WAREHOUSE if no location is present.
 */
export async function ensureEbayLocation(ctx: ConnectorContext, preferredKey?: string): Promise<string> {
  const key = preferredKey || ctx.config.ebay_merchant_location_key || "DEFAULT_WAREHOUSE";

  // Check if location exists
  try {
    const existing = await call(ctx, `/sell/inventory/v1/location/${encodeURIComponent(key)}`);
    if (existing && existing.merchantLocationStatus === "ENABLED") {
      return key;
    }
  } catch {
    // Location does not exist, create it
  }

  // Create/register location
  try {
    await call(ctx, `/sell/inventory/v1/location/${encodeURIComponent(key)}`, {
      method: "POST",
      body: JSON.stringify({
        location: {
          address: {
            addressLine1: ctx.seller?.address?.line1 || "123 Commerce Way",
            addressLine2: ctx.seller?.address?.line2 || undefined,
            city: ctx.seller?.address?.city || "San Jose",
            stateOrProvince: ctx.seller?.address?.state || "CA",
            postalCode: ctx.seller?.address?.postalCode || "95125",
            country: ctx.seller?.address?.country || "US",
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

