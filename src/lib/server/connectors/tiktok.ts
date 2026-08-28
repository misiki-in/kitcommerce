/**
 * TikTok Shop connector (Open Platform API, version 202309).
 *
 * TikTok Shop is a full commerce platform with its own checkout and its own
 * orders — the one social channel here that sets orderImport: true and means
 * it. It is also the one channel a seller in India cannot use at all: TikTok
 * has been banned there since 2020, which is why IN is absent from `regions`
 * and why this connector is not counted among the India-first ones.
 *
 * The API has three properties that shape everything below:
 *
 * 1. EVERY call is signed. app_key, timestamp (unix seconds) and sign travel
 *    as query parameters; sign is a lowercase-hex HMAC-SHA256, keyed by the
 *    app secret, over app_secret + path + the sorted query pairs concatenated
 *    as key+value (sign and access_token excluded) + the JSON body for
 *    non-GET calls + app_secret again. The access token rides separately in
 *    the x-tts-access-token header. Multipart bodies are excluded from the
 *    signature — only the query is signed for uploads.
 *
 * 2. Errors hide inside HTTP 200. Every response is an envelope
 *    {code, message, request_id, data}; code 0 is the only success. Checking
 *    res.ok alone would treat most failures as successes, so the transport
 *    unwraps the envelope and classifies non-zero codes itself.
 *
 * 3. Shop-scoped endpoints (product, order) additionally require a
 *    shop_cipher query parameter, issued per authorized shop by
 *    GET /authorization/202309/shops. When the seller has not pasted one the
 *    connector discovers it once per process and caches it.
 *
 * Products carry TikTok-issued identifiers the canonical model never sees:
 * create returns data.product_id (our remoteId) and per-variant sku ids that
 * differ from seller_sku. Inventory and price updates are keyed by those sku
 * ids, so both resolve them by fetching the product and matching seller_sku.
 *
 * Brand is deliberately not sent. The 202309 create schema takes brand_id —
 * an identifier resolved through the separate Brands API — and has no
 * free-text brand_name; sending the canonical brand string would be rejected.
 * Listings publish without brand attribution until Brands API support exists.
 *
 * Verification status: the signing scheme, envelope, token endpoints, product
 * create/edit/inventory/price paths and the order search contract are
 * confirmed against a fetched working example and two maintained open-source
 * clients (last checked 2026-08-27). The official Partner Center pages are
 * JS-rendered and could not be fetched, so a few edges follow the community
 * clients rather than first-party text: the multipart field name ("data") of
 * the image upload, the product-detail GET used for sku-id resolution, the
 * GRAM weight unit, and the numeric error-code tables (we classify envelope
 * failures by message text instead).
 */
import {
  ConnectorError,
  classifyStatus,
  money,
  type CanonicalImage,
  type CanonicalProduct,
  type CanonicalVariant,
  type ConnectorContext,
  type InventoryUpdate,
  type Manifest,
  type MarketplaceConnector,
  type PriceUpdate,
  type RemoteOrder,
  type RemoteProduct,
} from "../connector";
import { createHash, createHmac } from "node:crypto";
import { mockLatency, mockMaybeFail, mockRemoteId } from "./mock";

const OPEN_API = "https://open-api.tiktokglobalshop.com";
const AUTH_API = "https://auth.tiktok-shops.com";

