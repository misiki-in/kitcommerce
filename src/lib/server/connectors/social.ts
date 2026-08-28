/**
 * Meta social commerce connectors: Instagram and Facebook.
 *
 * These are not marketplaces and the code should not pretend they are. Two
 * facts drive everything in this file:
 *
 * 1. Instagram and Facebook are two SURFACES OVER ONE CATALOGUE. Both read from
 *    the same Meta Product Catalog via the Graph API, so publishing to both is
 *    two channels writing the same catalog_id. They are separate connectors
 *    because a seller genuinely chooses them separately — and because their
 *    credentials, once scoped, can differ — but the transport is shared. Which
 *    surface actually shows the catalogue is configured in Commerce Manager,
 *    not over the API.
 *
 * 2. ORDERS NEVER COME BACK. Meta removed native checkout globally between
 *    June and August 2025; every Facebook and Instagram shop now sends the
 *    buyer to the seller's own website (the per-product landing_url) to pay,
 *    and no order ever exists on Meta to import. Both connectors therefore
 *    declare `orderImport: false`. Declaring it true and returning an empty
 *    list would be a lie the planner would faithfully act on, queueing an
 *    order-pull job forever.
 *
 * The live path writes `/{catalog_id}/items_batch` with PRODUCT_ITEM payloads,
 * verified against the official Graph API v26.0 docs on 2026-08-27. Two Meta
 * quirks matter for correctness here: throttling arrives as JSON error codes
 * in the body (4 / 17 / 613 / 80014) rather than as HTTP 429, and items_batch
 * is asynchronous — the POST returns job handles, and per-item rejections
 * surface in validation_status or a later status check, not as an HTTP error.
 * Both are handled below.
 *
 * TikTok Shop lives in its own connector file; this one is Meta only.
 */
import {
  ConnectorError,
  classifyStatus,
  money,
  type CanonicalProduct,
  type Capabilities,
  type CanonicalVariant,
  type ConnectorContext,
  type FieldSpec,
  type InventoryUpdate,
  type Manifest,
  type MarketplaceConnector,
  type PriceUpdate,
  type RemoteOrder,
  type RemoteProduct,
} from "../connector";
import { mockLatency, mockMaybeFail, mockRemoteId } from "./mock";

/**
 * What a catalogue needs to be shoppable in a feed.
 *
 * Shorter than any marketplace's list, and deliberately so: a social catalogue
 * is a merchandising surface, not a compliance surface. There is no HSN code
 * here because Meta does not ask for one — the tax fields on a marketplace
 * listing exist for the marketplace's invoicing, and Meta does not invoice on
 * your behalf now that checkout happens on the seller's own site.
 */
const META_REQUIRED: FieldSpec[] = [
  { path: "title", label: "Product name", required: true },
  { path: "description", label: "Description", required: true },
  { path: "brand", label: "Brand", required: true },
  {
    path: "images",
    label: "At least one image",
    required: true,
    help: "Feed placements crop to square; a centred subject survives it best",
  },
  {
    path: "attributes.condition",
    label: "Condition",
    required: true,
    // Canonical vocabulary, shared with every other connector. Meta's own
    // three values (new / refurbished / used) are translated in metaItem —
    // a platform's private enum never becomes the canonical one.
    enum: ["NEW", "LIKE_NEW", "USED_EXCELLENT", "USED_GOOD", "USED_ACCEPTABLE"],
  },
  {
    path: "attributes.landing_url",
    label: "Product landing page",
    required: true,
    help: "Where a tap goes. Every purchase completes on your own site, so this must work",
  },
];

/**
 * Graph API base. The version is pinned deliberately: Meta expires each
 * version roughly two years after release (v21.0 dies 2027-01-21), so an
 * unpinned "latest" would shift under us while a stale pin eventually 404s.
 * v26.0 is current as of 2026-08-27; bumping it is a one-line change here.
 */
const META_GRAPH = "https://graph.facebook.com/v26.0";

/**
 * Throttling on the Graph API does not look like throttling. Instead of HTTP
 * 429 with Retry-After, Meta returns an ordinary error status whose JSON body
 * carries a rate-limit error code: 4 (app-level), 17 (user-level), 613
 * (custom throttle), 80014 (catalogue-batch business use case). Treating
 * those as their HTTP status would classify them VALIDATION and dead-letter
 * jobs that only needed to wait.
 */
const META_THROTTLE_CODES = new Set([4, 17, 613, 80014]);
const META_THROTTLE_FALLBACK_MS = 15 * 60_000;

/**
 * Best available retry hint for a throttled response. The
 * X-Business-Use-Case-Usage header is JSON keyed by business id, each entry
 * optionally carrying estimated_time_to_regain_access in MINUTES; when Meta
 * does not say, fifteen minutes is a conservative floor for a per-minute
 * catalogue budget that has just been exhausted.
 */
function metaRetryAfterMs(res: Response): number {
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
  } catch {
    // A malformed usage header is Meta's bug, not a reason to fail the
    // classification — fall through to the fixed backoff.
  }
  return META_THROTTLE_FALLBACK_MS;
}

