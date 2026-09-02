/**
 * Meesho API transport and authentication helpers.
 */
import { ConnectorError, classifyStatus, type ConnectorContext } from "../../connector";
import { MEESHO_API_PROD, MEESHO_API_TEST } from "./manifest";

export async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const { api_key, api_secret, supplier_id } = ctx.credentials;
  if (!api_key || !api_secret) {
    throw new ConnectorError("missing Meesho api_key/api_secret", "AUTHENTICATION");
  }
  const base = ctx.config.sandbox ? MEESHO_API_TEST : MEESHO_API_PROD;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      merchant: api_key,
      security: api_secret,
      timestamp: String(Math.floor(Date.now() / 1000)),
      ...(supplier_id ? { supplier_identifier: supplier_id } : {}),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after") ?? 60);
    throw new ConnectorError("Meesho rate limit", "RATE_LIMITED", { retryAfterMs: ra * 1000 });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
