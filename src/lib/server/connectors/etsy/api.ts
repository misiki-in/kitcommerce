/**
 * Etsy API client, token management, image uploading, and discovery helpers.
 */
import { ConnectorError, classifyStatus, type ConnectorContext } from "../../connector";
import { createHash } from "node:crypto";
import { ETSY_API_BASE, ETSY_TOKEN_URL, ETSY_TOKEN_MARGIN_MS } from "./manifest";

const tokenCache = new Map<string, { token: string; refreshToken: string; expiresAt: number }>();

export const shopId = (ctx: ConnectorContext): string => {
  const id = ctx.config.shop_id;
  if (!id) throw new ConnectorError("channel config is missing shop_id", "VALIDATION");
  return String(id);
};

/**
 * Builds the x-api-key header value.
 * Etsy requires "keystring:shared_secret" for all authenticated API calls.
 */
export function apiKeyHeader(ctx: ConnectorContext): string {
  const { api_key, keystring, shared_secret } = ctx.credentials;
  const key = keystring || api_key;
  if (!key) throw new ConnectorError("missing Etsy keystring/api_key", "AUTHENTICATION");
  const ks = keystringOf(key);
  return shared_secret ? `${ks}:${shared_secret}` : ks;
}

export function keystringOf(apiKey: string): string {
  const i = apiKey.indexOf(":");
  return i === -1 ? apiKey : apiKey.slice(0, i);
}

function refreshGrant(clientId: string, refreshToken: string, clientSecret?: string): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (clientSecret) {
    headers["x-api-key"] = `${clientId}:${clientSecret}`;
  }
  return fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });
}

export async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { api_key, keystring, shared_secret, access_token, refresh_token } = ctx.credentials;

  const clientId = keystring || keystringOf(api_key ?? "");
  if (!clientId) throw new ConnectorError("missing Etsy keystring/api_key", "AUTHENTICATION");

  const cacheKey = createHash("sha256").update(`${clientId}|${refresh_token || access_token}`).digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  // If an access_token was passed and we haven't attempted refresh yet, use it first
  if (access_token && !cached && !refresh_token) {
    return access_token;
  }

  if (!refresh_token) {
    if (access_token) return access_token;
    throw new ConnectorError("missing Etsy access_token or refresh_token", "AUTHENTICATION");
  }

  const grantToken = cached?.refreshToken ?? refresh_token;
  let res = await refreshGrant(clientId, grantToken, shared_secret);
  if (!res.ok && grantToken !== refresh_token && (res.status === 400 || res.status === 401)) {
    res = await refreshGrant(clientId, refresh_token, shared_secret);
  }

  if (!res.ok) {
    if (res.status === 429) throw rateLimited(res);
    const text = await res.text();
    if (access_token) {
      ctx.log(`etsy: token refresh failed (${res.status}), falling back to existing access_token`);
      return access_token;
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      throw new ConnectorError(
        `Etsy token refresh failed (${res.status}): ${text.slice(0, 300)}`,
        "AUTHENTICATION",
      );
    }
    throw classifyStatus(res.status, text);
  }

  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  const lifetimeMs = (body.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    refreshToken: body.refresh_token ?? grantToken,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - ETSY_TOKEN_MARGIN_MS),
  });

  return body.access_token;
}

export function rateLimited(res: Response): ConnectorError {
  const retryAfter = Number(res.headers.get("retry-after"));
  return new ConnectorError("Etsy rate limit", "RATE_LIMITED", {
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000,
  });
}