const metaAuth: Manifest["authentication"] = {
  type: "oauth2_access_token",
  fields: [
    { key: "catalog_id", label: "Catalog ID", secret: false },
    {
      key: "business_id",
      label: "Business ID",
      secret: false,
      // Catalogue calls address /{catalog_id}/... directly and never send the
      // business id, so it is informational — kept because it identifies the
      // portfolio the token belongs to, optional because nothing breaks
      // without it.
      optional: true,
      help: "Business Settings → Business info. Not needed for catalogue calls",
    },
    { key: "access_token", label: "System User Access Token", secret: true },
  ],
};

/**
 * Canonical condition -> Meta's three-value enum.
 *
 * Meta has no grade scale, so every used grade collapses to "used". That is a
 * real loss of information and the right place for it to happen is here, at
 * the boundary, rather than by weakening what the canonical model can express.
 */
const metaCondition = (canonical: string): string =>
  canonical === "NEW" ? "new" : canonical === "REFURBISHED" ? "refurbished" : "used";

/**
 * Variant options Meta understands as named PRODUCT_ITEM fields. Anything
 * else ("Fabric", "Storage") has no field in the schema and would either fail
 * validation or vanish silently — so unmapped options are dropped loudly, via
 * ctx.log, where the sync log will show them.
 */
const META_OPTION_FIELDS: Record<string, string> = {
  color: "color",
  colour: "color",
  size: "size",
  material: "material",
  pattern: "pattern",
  gender: "gender",
};

