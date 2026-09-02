/**
 * Amazon SP-API client, token management, and authentication helpers.
 */
import { ConnectorError, classifyStatus, type ConnectorContext } from "../../connector";
import { createHash } from "node:crypto";
import {
  AMAZON_MARKETPLACES,
  AMAZON_REGION_HOSTS,
  AMAZON_TOKEN_URL,
  AMAZON_TOKEN_MARGIN_MS,
} from "./manifest";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function marketplace(ctx: ConnectorContext) {
  const code = String(ctx.config.marketplace ?? "IN").toUpperCase();
  const m = AMAZON_MARKETPLACES[code];
  if (!m) {
    throw new ConnectorError(
      `unsupported Amazon marketplace "${code}" (expected one of ${Object.keys(AMAZON_MARKETPLACES).join(", ")})`,
      "VALIDATION",
    );
  }
  return m;
}

export const sellerId = (ctx: ConnectorContext): string => {
  const id = ctx.credentials.seller_id ?? ctx.config.seller_id;
  if (!id) throw new ConnectorError("missing Amazon seller_id", "AUTHENTICATION");
  return String(id);
};

export async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { client_id, client_secret, refresh_token } = ctx.credentials;
  if (!client_id || !client_secret || !refresh_token) {
    throw new ConnectorError(
      "missing Amazon client_id/client_secret/refresh_token",
      "AUTHENTICATION",
    );
  }

  const cacheKey = createHash("sha256").update(`${client_id}|${refresh_token}`).digest("hex");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(AMAZON_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      client_id,
      client_secret,
    }),
  });
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  const lifetimeMs = (body.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - AMAZON_TOKEN_MARGIN_MS),
  });
  return body.access_token;
}

export async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const token = await accessToken(ctx);
  const host = AMAZON_REGION_HOSTS[marketplace(ctx).region];
  const res = await fetch(`${host}${path}`, {
    ...init,
    headers: {
      "x-amz-access-token": token,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429) {
    throw new ConnectorError("Amazon SP-API throttled", "RATE_LIMITED", { retryAfterMs: 60_000 });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function rejectInvalid(body: any, what: string): void {
  if (body?.status !== "INVALID") return;
  throw new ConnectorError(
    `Amazon rejected the ${what}: ${(body.issues ?? []).map((i: any) => i.message).join("; ")}`,
    "VALIDATION",
    { details: body.issues },
  );
}

export async function restrictedToken(ctx: ConnectorContext): Promise<string | null> {
  try {
    const body = await call(ctx, "/tokens/2021-03-01/restrictedDataToken", {
      method: "POST",
      body: JSON.stringify({
        restrictedResources: [
          {
            method: "GET",
            path: "/orders/v0/orders",
            dataElements: ["buyerInfo", "shippingAddress"],
          },
        ],
      }),
    });
    return body?.restrictedDataToken ?? null;
  } catch (e) {
    const err = e as ConnectorError;
    if (err.class === "AUTHENTICATION") {
      ctx.log(
        "restricted data token refused (app lacks the restricted PII role); importing orders without buyer PII",
      );
      return null;
    }
    throw e;
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
