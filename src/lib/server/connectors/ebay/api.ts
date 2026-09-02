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
