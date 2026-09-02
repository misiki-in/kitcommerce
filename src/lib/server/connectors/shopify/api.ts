/**
 * Shopify GraphQL transport and authentication helpers.
 */
import { ConnectorError, classifyStatus, type ConnectorContext, type CanonicalProduct } from "../../connector";
import { createHash } from "node:crypto";
import { SHOPIFY_API_VERSION, SHOPIFY_TOKEN_MARGIN_MS } from "./manifest";

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export interface UserError {
  field?: string[] | null;
  message: string;
}

export interface GqlError {
  message: string;
  extensions?: { code?: string; cost?: QueryCost };
}

export interface QueryCost {
  requestedQueryCost?: number;
  throttleStatus?: { currentlyAvailable?: number; restoreRate?: number };
}

export function shopDomain(ctx: ConnectorContext): string {
  const domain = ctx.credentials.shop_domain?.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  if (!domain) throw new ConnectorError("missing Shopify shop_domain", "AUTHENTICATION");
  return domain;
}

export const mintCacheKey = (domain: string, clientId: string, clientSecret: string): string =>
  createHash("sha256").update(`${domain}|${clientId}|${clientSecret}`).digest("hex");

export async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { access_token, client_id, client_secret } = ctx.credentials;
  if (access_token) return access_token;
  if (!client_id || !client_secret) {
    throw new ConnectorError(
      "missing Shopify credentials: supply either an Admin API access_token (legacy admin custom app) or a client_id + client_secret (Dev Dashboard app)",
      "AUTHENTICATION",
    );
  }

  const domain = shopDomain(ctx);
  const cacheKey = mintCacheKey(domain, client_id, client_secret);

  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id,
      client_secret,
    }),
  });
  if (!res.ok) {
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after") ?? 2);
      throw new ConnectorError("Shopify throttled the token endpoint", "RATE_LIMITED", {
        retryAfterMs: retryAfter * 1000,
      });
    }
    if (res.status >= 500) throw classifyStatus(res.status, await res.text());
    throw new ConnectorError(
      `Shopify rejected client credentials (${res.status}): ${(await res.text()).slice(0, 500)}`,
      "AUTHENTICATION",
    );
  }

  const body = (await res.json()) as { access_token: string; expires_in?: number };
  const lifetimeMs = (body.expires_in ?? 86_399) * 1000;
  tokenCache.set(cacheKey, {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, lifetimeMs - SHOPIFY_TOKEN_MARGIN_MS),
  });
  return body.access_token;
}

export function throttleRetryMs(cost: QueryCost | undefined): number {
  const requested = Number(cost?.requestedQueryCost);
  const available = Number(cost?.throttleStatus?.currentlyAvailable);
  const restore = Number(cost?.throttleStatus?.restoreRate);
  if (Number.isFinite(requested) && Number.isFinite(available) && restore > 0) {
    const deficit = Math.max(0, requested - available);
    return Math.max(1000, Math.ceil(deficit / restore) * 1000);
  }
  return 2000;
}

export async function postGraphql(
  ctx: ConnectorContext,
  query: string,
  variables: Record<string, unknown>,
): Promise<Response> {
  const token = await accessToken(ctx);
  return fetch(`https://${shopDomain(ctx)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
}

export async function gql<T = any>(
  ctx: ConnectorContext,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let res = await postGraphql(ctx, query, variables);

  if ((res.status === 401 || res.status === 403) && !ctx.credentials.access_token) {
    const { client_id, client_secret } = ctx.credentials;
    if (client_id && client_secret) {
      tokenCache.delete(mintCacheKey(shopDomain(ctx), client_id, client_secret));
      res = await postGraphql(ctx, query, variables);
    }
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 2);
    throw new ConnectorError("Shopify throttled", "RATE_LIMITED", {
      retryAfterMs: retryAfter * 1000,
    });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const body = (await res.json()) as {
    data?: T;
    errors?: GqlError[];
    extensions?: { cost?: QueryCost };
  };
  if (body.errors?.length) {
    const codes = new Set(body.errors.map((e) => e.extensions?.code).filter(Boolean));
    const message = `Shopify: ${body.errors.map((e) => e.message).join("; ")}`;
    if (codes.has("THROTTLED")) {
      const cost = body.extensions?.cost ?? body.errors.find((e) => e.extensions?.cost)?.extensions?.cost;
      throw new ConnectorError(message, "RATE_LIMITED", {
        retryAfterMs: throttleRetryMs(cost),
        details: body.errors,
      });
    }
    if (codes.has("ACCESS_DENIED") || codes.has("SHOP_INACTIVE")) {
      throw new ConnectorError(message, "AUTHENTICATION", { details: body.errors });
    }
    if (codes.has("INTERNAL_SERVER_ERROR")) {
      throw new ConnectorError(message, "RETRYABLE", { details: body.errors });
    }
    throw new ConnectorError(message, "VALIDATION", { details: body.errors });
  }
  if (!body.data) throw new ConnectorError("Shopify returned no data", "UNKNOWN");
  return body.data;
}

export function assertNoUserErrors(errors: UserError[] | undefined, op: string): void {
  if (!errors?.length) return;
  const detail = errors.map((e) => `${e.field?.join(".") ?? "?"}: ${e.message}`).join("; ");
  throw new ConnectorError(`Shopify ${op}: ${detail}`, "VALIDATION", { details: errors });
}

export const locationId = (ctx: ConnectorContext, p?: CanonicalProduct): string | undefined =>
  (p?.attributes as any)?.shopify_location_id ?? ctx.config.location_id;