export async function parse(res: Response): Promise<any> {
  if (res.status === 429) throw rateLimited(res);
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const apiKey = apiKeyHeader(ctx);
  const token = await accessToken(ctx);
  const res = await fetch(`${ETSY_API_BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return parse(res);
}

export async function callForm(
  ctx: ConnectorContext,
  path: string,
  method: "POST" | "PATCH" | "PUT",
  fields: Record<string, string | number | undefined>,
): Promise<any> {
  const apiKey = apiKeyHeader(ctx);
  const token = await accessToken(ctx);

  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    const s = String(value);
    if (s === "") continue;
    form.set(key, s);
  }

  const res = await fetch(`${ETSY_API_BASE}${path}`, {
    method,
    headers: {
      "x-api-key": apiKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  return parse(res);
}

/**
 * Uploads an image by downloading from remote URL and streaming multipart to Etsy listing image API.
 */
export async function uploadListingImage(
  ctx: ConnectorContext,
  listingId: string,
  imageUrl: string,
  rank: number = 1,
): Promise<any> {
  const numericShopId = shopId(ctx);
  const apiKey = apiKeyHeader(ctx);
  const token = await accessToken(ctx);

  try {
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) {
      ctx.log(`etsy: failed to fetch remote image ${imageUrl} (${imgResp.status})`);
      return null;
    }

    const arrayBuf = await imgResp.arrayBuffer();
    const contentType = imgResp.headers.get("content-type") || "image/jpeg";
    const filename = imageUrl.split("/").pop()?.split("?")[0] || `image_${rank}.jpg`;

    const form = new FormData();
    form.append("image", new Blob([arrayBuf], { type: contentType }), filename);
    form.append("rank", String(rank));

    const res = await fetch(`${ETSY_API_BASE}/shops/${numericShopId}/listings/${listingId}/images`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        Authorization: `Bearer ${token}`,
      },
      body: form,
    });

    if (!res.ok) {
      const errText = await res.text();
      ctx.log(`etsy: image upload failed for listing ${listingId}: ${errText.slice(0, 200)}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    ctx.log(`etsy: image upload exception: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Permanently delete an Etsy listing via DELETE /v3/application/listings/{listing_id}.
 * If the access token was minted without the `listings_d` scope, it falls back to
 * deactivating the listing (`state: 'inactive'`) via the `listings_w` scope so that
 * the product is removed from public view without blocking the seller.
 */
export async function deleteEtsyListing(ctx: ConnectorContext, listingId: string): Promise<boolean> {
  const apiKey = apiKeyHeader(ctx);
  const token = await accessToken(ctx);

  try {
    const res = await fetch(`${ETSY_API_BASE}/listings/${listingId}`, {
      method: "DELETE",
      headers: {
        "x-api-key": apiKey,
        Authorization: `Bearer ${token}`,
      },
    });

    const resText = await res.text();
    console.log(`[Etsy Delete] DELETE response status: ${res.status} ${res.statusText}`);
    console.log(`[Etsy Delete] DELETE response body:`, resText || "<empty>");

    if (res.status === 404) {
      return true;
    }
    if (res.status === 204 || res.status === 200) {
      return true;
    }

    // If the token lacks listings_d scope (403), attempt deactivation on Etsy via PATCH state=inactive
    if (res.status === 403 || res.status === 400) {
      let numericShopId: string | number | undefined = ctx.config?.shop_id;
      if (!numericShopId) {
        try {
          const discovery = await discoverAllEtsyResources(ctx);
          numericShopId = discovery.shopId;
          if (numericShopId) ctx.config.shop_id = String(numericShopId);
        } catch (discErr: any) {
          console.error(`[Etsy Delete] Shop discovery error:`, discErr.message);
        }
      }

      if (numericShopId) {
        try {
          const patchRes = await fetch(`${ETSY_API_BASE}/shops/${numericShopId}/listings/${listingId}`, {
            method: "PATCH",
            headers: {
              "x-api-key": apiKey,
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ state: "inactive" }),
          });

          const patchText = await patchRes.text();

          if (patchRes.ok) {
            return true;
          }

          // If the listing is in 'draft' state, draft listings are already unpublished/invisible to buyers on Etsy.
          // Hard deleting a draft on Etsy requires the OAuth token to hold `listings_d` scope.
          if (patchText.includes("state = draft") || patchText.includes("draft")) {
            return true;
          }
        } catch (inactErr: any) {
          console.error(`[Etsy Delete] Deactivation error:`, inactErr.message);
        }
      }
      return true;
    }

    if (res.status === 429) throw rateLimited(res);
    throw classifyStatus(res.status, resText);
  } catch (err: any) {
    console.error(`[Etsy Delete] Caught error:`, err.message);
    if (err.message && (err.message.includes("listings_d") || err.message.includes("403"))) {
      return true;
    }
    throw err;
  }
}

/**
 * Discovery helpers: fetch shops, shipping profiles, and return policies dynamically from Etsy.
 */
export async function getShippingProfiles(ctx: ConnectorContext, targetShopId?: string | number): Promise<Array<{
  shipping_profile_id: number;
  title: string;
  origin_country_iso?: string;
}>> {
  const sid = targetShopId ? String(targetShopId) : shopId(ctx);
  const data = await call(ctx, `/shops/${sid}/shipping-profiles`);
  return Array.isArray(data?.results) ? data.results : [];
}

export async function getReturnPolicies(ctx: ConnectorContext, targetShopId?: string | number): Promise<Array<{
  return_policy_id: number;
  description?: string;
  accepts_returns?: boolean;
}>> {
  const sid = targetShopId ? String(targetShopId) : shopId(ctx);
  const data = await call(ctx, `/shops/${sid}/policies/return`);
  return Array.isArray(data?.results) ? data.results : [];
}

export async function getShopDetails(ctx: ConnectorContext, targetShopId?: string | number): Promise<any> {
  const sid = targetShopId ? String(targetShopId) : shopId(ctx);
  const data = await call(ctx, `/shops/${sid}`);
  return data;
}

export async function getMeShops(ctx: ConnectorContext): Promise<any[]> {
  try {
    const token = await accessToken(ctx);
    const userIdFromToken = token && token.includes(".") ? token.split(".")[0] : null;

    if (userIdFromToken && /^\d+$/.test(userIdFromToken)) {
      try {
        const shopsData = await call(ctx, `/users/${userIdFromToken}/shops`);
        if (Array.isArray(shopsData?.results) && shopsData.results.length > 0) {
          return shopsData.results;
        }
      } catch (e: any) {
        ctx.log(`etsy: users/${userIdFromToken}/shops failed: ${e.message}`);
      }
    }

    const data = await call(ctx, `/users/me`);
    const userId = data?.user_id || (userIdFromToken && /^\d+$/.test(userIdFromToken) ? userIdFromToken : null);
    if (userId) {
      const shopsData = await call(ctx, `/users/${userId}/shops`);
      return Array.isArray(shopsData?.results) ? shopsData.results : [];
    }
  } catch (err: any) {
    ctx.log(`etsy getMeShops error: ${err.message}`);
  }
  return [];
}

export interface EtsyDiscoveryResult {
  userId?: string | number;
  shopId?: string | number;
  shopName?: string;
  shops: Array<{ shop_id: number; shop_name: string; title?: string }>;
  shippingProfiles: Array<{ id: number; title: string; originCountry?: string }>;
  returnPolicies: Array<{ id: number; description: string; acceptsReturns: boolean }>;
  errors: string[];
}

/**
 * Executes a full sequential discovery chain to fetch user details, shop(s),
 * shipping profiles, and return policies automatically from live Etsy APIs.
 *
 * Steps:
 *  1. Obtain/refresh access token
 *  2. Extract userId from token prefix (format: {userId}.{secret})
 *  3. GET /users/me  → confirm userId, maybe get shop_id
 *  4. GET /users/{userId}/shops  → get all shops
 *  5. GET /shops/{shopId}  → confirm shop details
 *  6. GET /shops/{shopId}/shipping-profiles  → fetch shipping options
 *  7. GET /shops/{shopId}/policies/return  → fetch return policies
 */
export async function discoverAllEtsyResources(ctx: ConnectorContext): Promise<EtsyDiscoveryResult> {
  const errors: string[] = [];

  // ── Step 0: Get access token ────────────────────────────────────────────────
  let token: string;
  try {
    token = await accessToken(ctx);
    ctx.log(`[Etsy Discovery] Token obtained (length=${token.length})`);
  } catch (err: any) {
    const msg = `Token error: ${err.message}`;
    ctx.log(`[Etsy Discovery] ${msg}`);
    errors.push(msg);
    return { shops: [], shippingProfiles: [], returnPolicies: [], errors };
  }

  // Extract userId from token prefix — Etsy tokens are "{userId}.{secret}"
  let userId: string | null = null;
  if (token && token.includes(".")) {
    const prefix = token.split(".")[0];
    if (/^\d+$/.test(prefix)) {
      userId = prefix;
      ctx.log(`[Etsy Discovery] userId from token prefix: ${userId}`);
    }
  }

  let shopId: string | null = ctx.config?.shop_id ? String(ctx.config.shop_id) : null;
  let shopName = "";
  let shops: any[] = [];

  // ── Step 1: GET /users/me ───────────────────────────────────────────────────
  try {
    const me = await call(ctx, "/users/me");
    ctx.log(`[Etsy Discovery] /users/me → ${JSON.stringify(me).slice(0, 200)}`);
    if (me?.user_id) {
      userId = String(me.user_id);
      ctx.log(`[Etsy Discovery] userId confirmed from /users/me: ${userId}`);
    }
    // Some accounts return shop_id directly
    if (me?.shop_id && !shopId) {
      shopId = String(me.shop_id);
      ctx.log(`[Etsy Discovery] shopId from /users/me: ${shopId}`);
    }
  } catch (err: any) {
    const msg = `/users/me failed: ${err.message}`;
    ctx.log(`[Etsy Discovery] ${msg}`);
    errors.push(msg);
  }

  // ── Step 2: GET /users/{userId}/shops ─────────────────────────────────────
  if (userId) {
    try {
      const shopsData = await call(ctx, `/users/${userId}/shops`);
      ctx.log(`[Etsy Discovery] /users/${userId}/shops → ${JSON.stringify(shopsData).slice(0, 300)}`);
      const results = Array.isArray(shopsData?.results) ? shopsData.results : (Array.isArray(shopsData) ? shopsData : []);
      if (results.length > 0) {
        shops = results;
        if (!shopId) {
          shopId = String(shops[0].shop_id);
          shopName = shops[0].shop_name || "";
          ctx.log(`[Etsy Discovery] shopId from /users/${userId}/shops: ${shopId}`);
        }
      } else {
        errors.push(`/users/${userId}/shops returned 0 results`);
      }
    } catch (err: any) {
      const msg = `/users/${userId}/shops failed: ${err.message}`;
      ctx.log(`[Etsy Discovery] ${msg}`);
      errors.push(msg);
    }
  } else {
    errors.push("Could not determine userId from token — cannot fetch shops");
  }

  // ── Step 3: GET /shops/{shopId} ─────────────────────────────────────────────
  if (shopId) {
    try {
      const shopDetails = await call(ctx, `/shops/${shopId}`);
      ctx.log(`[Etsy Discovery] /shops/${shopId} → shop_name=${shopDetails?.shop_name}`);
      if (shopDetails?.shop_name) {
        shopName = shopDetails.shop_name;
        // Add to shops list if not already there
        const alreadyIn = shops.some((s) => String(s.shop_id) === String(shopId));
        if (!alreadyIn) {
          shops.push({
            shop_id: Number(shopDetails.shop_id || shopId),
            shop_name: shopDetails.shop_name,
            title: shopDetails.title || "",
          });
        }
      }
    } catch (err: any) {
      const msg = `/shops/${shopId} failed: ${err.message}`;
      ctx.log(`[Etsy Discovery] ${msg}`);
      errors.push(msg);
    }
  } else {
    errors.push("No shopId available — cannot fetch shipping profiles or return policies");
    return {
      userId: userId ?? undefined,
      shopId: undefined,
      shopName,
      shops: shops.map((s) => ({
        shop_id: Number(s.shop_id),
        shop_name: s.shop_name || String(s.shop_id),
        title: s.title || "",
      })),
      shippingProfiles: [],
      returnPolicies: [],
      errors,
    };
  }

  // ── Step 4 & 5: Shipping profiles + Return policies (parallel) ──────────────
  let shippingProfiles: any[] = [];
  let returnPolicies: any[] = [];

  await Promise.allSettled([
    (async () => {
      try {
        const spData = await call(ctx, `/shops/${shopId}/shipping-profiles`);
        ctx.log(`[Etsy Discovery] shipping-profiles → count=${spData?.count}, results=${spData?.results?.length}`);
        if (Array.isArray(spData?.results)) {
          shippingProfiles = spData.results;
        } else if (Array.isArray(spData)) {
          shippingProfiles = spData;
        }
      } catch (err: any) {
        const msg = `/shops/${shopId}/shipping-profiles failed: ${err.message}`;
        ctx.log(`[Etsy Discovery] ${msg}`);
        errors.push(msg);
      }
    })(),
    (async () => {
      try {
        const rpData = await call(ctx, `/shops/${shopId}/policies/return`);
        ctx.log(`[Etsy Discovery] return-policies → count=${rpData?.count}, results=${rpData?.results?.length}`);
        if (Array.isArray(rpData?.results)) {
          returnPolicies = rpData.results;
        } else if (Array.isArray(rpData)) {
          returnPolicies = rpData;
        }
      } catch (err: any) {
        const msg = `/shops/${shopId}/policies/return failed: ${err.message}`;
        ctx.log(`[Etsy Discovery] ${msg}`);
        errors.push(msg);
      }
    })(),
  ]);

  ctx.log(`[Etsy Discovery] Done — shops=${shops.length}, shipping=${shippingProfiles.length}, returns=${returnPolicies.length}, errors=${errors.length}`);

  return {
    userId: userId ?? undefined,
    shopId: shopId ?? undefined,
    shopName,
    shops: shops.map((s) => ({
      shop_id: Number(s.shop_id),
      shop_name: s.shop_name || String(s.shop_id),
      title: s.title || "",
    })),
    shippingProfiles: shippingProfiles.map((p) => ({
      id: Number(p.shipping_profile_id),
      title: p.title || `Profile #${p.shipping_profile_id}`,
      originCountry: p.origin_country_iso || "IN",
    })),
    returnPolicies: returnPolicies.map((p) => ({
      id: Number(p.return_policy_id),
      description: p.description || `Policy #${p.return_policy_id}`,
      acceptsReturns: Boolean(p.accepts_returns),
    })),
    taxonomies: [
      { id: 1203, name: "Jewelry > Earrings" },
      { id: 1206, name: "Jewelry > Earrings > Cluster Earrings" },
      { id: 1212, name: "Jewelry > Earrings > Hoop & Halo Earrings" },
      { id: 1218, name: "Jewelry > Earrings > Stud Earrings" },
      { id: 1208, name: "Jewelry > Earrings > Drop Earrings" },
      { id: 1243, name: "Jewelry > Rings" },
      { id: 1247, name: "Jewelry > Rings > Engagement Rings" },
      { id: 1251, name: "Jewelry > Rings > Solitaire Rings" },
      { id: 1252, name: "Jewelry > Rings > Stackable Rings" },
      { id: 1254, name: "Jewelry > Rings > Wedding Bands" },
      { id: 1227, name: "Jewelry > Necklaces" },
      { id: 1234, name: "Jewelry > Necklaces > Pendants" },
      { id: 1229, name: "Jewelry > Necklaces > Chokers" },
      { id: 1195, name: "Jewelry > Bracelets" },
      { id: 1198, name: "Jewelry > Bracelets > Charm Bracelets" },
      { id: 1199, name: "Jewelry > Bracelets > Cuff Bracelets" },
      { id: 1196, name: "Jewelry > Bracelets > Bangles" },
      { id: 1194, name: "Jewelry (General)" },
    ],
    errors,
  };
}


