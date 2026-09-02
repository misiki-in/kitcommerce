/**
 * Shared HTTP helpers for marketplace connectors.
 */
import { ConnectorError, classifyStatus } from "../../connector";

export interface RequestOptions extends RequestInit {
  baseUrl?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
}

/**
 * Builds a URL with query parameters.
 */
export function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | boolean | undefined | null>): string {
  const url = new URL(path.startsWith("http") ? path : `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  return url.toString();
}

/**
 * Executes an HTTP fetch request with classified error handling.
 */
export async function fetchJson<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, options);

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 60);
    throw new ConnectorError("Rate limit exceeded", "RATE_LIMITED", {
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60000,
    });
  }

  const text = await res.text();
  if (!res.ok) {
    throw classifyStatus(res.status, text);
  }

  if (!text.trim()) return null as unknown as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}
