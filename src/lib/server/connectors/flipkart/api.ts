/**
 * Flipkart API client, OAuth token handling, and FSN resolution.
 */
import { ConnectorError, classifyStatus, type ConnectorContext } from "../../connector";
import { createHash } from "node:crypto";
import {
  FLIPKART_PROD_URL,
  FLIPKART_SANDBOX_URL,
  FLIPKART_TOKEN_MARGIN_MS,
} from "./manifest";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();
export const fsnCache = new Map<string, string>();

export const base = (ctx: ConnectorContext): string =>
  ctx.config.sandbox ? FLIPKART_SANDBOX_URL : FLIPKART_PROD_URL;

export async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { client_id, client_secret } = ctx.credentials;
  if (!client_id || !client_secret) {
    throw new ConnectorError("missing Flipkart client_id/client_secret", "AUTHENTICATION");
  }

  const cacheKey = createHash("sha256")
    .update(`${base(ctx)}|${client_id}|${client_secret}`)
    .digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const basic = Buffer.from(`${client_id}:${client_secret}`).toString("base64");
  const res = await fetch(
    `${base(ctx)}/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api`,
    { headers: { Authorization: `Basic ${basic}` } },
  );
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const body = (await res.json()) as { access_token: string; expires_in?: number };
  const lifetimeMs = (body.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - FLIPKART_TOKEN_MARGIN_MS),
  });

  return body.access_token;
}

export async function call(
  ctx: ConnectorContext,
  path: string,
  init: RequestInit = {},
): Promise<any> {
  const token = await accessToken(ctx);
  const res = await fetch(`${base(ctx)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after") ?? 30);
    throw new ConnectorError("Flipkart rate limit", "RATE_LIMITED", { retryAfterMs: ra * 1000 });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  return res.status === 204 ? null : res.json();
}

export function locationId(ctx: ConnectorContext): string {
  const id = ctx.config.location_id;
  if (!id) {
    throw new ConnectorError(
      "config.location_id is required for Flipkart listing and inventory writes — set it in the channel's Extra config (see the setup guide)",
      "VALIDATION",
    );
  }
  return String(id);
}

export function fsnKey(ctx: ConnectorContext, sku: string): string {
  const app = createHash("sha256")
    .update(`${base(ctx)}|${ctx.credentials.client_id ?? ""}`)
    .digest("hex");
  return `${app}|${sku}`;
}

export async function resolveFsn(ctx: ConnectorContext, sku: string): Promise<string> {
  const cached = fsnCache.get(fsnKey(ctx, sku));
  if (cached) return cached;

  const body = await call(ctx, `/sellers/listings/v3/${encodeURIComponent(sku)}`);
  const entry =
    body?.[sku] ??
    (Array.isArray(body?.available)
      ? body.available.find((l: any) => (l?.sku_id ?? l?.skuId) === sku) ?? body.available[0]
      : undefined);
  const fsn = entry?.product_id ?? entry?.productId ?? entry?.fsn;
  if (!fsn) {
    throw new ConnectorError(
      `cannot resolve the Flipkart product ID (FSN) for SKU ${sku} — republish the product so attributes.flipkart_fsn reaches this channel`,
      "VALIDATION",
      { details: body },
    );
  }
  fsnCache.set(fsnKey(ctx, sku), String(fsn));
  return String(fsn);
}

export function checkSkuResult(ctx: ConnectorContext, body: any, sku: string, what: string): void {
  const entry = body?.[sku];
  const status = String(entry?.status ?? "").toUpperCase();
  if (status === "FAILURE") {
    const detail = [...(entry?.errors ?? []), ...(entry?.attribute_errors ?? [])]
      .map((e: any) => (typeof e === "string" ? e : e?.description ?? e?.message ?? JSON.stringify(e)))
      .join("; ");
    throw new ConnectorError(
      `Flipkart rejected ${what} for ${sku}: ${detail || "no detail returned"}`,
      "VALIDATION",
      { details: entry },
    );
  }
  if (status === "WARNING") {
    ctx.log(`flipkart: ${what} for ${sku} accepted with warnings`, { entry });
  }
}

export function nextPagePath(url: string): string {
  if (/^https?:\/\//.test(url)) {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  }
  return url.startsWith("/sellers") ? url : `/sellers${url.startsWith("/") ? "" : "/"}${url}`;
}
