/**
 * Indian portal connector HTTP transport and builder.
 */
import {
  ConnectorError,
  classifyStatus,
  money,
  type CanonicalProduct,
  type ConnectorContext,
  type InventoryUpdate,
  type Manifest,
  type MarketplaceConnector,
  type PriceUpdate,
  type RemoteOrder,
  type RemoteProduct,
} from "../../connector";
import { BASE_CAPABILITIES, COMMON_REQUIRED, type PortalSpec } from "./manifest";

export function makeConnector(spec: PortalSpec): MarketplaceConnector {
  const paths = {
    profile: "/v1/seller/profile",
    create: "/v1/catalog/products",
    update: "/v1/catalog/products",
    inventory: "/v1/inventory",
    price: "/v1/prices",
    orders: "/v1/orders",
    ...(spec.paths ?? {}),
  };

  const manifest: Manifest = {
    name: spec.name,
    displayName: spec.displayName,
    version: "0.1.0",
    platformType: "marketplace",
    group: spec.group,
    status: spec.status ?? "development",
    idPrefix: spec.idPrefix,
    authentication: spec.authFields,
    regions: ["IN"],
    capabilities: { ...BASE_CAPABILITIES, ...(spec.capabilities ?? {}) },
    requiredFields: [...COMMON_REQUIRED, ...spec.required],
    rateLimits: spec.rateLimits,
    docsUrl: spec.docsUrl,
    setupGuide: `https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/${spec.name}.md`,
    credentialsNote: spec.credentialsNote,
    sellerPortalUrl: spec.sellerPortalUrl ?? spec.docsUrl,
  };

  async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
    for (const f of manifest.authentication.fields) {
      if (!f.optional && !ctx.credentials[f.key]) {
        throw new ConnectorError(
          `missing ${spec.displayName} credential: ${f.key}`,
          "AUTHENTICATION",
        );
      }
    }
    const base =
      typeof ctx.config.baseUrl === "string" && ctx.config.baseUrl
        ? ctx.config.baseUrl
        : spec.baseUrl;
    const headers: Record<string, string> = {};
    const merged = { ...spec.authHeaders(ctx.credentials), ...(ctx.config.extraHeaders ?? {}) };
    for (const [k, v] of Object.entries(merged)) {
      if (v) headers[k] = String(v);
    }
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...headers, ...(init.headers ?? {}) },
    });
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? 60);
      throw new ConnectorError(`${spec.displayName} rate limit`, "RATE_LIMITED", {
        retryAfterMs: ra * 1000,
      });
    }
    if (!res.ok) throw classifyStatus(res.status, await res.text());
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function toCatalog(ctx: ConnectorContext, p: CanonicalProduct) {
    const a = p.attributes as any;
    return {
      seller_sku: p.sku,
      name: p.title,
      description: p.description,
      brand: p.brand,
      category: p.category,
      hsn_code: p.hsnCode,
      gst_percentage: Number(a.gst_percentage ?? p.taxRateBp / 100),
      country_of_origin: a.country_of_origin ?? "IN",
      images: p.images.map((i) => i.url),
      dimensions_mm: { length: p.lengthMm, width: p.widthMm, height: p.heightMm },
      weight_g: p.weightG,
      attributes: p.attributes,
      variants: p.variants.map((v) => ({
        seller_sku: v.sku,
        options: v.options,
        barcode: v.barcode,
        mrp: money(v.mrpCents),
        selling_price: money(v.priceCents),
        stock: v.available,
      })),
      ...(spec.extend?.(p, ctx) ?? {}),
    };
  }

  return {
    manifest: () => manifest,

    async health(ctx) {
      try {
        await call(ctx, paths.profile);
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
      const body = await call(ctx, paths.create, {
        method: "POST",
        body: JSON.stringify(toCatalog(ctx, p)),
      });
      return {
        remoteId: String(body?.style_id ?? body?.product_id ?? body?.id ?? p.sku),
        raw: body,
      };
    },

    async updateProduct(ctx, p, remoteId) {
      await call(ctx, `${paths.update}/${encodeURIComponent(remoteId)}`, {
        method: "PUT",
        body: JSON.stringify(toCatalog(ctx, p)),
      });
    },

    async updateInventory(ctx, u: InventoryUpdate) {
      await call(ctx, paths.inventory, {
        method: "POST",
        body: JSON.stringify({ updates: [{ seller_sku: u.sku, stock: u.available }] }),
      });
    },

    async updatePrice(ctx, u: PriceUpdate) {
      await call(ctx, paths.price, {
        method: "POST",
        body: JSON.stringify({
          updates: [
            { seller_sku: u.sku, mrp: money(u.mrpCents), selling_price: money(u.priceCents) },
          ],
        }),
      });
    },

    async listOrders(ctx, since): Promise<RemoteOrder[]> {
      const body = await call(
        ctx,
        `${paths.orders}?from=${encodeURIComponent(since.toISOString())}&limit=50`,
      );
      return (body?.orders ?? body?.data ?? []).map((o: any) => ({
        externalId: String(o.order_id ?? o.id),
        status: String(o.status ?? "NEW"),
        currency: "INR",
        totalCents: Math.round(Number(o.total_amount ?? o.total ?? 0) * 100),
        placedAt: o.created_at ?? o.order_date ?? new Date().toISOString(),
        customer: {
          name: o.customer_name ?? o.buyer_name ?? "",
          email: o.customer_email ?? "",
          phone: o.customer_phone ?? "",
        },
        shippingAddress: o.shipping_address ?? o.delivery_address ?? {},
        items: (o.items ?? o.line_items ?? []).map((it: any) => ({
          sku: it.seller_sku ?? it.sku ?? "",
          title: it.name ?? it.product_name ?? "",
          quantity: Number(it.quantity ?? 1),
          priceCents: Math.round(Number(it.price ?? 0) * 100),
          remoteItemId: String(it.item_id ?? it.line_id ?? ""),
        })),
      }));
    },
  };
}
