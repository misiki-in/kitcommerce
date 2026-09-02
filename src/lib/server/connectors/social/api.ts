/**
 * Meta Graph API transport and connector factory for Instagram and Facebook.
 */
import {
  ConnectorError,
  classifyStatus,
  money,
  type CanonicalProduct,
  type CanonicalVariant,
  type ConnectorContext,
  type InventoryUpdate,
  type Manifest,
  type MarketplaceConnector,
  type PriceUpdate,
  type RemoteOrder,
  type RemoteProduct,
} from "../../connector";
import {
  BATCH_STATUS_DELAY_MS,
  META_CAPABILITIES,
  META_GRAPH,
  META_OPTION_FIELDS,
  META_REQUIRED,
  META_THROTTLE_CODES,
  META_THROTTLE_FALLBACK_MS,
  metaAuth,
  type MetaSpec,
} from "./manifest";

export function metaRetryAfterMs(res: Response): number {
  try {
    const raw = res.headers.get("x-business-use-case-usage");
    if (raw) {
      let minutes = 0;
      for (const entries of Object.values(JSON.parse(raw) as Record<string, unknown>)) {
        for (const e of Array.isArray(entries) ? entries : []) {
          const m = Number((e as any)?.estimated_time_to_regain_access);
          if (Number.isFinite(m) && m > minutes) minutes = m;
        }
      }
      if (minutes > 0) return minutes * 60_000;
    }
  } catch {}
  return META_THROTTLE_FALLBACK_MS;
}

export const metaCondition = (canonical: string): string =>
  canonical === "NEW" ? "new" : canonical === "REFURBISHED" ? "refurbished" : "used";

export function metaOptions(ctx: ConnectorContext, v: CanonicalVariant): Record<string, string> {
  const out: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(v.options ?? {})) {
    const field = META_OPTION_FIELDS[key.toLowerCase()];
    if (field) out[field] = value;
    else dropped.push(key);
  }
  if (dropped.length > 0) {
    ctx.log(
      `Meta catalogue has no field for option(s) ${dropped.join(", ")} on ${v.sku}; dropped`,
    );
  }
  return out;
}

export const metaItem = (
  ctx: ConnectorContext,
  p: CanonicalProduct,
  i: number,
  method: "CREATE" | "UPDATE",
) => {
  const v = p.variants[i]!;
  const a = p.attributes as any;
  const currency = v.currency || ctx.seller.currency;
  const salePrice =
    v.priceCents < v.mrpCents
      ? `${money(v.priceCents)} ${currency}`
      : method === "UPDATE"
        ? ""
        : undefined;
  return {
    id: v.sku,
    item_group_id: p.sku,
    title: p.title,
    description: p.description,
    brand: p.brand,
    condition: metaCondition(String(a.condition ?? "NEW")),
    availability: v.available > 0 ? "in stock" : "out of stock",
    quantity_to_sell_on_facebook: v.available,
    price: `${money(Math.max(v.priceCents, v.mrpCents))} ${currency}`,
    sale_price: salePrice,
    link: a.landing_url ?? "",
    image_link: p.images[0]?.url ?? "",
    additional_image_link: p.images.slice(1, 10).map((im) => im.url),
    ...metaOptions(ctx, v),
  };
};