const manifest: Manifest = {
  name: "tiktok",
  displayName: "TikTok Shop",
  version: "0.1.0",
  platformType: "social",
  group: "Social",
  status: "ready",
  idPrefix: "TTS",
  authentication: {
    type: "oauth2_authorization_code",
    fields: [
      { key: "app_key", label: "App Key", secret: false },
      { key: "app_secret", label: "App Secret", secret: true },
      {
        key: "access_token",
        label: "Access Token",
        secret: true,
        help: "From the one-time token exchange after the seller authorizes the app",
      },
      {
        key: "refresh_token",
        label: "Refresh Token",
        secret: true,
        optional: true,
        help: "Strongly recommended: lets the connector renew the access token before it expires",
      },
      {
        key: "shop_cipher",
        label: "Shop Cipher",
        secret: false,
        optional: true,
        help: "Discovered automatically when left blank",
      },
      {
        key: "shop_id",
        label: "Shop ID",
        secret: false,
        optional: true,
        help: "Only needed when the app is authorized for more than one shop",
      },
    ],
  },
  credentialsNote:
    "App Key and App Secret come from your app in TikTok Shop Partner Center. The tokens are not shown in any portal — they come from a one-time shop-authorization exchange described in the setup guide. Leave Shop Cipher and Shop ID blank; the connector discovers them.",
  // TikTok Shop's live markets as of mid-2026. India stays absent — see the
  // file header. The next EU wave (NL, BE, PL) was announced for H2 2026 and
  // joins here once those markets actually open.
  regions: [
    "US",
    "GB",
    "IE",
    "ES",
    "FR",
    "DE",
    "IT",
    "MX",
    "BR",
    "JP",
    "ID",
    "MY",
    "TH",
    "VN",
    "PH",
    "SG",
  ],
  capabilities: {
    createProduct: true,
    updateProduct: true,
    deleteProduct: true,
    inventorySync: true,
    priceSync: true,
    orderImport: true,
    orderUpdate: false,
    webhooks: false,
    bulkOperations: true,
    variants: true,
  },
  /**
   * Deliberately shorter than the shared social list this connector once used.
   * TikTok's 202309 create schema has no condition field and no landing URL —
   * native checkout exists in every market it operates — and brand cannot be
   * sent without the Brands API (see the file header), so none of those three
   * may gate publishing here.
   */
  requiredFields: [
    { path: "title", label: "Product name", required: true },
    { path: "description", label: "Description", required: true },
    {
      path: "images",
      label: "At least one image",
      required: true,
      help: "Re-hosted on TikTok at publish time; the source URL must be publicly fetchable",
    },
    {
      path: "attributes.tiktok_category_id",
      label: "TikTok category ID",
      required: true,
      help: "TikTok's own taxonomy leaf; product creation rejects a free-text category",
    },
    {
      path: "attributes.package_weight_g",
      label: "Package weight (g)",
      required: true,
      help: "Required to quote shipping at checkout",
    },
  ],
  rateLimits: { requestsPerSecond: 10, burst: 20 },
  docsUrl: "https://partner.tiktokshop.com/docv2",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/tiktok.md",
  sellerPortalUrl: "https://seller.tiktokglobalshop.com",
};

// ------------------------------------------------------------------ signing

const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");

/**
 * The documented signature: HMAC-SHA256 keyed by the app secret, over the
 * secret + path + query pairs (sorted by key, concatenated as key+value,
 * excluding sign and access_token) + the request body + the secret again,
 * rendered as lowercase hex. The signature covers the RAW values; URL
 * encoding happens afterwards, when the query string is serialised.
 */