function metaOptions(ctx: ConnectorContext, v: CanonicalVariant): Record<string, string> {
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

/**
 * One PRODUCT_ITEM feed row per variant, grouped under the product's SKU.
 *
 * Meta models a variant as its own `id` (the retailer id) tied together by
 * item_group_id, rather than as a child row under a parent the way a
 * marketplace does. A single-variant product still gets a group so that
 * adding a second size later does not restructure the listing.
 *
 * price / sale_price embed the ISO currency in the string ("499.00 INR") —
 * there is no separate currency field — and the currency comes from the
 * variant (the seller profile as fallback), never a hardcoded constant.
 *
 * The canonical free-text `category` is deliberately not sent: PRODUCT_ITEM
 * has only the fb_product_category / google_product_category taxonomy fields,
 * and a free-text value fits neither, so mapping it would mean inventing a
 * taxonomy lookup the findings do not support.
 */
const metaItem = (
  ctx: ConnectorContext,
  p: CanonicalProduct,
  i: number,
  method: "CREATE" | "UPDATE",
) => {
  const v = p.variants[i]!;
  const a = p.attributes as any;
  const currency = v.currency || ctx.seller.currency;
  /*
   * Channel price rules apply to priceCents only, so a markup can push the
   * selling price above the list price. Meta has no "selling above list"
   * shape: when that happens the effective selling price IS the price, so it
   * goes in `price` (never the lower list number, which would underprice the
   * listing) and there is no sale. sale_price is set only for a genuine
   * discount — and because items_batch UPDATE leaves unlisted fields
   * unchanged, a lapsed discount must be cleared explicitly: on UPDATE the
   * empty string wipes the field, while omitting it (as CREATE does) would
   * keep the old sale price showing forever.
   */
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

interface MetaSpec {
  name: string;
  displayName: string;
  idPrefix: string;
  regions: string[];
  credentialsNote: string;
}

const META_CAPABILITIES: Capabilities = {
  createProduct: true,
  updateProduct: true,
  deleteProduct: true,
  inventorySync: true,
  priceSync: true,
  orderImport: false,
  orderUpdate: false,
  webhooks: false,
  bulkOperations: true,
  variants: true,
};

/** One status check per batch, ~2s after the POST — bounded, never a loop. */
const BATCH_STATUS_DELAY_MS = 2000;

function makeMetaConnector(spec: MetaSpec): MarketplaceConnector {
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
      // Undocumented on the Graph API but handled anyway; prefer an explicit
      // Retry-After if one ever appears, else the usage-header estimate.
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
    } catch {
      // Non-JSON error body; classify purely by status below.
    }
    if (bodyCode !== undefined && META_THROTTLE_CODES.has(bodyCode)) {
      throw new ConnectorError(
        `${spec.displayName} rate limit (Graph error ${bodyCode})`,
        "RATE_LIMITED",
        { retryAfterMs: metaRetryAfterMs(res) },
      );
    }
    /*
     * Auth failures arrive as HTTP 400, not 401: an expired or revoked token
     * comes back as an OAuthException (error.code 190, or 102 for a bad
     * session). Classifying by status alone would call that VALIDATION, so
     * health() would show API_FAILURE instead of AUTH_FAILURE and jobs would
     * dead-letter as validation noise instead of prompting a re-auth. Checked
     * after the throttle codes because Meta's rate-limit errors (4 / 17) are
     * also typed OAuthException.
     */
    if (bodyType === "OAuthException" || bodyCode === 190 || bodyCode === 102) {
      throw new ConnectorError(
        `${spec.displayName} auth failed (${res.status}): ${text.slice(0, 500)}`,
        "AUTHENTICATION",
      );
    }
    throw classifyStatus(res.status, text);
  }

  /**
   * POST a batch of PRODUCT_ITEM requests and confirm it landed.
   *
   * items_batch is asynchronous: HTTP 200 means "accepted", the `handles`
   * array names the background job, and per-item rejections arrive either in
   * `validation_status` on the POST response or from a later
   * check_batch_request_status call. So an item can fail while every HTTP
   * status is 200 — silently reporting success here would hide exactly the
   * errors a seller needs to see.
   *
   * The follow-up is a single bounded check, ~2s after the POST, not a
   * polling loop: the retailer id is the durable idempotent handle (every
   * later write addresses the item by `id`), so if Meta is still processing
   * we log the job handle and accept rather than burn budget waiting.
   */
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
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        return { status: "HEALTHY", detail: "mock mode" };
      }
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
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "createProduct");
        const remoteId = mockRemoteId(spec.idPrefix, p.sku);
        ctx.log(
          `mock: published ${spec.displayName} catalogue item ${remoteId} for ${p.sku}` +
            (p.variants.length > 1 ? ` (${p.variants.length} variants)` : ""),
        );
        return { remoteId };
      }
      const body = await itemsBatch(
        ctx,
        toItems(ctx, p, "CREATE").map((data) => ({ method: "CREATE", data })),
      );
      /*
       * The retailer id is the remote id. The `handles` in the response name
       * an ephemeral batch job, not the item; the item's durable, idempotent
       * address on every later write is the id we chose ourselves — the SKU.
       * The job handles ride along in raw for the audit trail.
       */
      return { remoteId: p.sku, raw: body };
    },

    async updateProduct(ctx, p, remoteId) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updateProduct");
        ctx.log(`mock: updated ${spec.displayName} catalogue item ${remoteId}`);
        return;
      }
      await itemsBatch(
        ctx,
        toItems(ctx, p, "UPDATE").map((data) => ({ method: "UPDATE", data })),
      );
    },

    async updateInventory(ctx, u: InventoryUpdate) {
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updateInventory");
        ctx.log(`mock: ${spec.displayName} availability ${u.sku} -> ${u.available}`);
        return;
      }
      /*
       * Availability is a word here, not a number. Meta hides an out-of-stock
       * item rather than showing "0 left", so the useful signal is the
       * threshold crossing; quantity_to_sell_on_facebook rides along for the
       * placements that surface a count.
       */
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
      if (ctx.mode === "mock") {
        await mockLatency(ctx);
        mockMaybeFail(ctx, "updatePrice");
        ctx.log(`mock: ${spec.displayName} price ${u.sku} -> ${money(u.priceCents)}`);
        return;
      }
      /*
       * Same semantics as the item builder: price is the list price (MRP) and
       * sale_price the discounted one, with the same two constraints. Channel
       * price rules apply to priceCents only, so when a markup pushes it
       * above list the effective selling price IS the price and is advertised
       * as such — never the lower list number, which would underprice the
       * listing. And because items_batch UPDATE leaves unlisted fields
       * unchanged, a lapsed discount is cleared explicitly with sale_price:
       * "" — omitting the field would keep the old sale price showing.
       */
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
      /*
       * Guarded rather than merely empty. Meta removed native checkout
       * globally in mid-2025, so every purchase completes on the seller's own
       * site and no Meta-side order exists — the manifest says
       * orderImport:false and the planner should never call this. Reaching
       * here means something upstream ignored the manifest, and failing
       * loudly is better than returning [] and letting it look like a shop
       * with no sales.
       */
      throw new ConnectorError(
        `${spec.displayName} shops complete checkout on your own website, so there are no orders on Meta to import`,
        "VALIDATION",
      );
    },
  };
}

export const instagram = makeMetaConnector({
  name: "instagram",
  displayName: "Instagram",
  idPrefix: "IGS",
  // Product tagging works broadly; every tag links out to landing_url.
  regions: ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "BR"],
  /*
   * Shopping approval is a property of the account, not of each product,
   * which is why it lives here (and in the setup guide) rather than as a
   * per-product required field: the API accepts catalogue writes before the
   * review passes, but nothing is shoppable until it does.
   */
  credentialsNote:
    "These are not your Instagram login. Generate a system-user access token with the catalog_management and business_management scopes in Business Settings → System users, and copy the Catalog ID from your catalogue's settings in Commerce Manager. Product tags only appear once the Instagram account has passed Shopping review in Commerce Manager.",
});

export const facebook = makeMetaConnector({
  name: "facebook",
  displayName: "Facebook",
  idPrefix: "FBS",
  regions: ["IN", "US", "GB", "AE", "SG", "AU", "CA", "DE", "BR"],
  credentialsNote:
    "These are not your Facebook login. Generate a system-user access token with the catalog_management and business_management scopes in Business Settings → System users, and copy the Catalog ID from your catalogue's settings in Commerce Manager.",
});
