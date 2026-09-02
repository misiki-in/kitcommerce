/**
 * Quick-commerce HTTP transport and connector factory.
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
import { allocateStock, locationsOf } from "./allocation";
import { SHARED_CAPABILITIES, SHARED_REQUIRED, type QuickCommerceSpec } from "./manifest";

export function makeConnector(spec: QuickCommerceSpec): MarketplaceConnector {
  const manifest: Manifest = {
    name: spec.name,
    displayName: spec.displayName,
    version: "0.1.0",
    platformType: "marketplace",
    group: spec.group ?? "India — quick commerce",
    status: spec.status ?? "development",
    idPrefix: spec.idPrefix,
    authentication: spec.authFields,
    regions: ["IN"],
    capabilities: SHARED_CAPABILITIES,
    requiredFields: [...SHARED_REQUIRED, ...(spec.extraRequired ?? [])],
    rateLimits: spec.rateLimits,
    docsUrl: spec.docsUrl,
    setupGuide: spec.setupGuide,
    sellerPortalUrl: spec.sellerPortalUrl ?? spec.docsUrl,
    credentialsNote: spec.credentialsNote,
  };

  async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
    for (const field of manifest.authentication.fields) {
      if (!field.optional && !ctx.credentials[field.key]) {
        throw new ConnectorError(
          `missing ${spec.displayName} credential: ${field.label}`,
          "AUTHENTICATION",
        );
      }
    }
    const headers = Object.fromEntries(
      Object.entries(spec.authHeaders(ctx.credentials)).filter(([, v]) => v),
    );
    const res = await fetch(`${spec.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? 60);
      throw new ConnectorError(`${spec.displayName} rate limit`, "RATE_LIMITED", {
        retryAfterMs: ra * 1000,
      });
    }
    if (!res.ok) throw classifyStatus(res.status, await res.text());
    const text = await res.text();
    if (!text) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) {
      throw new ConnectorError(
        `${spec.displayName} returned ${contentType || "an untyped body"} instead of JSON — this endpoint is not a live API`,
        "UNKNOWN",
      );
    }
    return JSON.parse(text);
  }

  function toListing(ctx: ConnectorContext, p: CanonicalProduct) {
    const a = p.attributes as any;
    const v = p.variants[0];
    return {
      seller_sku: p.sku,
      name: p.title,
      description: p.description,
      brand: p.brand,
      category: p.category,
      hsn_code: p.hsnCode,
      gst_percentage: Number(a.gst_percentage ?? p.taxRateBp / 100),
      shelf_life_days: Number(a.shelf_life_days ?? 0),
      net_weight_g: p.weightG,
      images: p.images.map((i) => i.url),
      mrp: money(v?.mrpCents ?? 0),
      selling_price: money(v?.priceCents ?? 0),
      attributes: p.attributes,
      inventory: allocateStock(
        v?.available ?? 0,
        locationsOf(ctx),
        String(ctx.config.allocation ?? "mirror"),
      ).map((s) => ({ store_code: s.location, quantity: s.quantity })),
    };
  }

  return {
    manifest: () => manifest,

    async health(ctx) {
      try {
        await call(ctx, "/v1/seller/profile");
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
      const body = await call(ctx, "/v1/catalog/products", {
        method: "POST",
        body: JSON.stringify(toListing(ctx, p)),
      });
      return { remoteId: String(body?.product_id ?? body?.id ?? p.sku), raw: body };
    },

    async updateProduct(ctx, p, remoteId) {
      await call(ctx, `/v1/catalog/products/${encodeURIComponent(remoteId)}`, {
        method: "PUT",
        body: JSON.stringify(toListing(ctx, p)),
      });
    },

    async updateInventory(ctx, u: InventoryUpdate) {
      const allocation = allocateStock(
        u.available,
        locationsOf(ctx),
        String(ctx.config.allocation ?? "mirror"),
      );
      await call(ctx, "/v1/inventory", {
        method: "POST",
        body: JSON.stringify({
          updates: allocation.map((s) => ({
            seller_sku: u.sku,
            store_code: s.location,
            quantity: s.quantity,
          })),
        }),
      });
    },

    async updatePrice(ctx, u: PriceUpdate) {
      const locations = locationsOf(ctx);
      await call(ctx, "/v1/prices", {
        method: "POST",
        body: JSON.stringify({
          updates: (locations.length ? locations : [""]).map((store_code) => ({
            seller_sku: u.sku,
            store_code,
            mrp: money(u.mrpCents),
            selling_price: money(u.priceCents),
          })),
        }),
      });
    },

    async listOrders(ctx, since): Promise<RemoteOrder[]> {
      const body = await call(
        ctx,
        `/v1/orders?from=${encodeURIComponent(since.toISOString())}&limit=50`,
      );
      return (body?.orders ?? []).map((o: any) => ({
        externalId: String(o.order_id ?? o.id),
        status: String(o.status ?? "NEW"),
        currency: "INR",
        totalCents: Math.round(Number(o.total_amount ?? 0) * 100),
        placedAt: o.created_at ?? new Date().toISOString(),
        customer: { name: o.customer_name ?? "", email: "", phone: o.customer_phone ?? "" },
        shippingAddress: { store_code: o.store_code ?? "", country: "IN" },
        items: (o.items ?? []).map((it: any) => ({
          sku: it.seller_sku ?? it.sku ?? "",
          title: it.name ?? "",
          quantity: Number(it.quantity ?? 1),
          priceCents: Math.round(Number(it.price ?? 0) * 100),
          remoteItemId: String(it.item_id ?? ""),
        })),
      }));
    },
  };
}