function signedUrl(
  appSecret: string,
  path: string,
  query: Record<string, string>,
  body?: string,
): string {
  const sortedPairs = Object.keys(query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join("");
  const sign = createHmac("sha256", appSecret)
    .update(appSecret + path + sortedPairs + (body ?? "") + appSecret)
    .digest("hex");
  return `${OPEN_API}${path}?${new URLSearchParams({ ...query, sign }).toString()}`;
}

// ------------------------------------------------------------------- tokens

/**
 * Access tokens, cached for their stated lifetime.
 *
 * TikTok access tokens live for days, not hours, but every sync call needs
 * one and the refresh endpoint has its own, much tighter limit — so refresh
 * results are cached process-wide, keyed by a hash of the refresh token
 * rather than the token itself: a credential should not sit in a map key
 * that any future debug dump would print.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Renew a minute early, so a token cannot expire mid-flight on a slow call. */
const TOKEN_MARGIN_MS = 60_000;

/**
 * TikTok's `access_token_expire_in` is an absolute unix timestamp in some
 * responses while the name reads like a duration, and community clients
 * disagree with each other. Treat anything that looks like an epoch as
 * absolute and anything small as seconds-to-live; when the field is missing
 * entirely, assume a conservative hour rather than caching forever.
 */
function tokenExpiryMs(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Date.now() + 3_600_000 - TOKEN_MARGIN_MS;
  const absoluteMs = n > 1_000_000_000 ? n * 1000 : Date.now() + n * 1000;
  return absoluteMs - TOKEN_MARGIN_MS;
}

async function accessToken(ctx: ConnectorContext): Promise<string> {
  const { app_key, app_secret, access_token, refresh_token } = ctx.credentials;
  if (!app_key || !app_secret) {
    throw new ConnectorError("missing TikTok app_key/app_secret", "AUTHENTICATION");
  }

  // Without a refresh token the pasted access token is all there is. It will
  // expire in days; the manifest marks refresh_token optional but recommended.
  if (!refresh_token) {
    if (!access_token) throw new ConnectorError("missing TikTok access_token", "AUTHENTICATION");
    return access_token;
  }

  const cacheKey = sha256(`${app_key}|${refresh_token}`);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  // The auth host takes plain query parameters — the HMAC scheme applies only
  // to the open-api host. The response reuses the {code, message, data}
  // envelope. TikTok also returns a refresh_token in this response; the
  // connector has no way to persist a rotated one, so if TikTok ever starts
  // rotating refresh tokens the seller re-pastes. Today they are long-lived.
  const qs = new URLSearchParams({
    app_key,
    app_secret,
    refresh_token,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${AUTH_API}/api/v2/token/refresh?${qs.toString()}`);
  if (!res.ok) throw classifyStatus(res.status, await res.text());
  const body = (await res.json()) as {
    code?: number;
    message?: string;
    request_id?: string;
    data?: { access_token?: string; access_token_expire_in?: number };
  };
  if (body?.code !== 0 || !body?.data?.access_token) {
    const err = classifyEnvelope({
      code: body?.code ?? -1,
      message: body?.message ?? "token refresh returned no access_token",
      request_id: body?.request_id,
    });
    // A rejected refresh nearly always means the grant is dead; anything the
    // message did not identify is treated as auth so the channel surfaces
    // AUTH_FAILURE instead of retrying a permanently broken credential.
    throw err.class === "UNKNOWN" ? new ConnectorError(err.message, "AUTHENTICATION") : err;
  }

  tokenCache.set(cacheKey, {
    token: body.data.access_token,
    expiresAt: tokenExpiryMs(body.data.access_token_expire_in),
  });
  return body.data.access_token;
}

// ---------------------------------------------------------------- transport

/**
 * The official numeric error-code tables sit behind JS-rendered Partner
 * Center pages, so classification keys on the message text: token, signature
 * and permission failures are permanent auth problems, throttling messages
 * are retryable with a pause, and anything naming the payload is validation.
 * What cannot be identified stays UNKNOWN, which the job runner does not
 * retry — safer than guessing retryable and hammering a rejecting API.
 */
function classifyEnvelope(env: {
  code: number;
  message?: string;
  request_id?: string;
}): ConnectorError {
  const msg = `TikTok error ${env.code}: ${env.message ?? ""} (request ${env.request_id ?? "?"})`;
  const text = (env.message ?? "").toLowerCase();
  if (/token|sign|auth|permission|unauthori|forbidden|access denied/.test(text)) {
    return new ConnectorError(msg, "AUTHENTICATION");
  }
  if (/rate|throttl|frequency|too many|quota/.test(text)) {
    return new ConnectorError(msg, "RATE_LIMITED", { retryAfterMs: 60_000 });
  }
  if (/invalid|param|required|missing|illegal|exceed|not exist|duplicate/.test(text)) {
    return new ConnectorError(msg, "VALIDATION");
  }
  return new ConnectorError(msg, "UNKNOWN");
}

/** Shop ciphers never change for a given authorization, so cache per token. */
const cipherCache = new Map<string, string>();

interface TikTokRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string>;
  /** JSON body; serialised once so the signed string and the sent bytes match. */
  body?: unknown;
  /** Multipart alternative to `body`; excluded from the signature. */
  form?: FormData;
  /** Product and order endpoints need the shop_cipher query parameter. */
  shopScoped?: boolean;
}

async function request(ctx: ConnectorContext, req: TikTokRequest): Promise<any> {
  const token = await accessToken(ctx);
  const { app_key, app_secret } = ctx.credentials;

  const query: Record<string, string> = {
    ...(req.query ?? {}),
    app_key,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (req.shopScoped) query.shop_cipher = await shopCipher(ctx, token);

  const json = req.body !== undefined ? JSON.stringify(req.body) : undefined;
  const url = signedUrl(app_secret, req.path, query, req.form ? undefined : json);

  const headers: Record<string, string> = { "x-tts-access-token": token };
  // fetch supplies the multipart boundary itself; setting Content-Type by
  // hand for FormData would corrupt the request.
  if (json !== undefined && !req.form) headers["Content-Type"] = "application/json";

  const res = await fetch(url, { method: req.method, headers, body: req.form ?? json });
  if (res.status === 429) {
    const ra = Number(res.headers.get("retry-after") ?? 60);
    throw new ConnectorError("TikTok Shop rate limit", "RATE_LIMITED", {
      retryAfterMs: (ra > 0 ? ra : 60) * 1000,
    });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const text = await res.text();
  const envelope = text ? JSON.parse(text) : null;
  // Success is code 0 inside HTTP 200; anything else is a failure dressed as
  // one. See the file header.
  if (envelope && envelope.code !== 0) throw classifyEnvelope(envelope);
  return envelope?.data ?? null;
}

async function shopCipher(ctx: ConnectorContext, token: string): Promise<string> {
  const supplied = ctx.credentials.shop_cipher;
  if (supplied) return supplied;

  const cacheKey = sha256(token);
  const cached = cipherCache.get(cacheKey);
  if (cached) return cached;

  const data = await request(ctx, { method: "GET", path: "/authorization/202309/shops" });
  const shops: Array<{ id?: unknown; cipher?: unknown }> = data?.shops ?? [];
  if (shops.length === 0) {
    throw new ConnectorError(
      "TikTok returned no authorized shops for this app — complete the shop authorization flow first",
      "AUTHENTICATION",
    );
  }
  // Most apps are authorized for exactly one shop. shop_id exists in the
  // manifest purely to disambiguate the multi-shop case.
  const wanted = ctx.credentials.shop_id;
  const shop = wanted ? shops.find((s) => String(s.id) === wanted) : shops[0];
  if (!shop?.cipher) {
    throw new ConnectorError(
      wanted
        ? `TikTok shop ${wanted} is not among this app's authorized shops`
        : "TikTok authorized shop carries no cipher",
      "AUTHENTICATION",
    );
  }
  const cipher = String(shop.cipher);
  cipherCache.set(cacheKey, cipher);
  return cipher;
}

// ----------------------------------------------------------------- payloads

const currencyFor = (ctx: ConnectorContext, v: CanonicalVariant): string =>
  String(ctx.config.currency ?? v.currency);

/**
 * TikTok only accepts images it hosts itself: create/edit take uri values
 * returned by the upload endpoint, and external URLs are rejected. So every
 * publish re-hosts the canonical images first. One broken image should not
 * sink a listing — genuine per-image failures are logged and skipped — but
 * any class that dooms every remaining upload equally (auth, throttling, a
 * TikTok outage) propagates with its real class instead of being laundered
 * into "no images": a swallowed 5xx would dead-letter as VALIDATION a job
 * that a retry would have completed.
 */
async function uploadImages(ctx: ConnectorContext, images: CanonicalImage[]): Promise<string[]> {
  const uris: string[] = [];
  for (const im of images.slice(0, 9)) {
    try {
      const res = await fetch(im.url);
      if (!res.ok) throw new Error(`image fetch failed (${res.status})`);
      const bytes = await res.arrayBuffer();
      const type = res.headers.get("content-type") ?? "image/jpeg";
      const name = im.url.split("/").pop()?.split("?")[0] || "image";
      const form = new FormData();
      form.append("data", new Blob([bytes], { type }), name);
      const data = await request(ctx, {
        method: "POST",
        path: "/product/202309/images/upload",
        form,
        shopScoped: true,
      });
      if (data?.uri) {
        uris.push(String(data.uri));
      } else {
        ctx.log(`tiktok image upload returned no uri`, { position: im.position });
      }
    } catch (e) {
      if (
        e instanceof ConnectorError &&
        (e.class === "AUTHENTICATION" || e.class === "RATE_LIMITED" || e.class === "RETRYABLE")
      ) {
        throw e;
      }
      ctx.log(`tiktok image upload skipped: ${(e as Error).message}`, { position: im.position });
    }
  }
  return uris;
}

/**
 * One create body per product, ALL variants inside skus[]. TikTok models a
 * variant as a row of one product distinguished by sales_attributes — there
 * is no item-group concept, and creating one product per variant would
 * scatter a 3-size listing across 3 unrelated pages with no variant picker.
 */
function productBody(ctx: ConnectorContext, p: CanonicalProduct, imageUris: string[]) {
  const a = p.attributes as any;
  const warehouse = String(a.tiktok_warehouse_id ?? ctx.config.tiktok_warehouse_id ?? "");
  return {
    title: p.title,
    description: p.description,
    category_id: String(a.tiktok_category_id ?? ""),
    main_images: imageUris.map((uri) => ({ uri })),
    package_weight: { value: String(a.package_weight_g ?? p.weightG ?? 0), unit: "GRAM" },
    skus: p.variants.map((v) => ({
      seller_sku: v.sku,
      sales_attributes: Object.entries(v.options ?? {}).map(([name, value]) => ({
        name,
        value_name: value,
      })),
      price: { amount: money(v.priceCents), currency: currencyFor(ctx, v) },
      // A shop without a configured warehouse still publishes: warehouse_id
      // is omitted and TikTok books the stock against the default warehouse.
      inventory: [
        warehouse
          ? { warehouse_id: warehouse, quantity: v.available }
          : { quantity: v.available },
      ],
    })),
  };
}

/**
 * Inventory and price updates are keyed by TikTok's own sku id, which differs
 * from seller_sku and is not stored anywhere on our side — so resolve it by
 * reading the product back and matching seller_sku. The detail GET follows
 * the community clients (the official page is JS-gated); it is the same
 * envelope and signing as everything else.
 *
 * The same detail response says where the sku's stock is currently booked, so
 * the matched sku's warehouse_id (first inventory row) rides along: a product
 * may have published to a per-product `tiktok_warehouse_id` attribute
 * override, and an inventory update addressed by channel config alone would
 * land in a different warehouse than the one holding the stock.
 */
async function tiktokSkuId(
  ctx: ConnectorContext,
  productId: string,
  sellerSku: string,
): Promise<{ id: string; warehouseId?: string }> {
  const data = await request(ctx, {
    method: "GET",
    path: `/product/202309/products/${encodeURIComponent(productId)}`,
    shopScoped: true,
  });
  const match = (data?.skus ?? []).find(
    (s: any) => String(s.seller_sku ?? "") === sellerSku,
  );
  if (!match?.id) {
    throw new ConnectorError(
      `SKU ${sellerSku} is not on TikTok product ${productId} — republish the product before syncing it`,
      "VALIDATION",
    );
  }
  const warehouseId = match.inventory?.[0]?.warehouse_id;
  return {
    id: String(match.id),
    warehouseId: warehouseId ? String(warehouseId) : undefined,
  };
}

// ---------------------------------------------------------------- connector

export const tiktok: MarketplaceConnector = {
  manifest: () => manifest,

  async health(ctx) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      return { status: "HEALTHY", detail: "mock mode" };
    }
    try {
      // Get Authorized Shops exercises signing, the token and the grant in
      // one call, and is the same endpoint the cipher discovery uses.
      await request(ctx, { method: "GET", path: "/authorization/202309/shops" });
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
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "createProduct");
      const remoteId = mockRemoteId("TTS", p.sku);
      ctx.log(
        `mock: published TikTok Shop catalogue item ${remoteId} for ${p.sku}` +
          (p.variants.length > 1 ? ` (${p.variants.length} variants)` : ""),
      );
      return { remoteId };
    }

    const uris = await uploadImages(ctx, p.images);
    if (uris.length === 0) {
      throw new ConnectorError(
        "TikTok requires images hosted on TikTok and none of the product's images could be uploaded",
        "VALIDATION",
      );
    }

    const data = await request(ctx, {
      method: "POST",
      path: "/product/202309/products",
      body: productBody(ctx, p, uris),
      shopScoped: true,
    });
    if (!data?.product_id) {
      throw new ConnectorError(
        "TikTok create returned no product_id — the listing state is unknown",
        "UNKNOWN",
      );
    }
    // product_id is what every later call is addressed by; the raw data also
    // carries the TikTok sku ids for whoever wants to inspect them.
    return { remoteId: String(data.product_id), raw: data };
  },

  async updateProduct(ctx, p, remoteId) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateProduct");
      ctx.log(`mock: updated TikTok Shop catalogue item ${remoteId}`);
      return;
    }
    const uris = await uploadImages(ctx, p.images);
    if (uris.length === 0) {
      throw new ConnectorError(
        "TikTok requires images hosted on TikTok and none of the product's images could be uploaded",
        "VALIDATION",
      );
    }
    // Edit is a full-body PUT addressed by product_id, not a partial patch.
    await request(ctx, {
      method: "PUT",
      path: `/product/202309/products/${encodeURIComponent(remoteId)}`,
      body: productBody(ctx, p, uris),
      shopScoped: true,
    });
  },

  async updateInventory(ctx, u: InventoryUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updateInventory");
      ctx.log(`mock: TikTok Shop availability ${u.sku} -> ${u.available}`);
      return;
    }
    const { id: skuId, warehouseId } = await tiktokSkuId(ctx, u.remoteId, u.sku);
    // Address the warehouse the sku's stock actually lives in — publish may
    // have honoured a per-product attribute override, so channel config is
    // only the fallback when the detail reports no warehouse; with neither,
    // omit and let TikTok book against the default warehouse.
    const warehouse = warehouseId ?? String(ctx.config.tiktok_warehouse_id ?? "");
    await request(ctx, {
      method: "POST",
      path: `/product/202309/products/${encodeURIComponent(u.remoteId)}/inventory/update`,
      body: {
        skus: [
          {
            id: skuId,
            inventory: [
              warehouse
                ? { warehouse_id: warehouse, quantity: u.available }
                : { quantity: u.available },
            ],
          },
        ],
      },
      shopScoped: true,
    });
  },

  async updatePrice(ctx, u: PriceUpdate) {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      mockMaybeFail(ctx, "updatePrice");
      ctx.log(`mock: TikTok Shop price ${u.sku} -> ${money(u.priceCents)}`);
      return;
    }
    const { id: skuId } = await tiktokSkuId(ctx, u.remoteId, u.sku);
    await request(ctx, {
      method: "POST",
      path: `/product/202309/products/${encodeURIComponent(u.remoteId)}/prices/update`,
      body: {
        skus: [
          {
            id: skuId,
            price: {
              amount: money(u.priceCents),
              currency: String(ctx.config.currency ?? u.currency),
            },
          },
        ],
      },
      shopScoped: true,
    });
  },

  async listOrders(ctx, since): Promise<RemoteOrder[]> {
    if (ctx.mode === "mock") {
      await mockLatency(ctx);
      const skus: string[] = ctx.config.mockOrderSkus ?? [];
      return skus.slice(0, 1).map((sku, i) => ({
        externalId: `TTS-ORD-${mockRemoteId("", sku)}-${i}`,
        status: "NEW",
        currency: "GBP",
        totalCents: 3499,
        placedAt: new Date().toISOString(),
        customer: { name: "Jordan Ellis", email: "", phone: "" },
        shippingAddress: {
          line1: "48 Commercial Street",
          city: "Manchester",
          state: "",
          postalCode: "M1 2AB",
          country: "GB",
        },
        items: [
          {
            sku,
            title: "Mock TikTok Shop item",
            quantity: 1,
            priceCents: 3499,
            remoteItemId: `TTSI-${i}`,
          },
        ],
      }));
    }

    // Search splits its parameters: page_size and page_token are QUERY
    // parameters (and therefore signed), while the time filter goes in the
    // body in unix SECONDS. The page cap keeps a bad next_page_token from
    // spinning forever; 10 pages of 50 comfortably covers a sync window.
    const createTimeGe = Math.floor(since.getTime() / 1000);
    const raw: any[] = [];
    let pageToken = "";
    for (let page = 0; page < 10; page++) {
      const query: Record<string, string> = { page_size: "50" };
      if (pageToken) query.page_token = pageToken;
      const data = await request(ctx, {
        method: "POST",
        path: "/order/202309/orders/search",
        query,
        body: { create_time_ge: createTimeGe },
        shopScoped: true,
      });
      raw.push(...(data?.orders ?? []));
      pageToken = String(data?.next_page_token ?? "");
      if (!pageToken) break;
    }

    return raw.map((o: any): RemoteOrder => {
      const addr = o.recipient_address ?? {};
      const placed = Number(o.create_time);
      return {
        externalId: String(o.id ?? ""),
        status: String(o.status ?? o.order_status ?? "NEW"),
        currency: String(o.payment?.currency ?? "USD"),
        // total_amount is a decimal string of currency units.
        totalCents: Math.round(Number(o.payment?.total_amount ?? 0) * 100),
        placedAt:
          Number.isFinite(placed) && placed > 0
            ? new Date(placed * 1000).toISOString()
            : new Date().toISOString(),
        customer: {
          name: String(addr.name ?? ""),
          email: String(o.buyer_email ?? ""),
          phone: String(addr.phone_number ?? ""),
        },
        // line1, postal code and country code are documented; city and state
        // are read defensively because TikTok's district fields vary by
        // market, and an empty string beats a wrong guess.
        shippingAddress: {
          line1: String(addr.address_line1 ?? ""),
          line2: String(addr.address_line2 ?? ""),
          city: String(addr.city ?? ""),
          state: String(addr.state ?? ""),
          postalCode: String(addr.postal_code ?? ""),
          country: String(addr.region_code ?? ""),
        },
        // TikTok emits one line-item row per unit, so a missing quantity
        // defaulting to 1 is exact, not approximate.
        items: (o.line_items ?? []).map((it: any) => ({
          sku: String(it.seller_sku ?? ""),
          title: String(it.product_name ?? ""),
          quantity: Number(it.quantity ?? 1),
          priceCents: Math.round(Number(it.sale_price ?? 0) * 100),
          remoteItemId: String(it.id ?? ""),
        })),
      };
    });
  },
};