export function makeMetaConnector(spec: MetaSpec): MarketplaceConnector {
  const manifest: Manifest = {
    name: spec.name,
    displayName: spec.displayName,
    version: "0.1.0",
    platformType: "social",
    group: "Social",
    status: "ready",
    idPrefix: spec.idPrefix,
    authentication: metaAuth,
    credentialsNote: spec.credentialsNote,
    regions: spec.regions,
    capabilities: META_CAPABILITIES,
    requiredFields: META_REQUIRED,
    rateLimits: { requestsPerSecond: 5, burst: 10 },
    docsUrl: "https://developers.facebook.com/docs/commerce-platform",
    setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/meta.md",
    sellerPortalUrl: "https://business.facebook.com/commerce",
  };

  async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
    const token = ctx.credentials.access_token;
    if (!token) {
      throw new ConnectorError(`missing ${spec.displayName} access token`, "AUTHENTICATION");
    }
    const catalog = ctx.credentials.catalog_id;
    if (!catalog) {
      throw new ConnectorError(`missing ${spec.displayName} catalog_id`, "AUTHENTICATION");
    }

    const res = await fetch(`${META_GRAPH}${path.replace("{container}", catalog)}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (res.ok) {
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }

    const text = await res.text();
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      throw new ConnectorError(`${spec.displayName} rate limit`, "RATE_LIMITED", {
        retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : metaRetryAfterMs(res),
      });
    }
    let bodyCode: number | undefined;
    let bodyType: string | undefined;
    try {
      const bodyError = JSON.parse(text)?.error;
      const code = Number(bodyError?.code);
      if (Number.isFinite(code)) bodyCode = code;
      if (typeof bodyError?.type === "string") bodyType = bodyError.type;
    } catch {}

    if (bodyCode !== undefined && META_THROTTLE_CODES.has(bodyCode)) {
      throw new ConnectorError(
        `${spec.displayName} rate limit (Graph error ${bodyCode})`,
        "RATE_LIMITED",
        { retryAfterMs: metaRetryAfterMs(res) },
      );
    }
    if (bodyType === "OAuthException" || bodyCode === 190 || bodyCode === 102) {
      throw new ConnectorError(
        `${spec.displayName} auth failed (${res.status}): ${text.slice(0, 500)}`,
        "AUTHENTICATION",
      );
    }
    throw classifyStatus(res.status, text);
  }

  async function itemsBatch(
    ctx: ConnectorContext,
    requests: Array<{ method: string; data: Record<string, unknown> }>,
  ): Promise<any> {
    const body = await call(ctx, "/{container}/items_batch", {
      method: "POST",
      body: JSON.stringify({ item_type: "PRODUCT_ITEM", requests }),
    });

    const statuses: any[] = Array.isArray(body?.validation_status) ? body.validation_status : [];
    const rejected = statuses.filter((s) => Array.isArray(s?.errors) && s.errors.length > 0);
    if (rejected.length > 0) {
      const detail = rejected
        .map(
          (s: any) =>
            `${s.retailer_id ?? "?"}: ${(s.errors ?? []).map((e: any) => e.message ?? "").join("; ")}`,
        )
        .join(" | ");
      throw new ConnectorError(
        `${spec.displayName} rejected ${rejected.length} item(s): ${detail.slice(0, 500)}`,
        "VALIDATION",
        { details: rejected },
      );
    }

    const handle = body?.handles?.[0];
    if (handle == null) return body;

    await new Promise((resolve) => setTimeout(resolve, BATCH_STATUS_DELAY_MS));
    const status = await call(
      ctx,
      `/{container}/check_batch_request_status?handle=${encodeURIComponent(String(handle))}`,
    );
    const jobs: any[] = Array.isArray(status?.data) ? status.data : [];
    const errors = jobs.flatMap((j) => (Array.isArray(j?.errors) ? j.errors : []));
    if (errors.length > 0) {
      const detail = errors
        .map((e: any) => `${e.retailer_id ?? e.id ?? "?"}: ${e.message ?? ""}`)
        .join(" | ");
      throw new ConnectorError(
        `${spec.displayName} batch failed for ${errors.length} item(s): ${detail.slice(0, 500)}`,
        "VALIDATION",
        { details: errors },
      );
    }
    if (jobs.some((j) => j?.status && j.status !== "finished")) {
      ctx.log(
        `${spec.displayName} batch ${String(handle)} still processing; accepted — items are addressed by retailer id on the next write`,
      );
    }
    return body;
  }

  function toItems(
    ctx: ConnectorContext,
    p: CanonicalProduct,
    method: "CREATE" | "UPDATE",
  ): Record<string, unknown>[] {
    return p.variants.map((_, i) => metaItem(ctx, p, i, method));
  }

  return {
    manifest: () => manifest,

    async health(ctx) {
      try {
        await call(ctx, "/{container}");
        return { status: "HEALTHY" };
      } catch (e) {
        const err = e as ConnectorError;
        return {
          status: err.class === "AUTHENTICATION" ? "AUTH_FAILURE" : "API_FAILURE",
          detail: err.message,
        };
      }
    },

    async createProduct(ctx, p): Promise<RemoteProduct> {
      const body = await itemsBatch(
        ctx,
        toItems(ctx, p, "CREATE").map((data) => ({ method: "CREATE", data })),
      );
      return { remoteId: p.sku, raw: body };
    },

    async updateProduct(ctx, p, remoteId) {
      await itemsBatch(
        ctx,
        toItems(ctx, p, "UPDATE").map((data) => ({ method: "UPDATE", data })),
      );
    },

    async updateInventory(ctx, u: InventoryUpdate) {
      await itemsBatch(ctx, [
        {
          method: "UPDATE",
          data: {
            id: u.sku,
            availability: u.available > 0 ? "in stock" : "out of stock",
            quantity_to_sell_on_facebook: u.available,
          },
        },
      ]);
    },

    async updatePrice(ctx, u: PriceUpdate) {
      const currency = u.currency || ctx.seller.currency;
      await itemsBatch(ctx, [
        {
          method: "UPDATE",
          data: {
            id: u.sku,
            price: `${money(Math.max(u.priceCents, u.mrpCents))} ${currency}`,
            sale_price:
              u.priceCents < u.mrpCents ? `${money(u.priceCents)} ${currency}` : "",
          },
        },
      ]);
    },

    async listOrders(): Promise<RemoteOrder[]> {
      throw new ConnectorError(
        `${spec.displayName} shops complete checkout on your own website, so there are no orders on Meta to import`,
        "VALIDATION",
      );
    },
  };
}
