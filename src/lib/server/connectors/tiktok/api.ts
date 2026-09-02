/**
 * TikTok Shop API signing, token refresh, and request transport.
 */
import { ConnectorError, classifyStatus, type CanonicalImage, type ConnectorContext } from "../../connector";
import { createHash, createHmac } from "node:crypto";
import {
  TIKTOK_AUTH_API,
  TIKTOK_OPEN_API,
  TIKTOK_TOKEN_MARGIN_MS,
} from "./manifest";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
const cipherCache = new Map<string, string>();

export const sha256 = (input: string): string =>
  createHash("sha256").update(input).digest("hex");

export function signedUrl(
  appSecret: string,
  path: string,
  query: Record<string, string>,
  body?: string,
): string {
  const sortedPairs = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join("");
  const sign = createHmac("sha256", appSecret)
    .update(appSecret + path + sortedPairs + (body ?? "") + appSecret)
    .digest("hex");
  return `${TIKTOK_OPEN_API}${path}?${new URLSearchParams({ ...query, sign }).toString()}`;
}

export function tokenExpiryMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Date.now() + 3_600_000 - TIKTOK_TOKEN_MARGIN_MS;
  const absoluteMs = n > 1_000_000_000 ? n * 1000 : Date.now() + n * 1000;
  return absoluteMs - TIKTOK_TOKEN_MARGIN_MS;
}

export function classifyEnvelope(env: {
  code: number;
  message?: string;
  request_id?: string;
}): ConnectorError {
  const msg = `TikTok error ${env.code}: ${env.message ?? ""} (request ${env.request_id ?? "?"})`;
  const text = (env.message ?? "").toLowerCase();
  if (/token|sign|auth|permission|unauthori|forbidden|access denied/.test(text)) {
    return new ConnectorError(msg, "AUTHENTICATION");
  }
  if (/rate|throttl|frequency|too many|quota/.test(text)) {
    return new ConnectorError(msg, "RATE_LIMITED", { retryAfterMs: 60_000 });
  }
  if (/invalid|param|required|missing|illegal|exceed|not exist|duplicate/.test(text)) {
    return new ConnectorError(msg, "VALIDATION");
  }
  return new ConnectorError(msg, "UNKNOWN");
}

export async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { app_key, app_secret, access_token, refresh_token } = ctx.credentials;
  if (!app_key || !app_secret) {
    throw new ConnectorError("missing TikTok app_key/app_secret", "AUTHENTICATION");
  }

  if (!refresh_token) {
    if (!access_token) throw new ConnectorError("missing TikTok access_token", "AUTHENTICATION");
    return access_token;
  }

  const cacheKey = sha256(`${app_key}|${refresh_token}`);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const qs = new URLSearchParams({
    app_key,
    app_secret,
    refresh_token,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${TIKTOK_AUTH_API}/api/v2/token/refresh?${qs.toString()}`);
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const body = (await res.json()) as {
    code?: number;
    message?: string;
    request_id?: string;
    data?: { access_token?: string; access_token_expire_in?: number };
  };
  if (body?.code !== 0 || !body?.data?.access_token) {
    const err = classifyEnvelope({
      code: body?.code ?? -1,
      message: body?.message ?? "token refresh returned no access_token",
      request_id: body?.request_id,
    });
    throw err.class === "UNKNOWN" ? new ConnectorError(err.message, "AUTHENTICATION") : err;
  }

  tokenCache.set(cacheKey, {
    token: body.data.access_token,
    expiresAt: tokenExpiryMs(body.data.access_token_expire_in),
  });
  return body.data.access_token;
}

export interface TikTokRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  form?: FormData;
  shopScoped?: boolean;
}

export async function request(ctx: ConnectorContext, req: TikTokRequest): Promise<any> {
  const token = await accessToken(ctx);
  const { app_key, app_secret } = ctx.credentials;

  const query: Record<string, string> = {
    ...(req.query ?? {}),
    app_key,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (req.shopScoped) query.shop_cipher = await shopCipher(ctx, token);

  const json = req.body !== undefined ? JSON.stringify(req.body) : undefined;
  const url = signedUrl(app_secret, req.path, query, req.form ? undefined : json);

  const headers: Record<string, string> = { "x-tts-access-token": token };
  if (json !== undefined && !req.form) headers["Content-Type"] = "application/json";

  const res = await fetch(url, { method: req.method, headers, body: req.form ?? json });
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after") ?? 60);
    throw new ConnectorError("TikTok Shop rate limit", "RATE_LIMITED", {
      retryAfterMs: (ra > 0 ? ra : 60) * 1000,
    });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const text = await res.text();
  const envelope = text ? JSON.parse(text) : null;
  if (envelope && envelope.code !== 0) throw classifyEnvelope(envelope);
  return envelope?.data ?? null;
}

export async function shopCipher(ctx: ConnectorContext, token: string): Promise<string> {
  const supplied = ctx.credentials.shop_cipher;
  if (supplied) return supplied;

  const cacheKey = sha256(token);
  const cached = cipherCache.get(cacheKey);
  if (cached) return cached;

  const data = await request(ctx, { method: "GET", path: "/authorization/202309/shops" });
  const shops: Array<{ id?: unknown; cipher?: unknown }> = data?.shops ?? [];
  if (shops.length === 0) {
    throw new ConnectorError(
      "TikTok returned no authorized shops for this app — complete the shop authorization flow first",
      "AUTHENTICATION",
    );
  }
  const wanted = ctx.credentials.shop_id;
  const shop = wanted ? shops.find((s) => String(s.id) === wanted) : shops[0];
  if (!shop?.cipher) {
    throw new ConnectorError(
      wanted
        ? `TikTok shop ${wanted} is not among this app's authorized shops`
        : "TikTok authorized shop carries no cipher",
      "AUTHENTICATION",
    );
  }
  const cipher = String(shop.cipher);
  cipherCache.set(cacheKey, cipher);
  return cipher;
}

export async function uploadImages(ctx: ConnectorContext, images: CanonicalImage[]): Promise<string[]> {
  const uris: string[] = [];
  for (const im of images.slice(0, 9)) {
    try {
      const res = await fetch(im.url);
      if (!res.ok) throw new Error(`image fetch failed (${res.status})`);
      const bytes = await res.arrayBuffer();
      const type = res.headers.get("content-type") ?? "image/jpeg";
      const name = im.url.split("/").pop()?.split("?")[0] || "image";
      const form = new FormData();
      form.append("data", new Blob([bytes], { type }), name);
      const data = await request(ctx, {
        method: "POST",
        path: "/product/202309/images/upload",
        form,
        shopScoped: true,
      });
      if (data?.uri) {
        uris.push(String(data.uri));
      } else {
        ctx.log(`tiktok image upload returned no uri`, { position: im.position });
      }
    } catch (e) {
      if (
        e instanceof ConnectorError &&
        (e.class === "AUTHENTICATION" || e.class === "RATE_LIMITED" || e.class === "RETRYABLE")
      ) {
        throw e;
      }
      ctx.log(`tiktok image upload skipped: ${(e as Error).message}`, { position: im.position });
    }
  }
  return uris;
}
