/**
 * Litekart platform adapter.
 *
 * The adapter's only job is to turn Litekart's API shape into the canonical
 * model. The core never imports Litekart types and never learns a Litekart
 * field name -- that is what keeps Litekart "the first adapter, not the
 * definition of the platform".
 *
 * Configure a store with platform=litekart plus { base_url, api_token } to
 * import a real catalogue. Without those, the store is a native catalogue and
 * this adapter is simply never invoked.
 */
import { ConnectorError, classifyStatus } from "../connector";

export interface PlatformProduct {
  externalId: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  attributes: Record<string, unknown>;
  images: Array<{ url: string; alt: string; position: number }>;
  variants: Array<{
    externalId: string;
    sku: string;
    barcode: string;
    options: Record<string, string>;
    priceCents: number;
    mrpCents: number;
    currency: string;
    available: number;
    weightG: number;
  }>;
  weightG: number;
  hsnCode: string;
  taxRateBp: number;
  sourceUpdatedAt: string;
}

export interface PlatformAdapter {
  name: string;
  health(cfg: LitekartConfig): Promise<{ status: string; detail?: string }>;
  listProducts(cfg: LitekartConfig, page: number, pageSize: number): Promise<PlatformProduct[]>;
}

export interface LitekartConfig {
  baseUrl: string;
  apiToken: string;
  storeId?: string;
}

function rupeesToCents(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Litekart product JSON -> canonical. The only place Litekart names appear. */
export function normalizeProduct(raw: any): PlatformProduct {
  const variants = Array.isArray(raw.variants) && raw.variants.length > 0 ? raw.variants : [raw];

  return {
    externalId: String(raw._id ?? raw.id ?? ""),
    sku: String(raw.sku ?? raw.slug ?? raw._id ?? ""),
    title: String(raw.name ?? raw.title ?? ""),
    description: String(raw.description ?? raw.short_description ?? ""),
    brand: String(raw.brand?.name ?? raw.brand ?? ""),
    category: String(raw.category?.name ?? raw.category ?? ""),
    attributes: raw.attributes ?? raw.specifications ?? {},
    images: (raw.images ?? raw.media ?? []).map((img: any, i: number) => ({
      url: typeof img === "string" ? img : String(img.url ?? img.src ?? ""),
      alt: typeof img === "string" ? "" : String(img.alt ?? ""),
      position: i,
    })),
    variants: variants.map((v: any, i: number) => ({
      externalId: String(v._id ?? v.id ?? `${raw._id}-${i}`),
      sku: String(v.sku ?? raw.sku ?? ""),
      barcode: String(v.barcode ?? v.ean ?? ""),
      options: v.options ?? v.attributes ?? {},
      priceCents: rupeesToCents(v.price ?? raw.price),
      mrpCents: rupeesToCents(v.mrp ?? raw.mrp ?? v.price ?? raw.price),
      currency: String(raw.currency ?? "INR"),
      available: Number(v.stock ?? v.quantity ?? raw.stock ?? 0),
      weightG: Number(v.weight ?? raw.weight ?? 0),
    })),
    weightG: Number(raw.weight ?? 0),
    hsnCode: String(raw.hsn ?? raw.hsn_code ?? ""),
    taxRateBp: Math.round(Number(raw.tax ?? raw.gst ?? 0) * 100),
    sourceUpdatedAt: String(raw.updatedAt ?? raw.updated_at ?? new Date().toISOString()),
  };
}

async function call(cfg: LitekartConfig, path: string): Promise<any> {
  if (!cfg.baseUrl) throw new ConnectorError("litekart base_url not configured", "VALIDATION");
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
    headers: {
      Authorization: `Bearer ${cfg.apiToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  return res.json();
}

export const litekart: PlatformAdapter = {
  name: "litekart",

  async health(cfg) {
    try {
      await call(cfg, "/api/products?limit=1");
      return { status: "HEALTHY" };
    } catch (e) {
      const err = e as ConnectorError;
      return {
        status: err.class === "AUTHENTICATION" ? "AUTH_FAILURE" : "API_FAILURE",
        detail: err.message,
      };
    }
  },

  async listProducts(cfg, page, pageSize) {
    // Pagination keeps the import resumable and restart-safe (spec 10).
    const body = await call(cfg, `/api/products?page=${page}&limit=${pageSize}`);
    const items = body?.data ?? body?.products ?? body?.results ?? [];
    return items.map(normalizeProduct);
  },
};
