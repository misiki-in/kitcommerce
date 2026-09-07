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
    let catalog = ctx.config.catalog_id || ctx.credentials.catalog_id;
    if (!catalog && path.includes("{container}")) {
      // Attempt auto-discovery if catalog_id was not explicitly configured
      try {
        const discovery = await discoverAllMetaResources(ctx);
        if (discovery.catalogId) {
          catalog = discovery.catalogId;
          ctx.config.catalog_id = String(catalog);
        }
      } catch {}
    }
    if (!catalog && path.includes("{container}")) {
      throw new ConnectorError(`missing ${spec.displayName} catalog_id`, "AUTHENTICATION");
    }

    const targetUrl = `${META_GRAPH}${path.replace("{container}", String(catalog || ""))}`;
    const res = await fetch(targetUrl, {
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
        let targetCatalogId = ctx.config.catalog_id || ctx.credentials.catalog_id;
        if (!targetCatalogId) {
          try {
            const discovery = await discoverAllMetaResources(ctx);
            if (discovery.catalogId) {
              targetCatalogId = discovery.catalogId;
              ctx.config.catalog_id = String(discovery.catalogId);
            }
          } catch {}
        }

        if (!targetCatalogId) {
          throw new ConnectorError("channel config is missing catalog_id", "VALIDATION");
        }

        const catData = await call(ctx, `/${targetCatalogId}?fields=id,name,vertical,product_count`);
        return {
          status: "HEALTHY",
          detail: catData?.name ? `Catalog: ${catData.name} (${catData.product_count ?? 0} products)` : undefined,
        };
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

    async deleteProduct(
      ctx: ConnectorContext,
      remoteId: string,
      options?: { skus?: string[]; product?: CanonicalProduct },
    ): Promise<boolean> {
      const skusToDelete = new Set<string>();
      if (remoteId) skusToDelete.add(String(remoteId).trim());
      if (options?.skus) {
        for (const s of options.skus) {
          if (s) skusToDelete.add(String(s).trim());
        }
      }
      if (options?.product?.variants) {
        for (const v of options.product.variants) {
          if (v.sku) skusToDelete.add(String(v.sku).trim());
        }
      }
      if (options?.product?.sku) {
        skusToDelete.add(String(options.product.sku).trim());
      }

      ctx.log(`[Meta Delete] Deleting product ${remoteId} (SKUs: ${Array.from(skusToDelete).join(", ")})`);

      let deleted = false;
      const errors: string[] = [];

      // 1. Try deleting via product_groups endpoint if remoteId is product group retailer_id
      try {
        const groupRes = await call(
          ctx,
          `/{container}/product_groups?retailer_id=${encodeURIComponent(remoteId)}`,
          { method: "DELETE" },
        );
        if (groupRes?.success !== false) {
          deleted = true;
          ctx.log(`[Meta Delete] Successfully deleted product group ${remoteId}`);
        }
      } catch (grpErr: any) {
        errors.push(`product_group: ${grpErr.message}`);
      }

      // 2. Delete individual variant items via items_batch
      const deleteRequests = Array.from(skusToDelete).map((sku) => ({
        method: "DELETE",
        data: { id: sku },
      }));

      if (deleteRequests.length > 0) {
        try {
          await itemsBatch(ctx, deleteRequests);
          deleted = true;
          ctx.log(`[Meta Delete] Successfully deleted items batch for SKUs: ${Array.from(skusToDelete).join(", ")}`);
        } catch (batchErr: any) {
          if (!deleted && !batchErr.message.toLowerCase().includes("not found")) {
            errors.push(`items_batch: ${batchErr.message}`);
          }
        }
      }

      // 3. Fallback: single item delete endpoint for each SKU
      if (!deleted) {
        for (const sku of skusToDelete) {
          try {
            const singleRes = await call(
              ctx,
              `/{container}/products?retailer_id=${encodeURIComponent(sku)}`,
              { method: "DELETE" },
            );
            if (singleRes?.success) deleted = true;
          } catch (singleErr: any) {}
        }
      }

      if (!deleted && errors.length > 0) {
        const fatalErrors = errors.filter(
          (e) => !e.toLowerCase().includes("does not exist") && !e.toLowerCase().includes("not found"),
        );
        if (fatalErrors.length > 0) {
          throw new ConnectorError(
            `${spec.displayName} delete failed: ${fatalErrors.join("; ")}`,
            "API_FAILURE",
          );
        }
      }

      return true;
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

    discover: discoverAllMetaResources,
  };
}

/**
 * Discovers Meta Catalogs, Businesses, and user details using the access token.
 */
export async function discoverAllMetaResources(ctx: ConnectorContext): Promise<{
  catalogId?: string;
  catalogName?: string;
  catalogs: Array<{ id: string; name: string; vertical?: string; product_count?: number }>;
  businesses: Array<{ id: string; name: string }>;
  errors: string[];
}> {
  const token = (ctx.credentials.access_token || "").trim();
  if (!token) {
    throw new ConnectorError("missing Meta access token for resource discovery", "AUTHENTICATION");
  }

  const errors: string[] = [];
  const catalogsMap = new Map<string, { id: string; name: string; vertical?: string; product_count?: number; business_id?: string; business_name?: string }>();
  const businessesMap = new Map<string, { id: string; name: string }>();

  const headers = { Authorization: `Bearer ${token}` };

  // Helper function for Graph API calls
  async function graphGet(endpoint: string): Promise<any> {
    const res = await fetch(`${META_GRAPH}${endpoint}`, { headers });
    if (!res.ok) {
      const text = await res.text();
      let msg = `${res.status} ${text.slice(0, 300)}`;
      try {
        const json = JSON.parse(text);
        if (json.error?.message) msg = json.error.message;
      } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  // 1. Fetch assigned product catalogs (/me/assigned_product_catalogs)
  try {
    const data = await graphGet("/me/assigned_product_catalogs?fields=id,name,vertical,product_count,business");
    if (Array.isArray(data?.data)) {
      for (const item of data.data) {
        if (item.id) {
          if (item.business?.id) {
            businessesMap.set(String(item.business.id), {
              id: String(item.business.id),
              name: item.business.name || `Business #${item.business.id}`,
            });
          }
          catalogsMap.set(String(item.id), {
            id: String(item.id),
            name: item.name || `Catalog #${item.id}`,
            vertical: item.vertical,
            product_count: item.product_count,
            business_id: item.business?.id ? String(item.business.id) : undefined,
            business_name: item.business?.name,
          });
        }
      }
    }
  } catch (err: any) {
    errors.push(`assigned_product_catalogs: ${err.message}`);
  }

  // 2. Fetch businesses (/me/businesses, /me/assigned_businesses, /me/client_businesses)
  const businessEndpoints = ["/me/businesses", "/me/assigned_businesses", "/me/client_businesses"];
  for (const ep of businessEndpoints) {
    try {
      const bizData = await graphGet(`${ep}?fields=id,name`);
      if (Array.isArray(bizData?.data)) {
        for (const b of bizData.data) {
          if (b.id && !businessesMap.has(String(b.id))) {
            businessesMap.set(String(b.id), { id: String(b.id), name: b.name || `Business #${b.id}` });
          }
        }
      }
    } catch (err: any) {
      errors.push(`${ep}: ${err.message}`);
    }
  }

  // Fetch catalogs for all discovered businesses
  for (const [bizId, b] of businessesMap.entries()) {
    // 2a. Owned catalogs
    try {
      const owned = await graphGet(`/${bizId}/owned_product_catalogs?fields=id,name,vertical,product_count,business`);
      if (Array.isArray(owned?.data)) {
        for (const item of owned.data) {
          if (item.id && !catalogsMap.has(String(item.id))) {
            catalogsMap.set(String(item.id), {
              id: String(item.id),
              name: item.name || `Catalog #${item.id}`,
              vertical: item.vertical,
              product_count: item.product_count,
              business_id: bizId,
              business_name: b.name,
            });
          }
        }
      }
    } catch (bErr: any) {
      errors.push(`business (${bizId}) owned_catalogs: ${bErr.message}`);
    }

    // 2b. Client catalogs
    try {
      const client = await graphGet(`/${bizId}/client_product_catalogs?fields=id,name,vertical,product_count,business`);
      if (Array.isArray(client?.data)) {
        for (const item of client.data) {
          if (item.id && !catalogsMap.has(String(item.id))) {
            catalogsMap.set(String(item.id), {
              id: String(item.id),
              name: item.name || `Catalog #${item.id}`,
              vertical: item.vertical,
              product_count: item.product_count,
              business_id: bizId,
              business_name: b.name,
            });
          }
        }
      }
    } catch {}
  }

  // 3. If a specific catalog_id is configured or entered, query it directly
  const explicitCatalogId = ctx.config?.catalog_id || ctx.credentials.catalog_id;
  if (explicitCatalogId && !catalogsMap.has(String(explicitCatalogId))) {
    try {
      const cat = await graphGet(`/${explicitCatalogId}?fields=id,name,vertical,product_count,business`);
      if (cat?.id) {
        if (cat.business?.id && !businessesMap.has(String(cat.business.id))) {
          businessesMap.set(String(cat.business.id), {
            id: String(cat.business.id),
            name: cat.business.name || `Business #${cat.business.id}`,
          });
        }
        catalogsMap.set(String(cat.id), {
          id: String(cat.id),
          name: cat.name || `Catalog #${cat.id}`,
          vertical: cat.vertical,
          product_count: cat.product_count,
          business_id: cat.business?.id ? String(cat.business.id) : undefined,
          business_name: cat.business?.name,
        });
      }
    } catch (err: any) {
      errors.push(`catalog (${explicitCatalogId}): ${err.message}`);
    }
  }

  const catalogs = Array.from(catalogsMap.values());
  const businessesList = Array.from(businessesMap.values());
  let targetCatalogId = explicitCatalogId ? String(explicitCatalogId) : catalogs[0]?.id;
  let targetCatalogName = catalogs.find((c) => c.id === targetCatalogId)?.name || catalogs[0]?.name;

  return {
    catalogId: targetCatalogId,
    catalogName: targetCatalogName,
    catalogs,
    businesses: businessesList,
    errors,
  };
}

/**
 * Exchanges authorization code for long-lived Meta access token and discovers catalogs.
 */
export async function exchangeMetaToken(input: {
  appId: string;
  appSecret?: string;
  code: string;
  redirectUri: string;
}): Promise<{
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  catalogId?: string;
  catalogName?: string;
  catalogs: Array<{ id: string; name: string; vertical?: string; product_count?: number }>;
  businesses: Array<{ id: string; name: string }>;
}> {
  const { appId, appSecret, code, redirectUri } = input;

  // Step 1: Exchange code for short-lived access token
  const tokenParams = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    code,
  });
  if (appSecret) tokenParams.set("client_secret", appSecret);

  const res = await fetch(`${META_GRAPH}/oauth/access_token?${tokenParams.toString()}`);
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(body.error?.message || `Meta OAuth token exchange failed (HTTP ${res.status}).`);
  }

  let finalToken = String(body.access_token);
  let expiresIn = Number(body.expires_in || 5184000);

  // Step 2: If appSecret is available, upgrade to a long-lived user access token (60 days)
  if (appSecret) {
    try {
      const longParams = new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: finalToken,
      });
      const longRes = await fetch(`${META_GRAPH}/oauth/access_token?${longParams.toString()}`);
      if (longRes.ok) {
        const longBody = await longRes.json();
        if (longBody.access_token) {
          finalToken = String(longBody.access_token);
          if (longBody.expires_in) expiresIn = Number(longBody.expires_in);
        }
      }
    } catch {}
  }

  // Step 3: Discover catalogs with this token
  let catalogs: any[] = [];
  let businesses: any[] = [];
  let catalogId: string | undefined;
  let catalogName: string | undefined;

  try {
    const discovery = await discoverAllMetaResources({
      credentials: { access_token: finalToken },
      config: {},
      seller: {} as any,
      log: () => {},
    });
    catalogs = discovery.catalogs;
    businesses = discovery.businesses;
    catalogId = discovery.catalogId;
    catalogName = discovery.catalogName;
  } catch {}

  return {
    accessToken: finalToken,
    tokenType: body.token_type || "bearer",
    expiresIn,
    catalogId,
    catalogName,
    catalogs,
    businesses,
  };
}

