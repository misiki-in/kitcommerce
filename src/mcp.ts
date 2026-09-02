/**
 * The OpenCommerce MCP server.
 *
 *   bun mcp
 *
 * This is the AI seam the README promises: "there is no LLM dependency, no API
 * key, no model choice, and there never needs to be one. When AI arrives it
 * will be as an MCP server — OpenCommerce exposes its existing API as tools,
 * and whatever AI you already use drives it."
 *
 * That promise is the whole design here. Nothing in this file calls a model,
 * holds a key, or chooses a provider. It publishes what the system can already
 * do and lets the assistant you have — Claude Code, Cursor, Zed, anything that
 * speaks MCP — be the intelligence. The AI dependency count stays at zero.
 *
 * ## Why the protocol is hand-rolled
 *
 * MCP has an official SDK, and using it would be a perfectly reasonable
 * choice — this is not a purity argument. It is a size one. MCP over stdio is
 * newline-delimited JSON-RPC 2.0 with five methods that matter, and the entire
 * transport is the last eighty lines of this file: readable in one sitting, no
 * version churn to track, and nothing between a tool result and the wire.
 *
 * If that calculus changes — a spec revision worth tracking, sampling,
 * resources, or elicitation — swap the bottom of this file for
 * `@modelcontextprotocol/sdk` and leave the TOOLS array untouched. It is
 * deliberately the only part that knows anything about OpenCommerce.
 *
 * ## Two families of tools
 *
 * OPERATE — read and change the catalogue, queue syncs, inspect jobs. This is
 * the REST API's surface, addressed by an assistant instead of by fetch.
 *
 * EXTEND — `connector_sdk` and `scaffold_connector`. Adding a marketplace here
 * is famously "two files": one connector, one line in the registry. Those two
 * tools hand an assistant the exact contract and a compiling template, which
 * is what turns "add Shopee" into a change someone can make without having
 * read the codebase first.
 *
 * ## Rules this file lives by
 *
 *   1. Nothing is written to stdout except protocol frames. stdout IS the
 *      transport; a stray console.log corrupts the session. Diagnostics go to
 *      stderr, which is why `log()` below exists and `console.log` does not.
 *
 *   2. Stored channel secrets are never read here — not by any tool, not even
 *      to "check" a connection. The self-test greps this file for the same SQL
 *      patterns it greps the API routes for, so the guarantee is structural
 *      rather than a promise. An assistant reading tool output is a worse
 *      place to leak a secret than a browser is: it may quote it back, paste
 *      it into a file, or hand it to another tool.
 *
 *      (Phrased carefully on purpose. That grep is a plain substring match, so
 *      spelling the forbidden patterns out here would make this file fail its
 *      own check — which is exactly what happened the first time.)
 *
 *   3. Anything that can reach a real marketplace asks first. Syncing to live
 *      channels needs `confirmLive: true`, because an assistant that misreads an
 *      instruction should not be able to publish your catalogue to a marketplace
 *      by accident.
 */
import { config } from "./lib/server/config";
import { outboxEvents } from "./lib/server/drivers";
import { sqliteDb } from "./lib/server/drivers/db.sqlite";
import { BACKOFF_MS, sqliteQueue } from "./lib/server/drivers/queue.sqlite";
import { createRepo } from "./lib/server/repo";
import { createPlanner, OPERATIONS } from "./lib/server/sync";
import { missingRequiredFields } from "./lib/server/connector";
import { CONNECTOR_GROUPS, connectors, getConnector } from "./lib/server/connectors";

const VERSION = "0.1.0";

/** Newest protocol revision this server implements. */
const PROTOCOL = "2025-06-18";

/** Older revision kept working, since editors upgrade on their own schedule. */
const SUPPORTED_PROTOCOLS = new Set([PROTOCOL, "2025-03-26", "2024-11-05"]);

/** Diagnostics. Never stdout — see rule 1. */
const log = (...parts: unknown[]) => console.error("[mcp]", ...parts);

// ------------------------------------------------------------------ wiring

/*
 * Wired here rather than imported from app.ts, following seed.ts and
 * selftest.ts: app.ts reads its schema through Vite's `?raw` import and starts
 * a worker, and this process is neither a Vite build nor the right place to
 * run one. The worker belongs to `bun dev`; this server only ever queues.
 */
const schema = await Bun.file(
  new URL("./lib/server/db/schema.sql", import.meta.url),
).text();

const db = sqliteDb(config.dbPath);
db.exec(schema);

const bus = outboxEvents(db);
const queue = sqliteQueue(db);
const repo = createRepo(db, bus);
const planner = createPlanner(repo, queue);
planner.register(bus);

/**
 * The store this server operates on.
 *
 * One account → one organization → one store is the tenancy model today, so
 * resolving it is a lookup rather than a parameter on every tool. Read fresh
 * each time: a server left running while someone completes onboarding in the
 * browser should start working, not keep reporting an empty database.
 */
function context(): { orgId: string; storeId: string; storeName: string } | null {
  const org = db.get<{ id: string }>("SELECT id FROM organizations ORDER BY created_at LIMIT 1");
  if (!org) return null;
  const store = repo.storesForOrg(org.id)[0];
  if (!store) return null;
  return { orgId: org.id, storeId: store.id, storeName: store.name };
}

/** Thrown by a tool to return a readable failure instead of a stack trace. */
class ToolError extends Error {}

function need() {
  const ctx = context();
  if (!ctx) {
    throw new ToolError(
      "No store exists yet. Run `bun seed` for a demo catalogue, or sign up at http://localhost:5173 first.",
    );
  }
  return ctx;
}

const groupOf = new Map<string, string>();
for (const g of CONNECTOR_GROUPS) for (const n of g.names) groupOf.set(n, g.label);

// ------------------------------------------------------------------- tools

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, any>) => unknown;
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const schemaOf = (props: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties: props,
  required,
  additionalProperties: false,
});

const TOOLS: Tool[] = [
  // ---------------------------------------------------------------- orient
  {
    name: "describe_opencommerce",
    description:
      "Start here. Explains what this system is, the canonical product model every connector receives, and the seams available for extending it. Call this before writing a connector.",
    inputSchema: schemaOf({}),
    run() {
      const ctx = context();
      return {
        what: "Commerce integration infrastructure. One catalogue is published to many marketplaces and social channels, with retries, idempotency and a full audit trail.",
        store: ctx ? { name: ctx.storeName, id: ctx.storeId } : "none yet — run `bun seed`",
        connectors: Object.keys(connectors).length,
        canonicalModel:
          "A CanonicalProduct carries sku, title, description, brand, category, attributes (free-form string map), images[], variants[] (sku, options, priceCents, mrpCents, available, weightG), plus taxRateBp, hsnCode, weightG and dimensions. Connectors translate this into their own payload — they never see the database.",
        howSyncWorks:
          "Saving a product emits an event. The planner turns it into one job per channel that can accept it, skipping channels whose connector declares it cannot do the operation and marking mappings INCOMPLETE when a required field is missing. The worker runs jobs with an idempotency key, so a retry produces the same remote ID rather than a second listing.",
        retryLadder: BACKOFF_MS.map((ms) => (ms < 60000 ? `${ms / 1000}s` : `${ms / 60000}m`)),
        extending:
          "Adding a marketplace is two files: a connector in src/lib/server/connectors/, and one line in the registry in src/lib/server/connectors/index.ts. Call connector_sdk for the contract and scaffold_connector for a working template.",
        seams:
          "Infrastructure is a plugin plane: db, queue, events, search, notify, blob and secrets are ports in src/lib/server/ports.ts with swappable drivers. SQLite is the default for both the database and the queue.",
      };
    },
  },

  // ------------------------------------------------------------ connectors
  {
    name: "list_connectors",
    description:
      "Every marketplace and social connector in the registry, with its group, regions and headline capabilities.",
    inputSchema: schemaOf({}),
    run() {
      return Object.values(connectors).map((c) => {
        const m = c.manifest();
        return {
          name: m.name,
          displayName: m.displayName,
          group: groupOf.get(m.name) ?? "Other",
          platformType: m.platformType,
          regions: m.regions,
          orderImport: m.capabilities.orderImport,
          variants: m.capabilities.variants,
          requiredFieldCount: m.requiredFields.length,
        };
      });
    },
  },
  {
    name: "get_connector",
    description:
      "One connector's full manifest: authentication fields, every capability, every required field with its help text, rate limits and docs URL. This is the contract the planner validates against.",
    inputSchema: schemaOf({ name: str("Connector name, e.g. flipkart, nykaa, tiktok") }, ["name"]),
    run({ name }) {
      if (!connectors[name]) {
        throw new ToolError(
          `Unknown connector "${name}". Known: ${Object.keys(connectors).join(", ")}`,
        );
      }
      return getConnector(name).manifest();
    },
  },

  // ------------------------------------------------------------- catalogue
  {
    name: "list_products",
    description: "Products in the store, newest first, with stock and variant counts.",
    inputSchema: schemaOf({ limit: num("Max rows (default 50)") }),
    run({ limit }) {
      const { storeId } = need();
      return repo.listProducts(storeId, Math.min(Number(limit) || 50, 500)).map((p) => {
        const variants = repo.variants(p.id);
        return {
          id: p.id,
          sku: p.sku,
          title: p.title,
          status: p.status,
          brand: p.brand,
          category: p.category,
          variants: variants.length,
          stock: variants.reduce((n, v) => n + v.available, 0),
        };
      });
    },
  },
  {
    name: "get_product",
    description:
      "One product in canonical form — exactly the shape a connector's createProduct receives. Use this to see what a marketplace would actually be sent.",
    inputSchema: schemaOf({ productId: str("Product id, e.g. prd_...") }, ["productId"]),
    run({ productId }) {
      const p = repo.canonical(productId);
      if (!p) throw new ToolError(`No product with id "${productId}". Call list_products first.`);
      return p;
    },
  },
  {
    name: "create_or_update_product",
    description:
      "Create a product, or update one by passing its id. Omitting variants or images leaves the stored ones untouched. Saving emits an event, which queues a sync to every channel that can accept the product.",
    inputSchema: schemaOf(
      {
        id: str("Existing product id. Omit to create."),
        sku: str("Your own stock keeping unit. Unique within the store."),
        title: str("Product name"),
        description: str("Long description"),
        brand: str("Brand name"),
        category: str("Your category label"),
        status: str("draft or active"),
        attributes: {
          type: "object",
          description:
            "Free-form string map. Marketplace-required keys live here — call validate_product to find which are missing.",
          additionalProperties: { type: "string" },
        },
        hsnCode: str("HSN code, required by Indian marketplaces for GST"),
        weightG: num("Shipping weight in grams"),
        variants: {
          type: "array",
          description: "Replaces all stored variants when supplied.",
          items: schemaOf(
            {
              sku: str("Variant SKU"),
              options: { type: "object", additionalProperties: { type: "string" } },
              priceCents: num("Selling price in minor units"),
              mrpCents: num("List price in minor units"),
              available: num("Units in stock"),
              weightG: num("Variant weight in grams"),
            },
            ["sku", "priceCents"],
          ),
        },
        images: {
          type: "array",
          description: "Replaces all stored images when supplied.",
          items: schemaOf({ url: str("Image URL"), alt: str("Alt text") }, ["url"]),
        },
      },
      ["sku", "title"],
    ),
    async run(args) {
      const { orgId, storeId } = need();
      const result = await repo.saveProduct({ orgId, storeId, ...args } as any);
      return {
        ...result,
        note: result.changed
          ? "Saved. A sync has been queued for every channel that can accept it — run the worker (`bun dev`) to execute the jobs."
          : "Saved. Nothing changed, so no sync was queued.",
      };
    },
  },
  {
    name: "validate_product",
    description:
      "Answers 'why is this not listing'. Checks a product against each channel's declared required fields and reports exactly which are missing, per channel.",
    inputSchema: schemaOf(
      {
        productId: str("Product id"),
        connector: str("Optional: check one connector by name instead of the connected channels"),
      },
      ["productId"],
    ),
    run({ productId, connector }) {
      const { storeId } = need();
      const product = repo.canonical(productId);
      if (!product) throw new ToolError(`No product with id "${productId}".`);

      const targets = connector
        ? [{ label: connector, manifest: getConnector(connector).manifest() }]
        : repo.listChannels(storeId).map((c) => ({
            label: c.name,
            manifest: getConnector(c.connector).manifest(),
          }));

      if (!targets.length) {
        throw new ToolError(
          "No channels are connected. Pass `connector` to check against a connector's manifest instead.",
        );
      }

      return targets.map((t) => {
        const missing = missingRequiredFields(t.manifest, product);
        return {
          channel: t.label,
          connector: t.manifest.name,
          ready: missing.length === 0,
          missing: missing.map((f) => ({ path: f.path, label: f.label, help: f.help ?? null })),
        };
      });
    },
  },

  // ------------------------------------------------------------------ sync
  {
    name: "list_channels",
    description:
      "Connected channels with their health status and how much of the catalogue is listed. Credentials are never returned.",
    inputSchema: schemaOf({}),
    run() {
      const { storeId } = need();
      return repo.listChannels(storeId).map((c) => {
        const mapped = repo.mappingsForChannel(c.id);
        return {
          id: c.id,
          name: c.name,
          connector: c.connector,
          status: c.status,
          mode: c.mode,
          listed: mapped.filter((m) => m.remote_product_id).length,
          total: mapped.length,
        };
      });
    },
  },
  {
    name: "sync_product",
    description:
      "Queue a sync for one product across every channel that can accept it. Requires confirmLive: true when channels are configured.",
    inputSchema: schemaOf(
      {
        productId: str("Product id"),
        operation: {
          type: "string",
          enum: Object.values(OPERATIONS),
          description: "Defaults to PRODUCT_UPDATE.",
        },
        confirmLive: bool(
          "Confirmation that you intend to publish to configured marketplace channels.",
        ),
      },
      ["productId"],
    ),
    run({ productId, operation, confirmLive }) {
      const { orgId, storeId } = need();
      if (!repo.canonical(productId)) throw new ToolError(`No product with id "${productId}".`);

      const channels = repo.listChannels(storeId);
      if (channels.length && !confirmLive) {
        throw new ToolError(
          `This store has ${channels.length} configured channel(s) (${channels
            .map((c) => c.name)
            .join(", ")}). Syncing will publish to the live marketplaces. ` +
            "Confirm with the user, then call again with confirmLive: true.",
        );
      }

      const queued = planner.planProduct(
        orgId,
        storeId,
        productId,
        operation || OPERATIONS.PRODUCT_UPDATE,
      );
      return {
        queued,
        note:
          queued === 0
            ? "Nothing queued. Either no channel can accept this product yet, or every channel is already up to date. Call validate_product to see missing fields."
            : `${queued} job(s) queued. Run \`bun dev\` to execute them.`,
      };
    },
  },
  {
    name: "list_jobs",
    description:
      "Recent sync jobs with status, attempt count and last error. Use this to see what failed and why.",
    inputSchema: schemaOf({
      status: str("Filter, e.g. QUEUED, RUNNING, SUCCEEDED, RETRYING, DEAD_LETTER"),
      limit: num("Max rows (default 25)"),
    }),
    run({ status, limit }) {
      const { storeId } = need();
      const rows = db.all<Record<string, any>>(
        `SELECT id, channel_id, entity_id, operation, status, attempts, last_error, run_after, created_at
           FROM sync_jobs
          WHERE store_id = ?${status ? " AND status = ?" : ""}
          ORDER BY created_at DESC
          LIMIT ?`,
        status
          ? [storeId, String(status), Math.min(Number(limit) || 25, 200)]
          : [storeId, Math.min(Number(limit) || 25, 200)],
      );
      return { stats: repo.jobStats(storeId), jobs: rows };
    },
  },
  {
    name: "retry_job",
    description:
      "Put a dead-lettered or failed job back on the queue. Fix the cause first — the retry reuses the same idempotency key, so it cannot create a duplicate listing.",
    inputSchema: schemaOf({ jobId: str("Job id from list_jobs") }, ["jobId"]),
    run({ jobId }) {
      queue.retry(jobId);
      return { jobId, status: "requeued" };
    },
  },
  {
    name: "list_orders",
    description: "Orders imported from the channels, newest first.",
    inputSchema: schemaOf({ limit: num("Max rows (default 25)") }),
    run({ limit }) {
      const { storeId } = need();
      return repo.listOrders(storeId, Math.min(Number(limit) || 25, 200)).map((o) => ({
        id: o.id,
        externalId: o.external_id,
        source: o.source,
        status: o.status,
        totalCents: o.total_cents,
        currency: o.currency,
        createdAt: o.created_at,
      }));
    },
  },

  // ---------------------------------------------------------------- extend
  {
    name: "connector_sdk",
    description:
      "The contract a connector must satisfy: the interface, the manifest shape, the error taxonomy and the rules that are not obvious from the types. Read this before writing or reviewing a connector.",
    inputSchema: schemaOf({}),
    run() {
      return {
        location: "src/lib/server/connectors/<name>.ts, registered in ./index.ts",
        interface: {
          "manifest()": "Returns the Manifest. Called constantly; keep it a constant lookup.",
          "health(ctx)": "Returns { status, detail? }.",
          "createProduct(ctx, product)": "Returns { remoteId, raw? }.",
          "updateProduct(ctx, product, remoteId)": "Returns void.",
          "updateInventory(ctx, update)": "Returns void.",
          "updatePrice(ctx, update)": "Returns void.",
          "listOrders(ctx, since)": "Returns RemoteOrder[]. Only if capabilities.orderImport is true.",
        },
        manifest: {
          name: "Registry key. Lowercase, no spaces.",
          displayName: "What the merchant sees.",
          platformType: "'marketplace' or 'social'.",
          group:
            "Which heading the connector picker and the landing page file this under, e.g. 'India — horizontal' or 'Social'. Declared here, not in a separate list: CONNECTOR_GROUPS is derived from these, so a new group appears simply by naming one.",
          status:
            "'ready' means the connector has been exercised against the live API and a seller can point a real catalogue at it. 'development' means its API is partner-gated or unproven. Default to 'development' — promoting it is one word once you have run it for real.",
          idPrefix:
            "Uppercase prefix for remote IDs, e.g. 'ETSY'. Read by the landing page so it can show a realistic ID without duplicating a lookup table.",
          authentication: "{ type, fields: [{ key, label, secret }] } — drives the connect form.",
          regions: "ISO country codes this channel actually sells in.",
          capabilities:
            "createProduct, updateProduct, deleteProduct, inventorySync, priceSync, orderImport, orderUpdate, webhooks, bulkOperations, variants. The planner obeys these literally.",
          requiredFields:
            "FieldSpec[] — { path, label, required, help?, enum? }. Validated before a job is queued; a product missing one becomes a visible INCOMPLETE mapping instead of a failed job.",
          rateLimits: "{ requestsPerSecond, burst }",
          docsUrl: "Developer API reference.",
        },
        errors: {
          classes: [
            "RETRYABLE",
            "RATE_LIMITED",
            "AUTHENTICATION",
            "VALIDATION",
            "NOT_FOUND",
            "CONFLICT",
            "UNKNOWN",
          ],
          rule: "Only RETRYABLE, RATE_LIMITED and CONFLICT are retried. Classifying a malformed payload as retryable burns the rate limit four more times and hides the real problem.",
          helper: "classifyStatus(status, body) maps an HTTP status onto the taxonomy.",
        },
        rules: [
          "Every operation calls the real marketplace API endpoints with proper credentials.",
          "requiredFields must be honest. It is what the product form renders and what the planner validates; padding it blocks listings, understating it produces failed jobs.",
          "Declare a capability false rather than implementing it as a no-op. The planner will simply never call it.",
          "Never widen the canonical model for one marketplace. Translate at the boundary — a platform's private enum stays inside its own file.",
          "Say in the docblock whether the API was verified against public documentation or only against what the portal describes. Three of the current connectors are verifiable; the rest say so out loud.",
        ],
        addToRegistry:
          "In src/lib/server/connectors/index.ts: import it, add it to the `connectors` map, and add its name to the right entry in CONNECTOR_GROUPS.",
      };
    },
  },
  {
    name: "scaffold_connector",
    description:
      "Generates a complete, compiling connector with honest TODOs for the live paths, plus the exact registry edit. Returns source text — write it yourself with your own editor tools.",
    inputSchema: schemaOf(
      {
        name: str("Registry key, lowercase, e.g. shopee"),
        displayName: str("What the merchant sees, e.g. Shopee"),
        regions: {
          type: "array",
          items: { type: "string" },
          description: "ISO country codes it actually sells in, e.g. [\"SG\",\"MY\"]",
        },
        baseUrl: str("API base URL"),
        docsUrl: str("Developer docs URL"),
        idPrefix: str("Short uppercase prefix for remote IDs, e.g. SHP"),
        group: str(
          "Heading it files under in the picker and on the landing page. Reuse an existing one where it fits — call list_connectors to see them. Defaults to Global.",
        ),
        orderImport: bool("Does it have a native checkout that returns orders? Default true."),
      },
      ["name", "displayName"],
    ),
    run(a) {
      const name = String(a.name).toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!name) throw new ToolError("`name` must contain letters or digits.");
      if (connectors[name]) {
        throw new ToolError(`"${name}" already exists in the registry — edit that file instead.`);
      }
      const display = String(a.displayName);
      const prefix = String(a.idPrefix || name.slice(0, 3)).toUpperCase();
      const group = String(a.group || "Global");
      const regions = Array.isArray(a.regions) && a.regions.length ? a.regions : ["IN"];
      const orderImport = a.orderImport !== false;
      const base = String(a.baseUrl || `https://api.${name}.example/seller`);
      const docs = String(a.docsUrl || `https://${name}.example/developers`);
      const q = (v: unknown) => JSON.stringify(v);

      const source = `/**
 * ${display} connector.
 *
 * TODO Say here whether this was written against public documentation anyone
 * can read, or only against what the seller portal describes. Be specific —
 * every other connector in this directory is, and a merchant wiring up real
 * credentials is entitled to know which one they are dealing with.
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
} from "../connector";

const BASE_URL = ${q(base)};

const manifest: Manifest = {
  name: ${q(name)},
  displayName: ${q(display)},
  version: "0.1.0",
  platformType: "marketplace",
  group: ${q(group)},
  // "development" until someone has run this against the live API. The landing
  // page greys these out and counts them separately, which is the honest
  // default for a connector written from documentation alone.
  status: "development",
  idPrefix: ${q(prefix)},
  authentication: {
    type: "api_key",
    fields: [
      { key: "seller_id", label: "Seller ID", secret: false },
      { key: "api_key", label: "API Key", secret: true },
    ],
  },
  regions: ${q(regions)},
  capabilities: {
    createProduct: true,
    updateProduct: true,
    deleteProduct: false,
    inventorySync: true,
    priceSync: true,
    orderImport: ${orderImport},
    orderUpdate: false,
    webhooks: false,
    bulkOperations: false,
    variants: true,
  },
  // TODO Only what ${display} genuinely rejects a listing for. This is what the
  // product form renders and what the planner validates before queueing.
  requiredFields: [
    { path: "title", label: "Product name", required: true },
    { path: "brand", label: "Brand", required: true },
    { path: "images", label: "At least one image", required: true },
  ],
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  docsUrl: ${q(docs)},
};

async function call(ctx: ConnectorContext, path: string, init: RequestInit = {}): Promise<any> {
  const sellerId = ctx.credentials.seller_id ?? "";
  const apiKey = ctx.credentials.api_key ?? "";
  if (!sellerId || !apiKey) {
    throw new ConnectorError("missing ${display} credentials", "AUTHENTICATION");
  }

  const res = await fetch(\`\${BASE_URL}\${path}\`, {
    ...init,
    headers: {
      "X-Seller-Id": sellerId,
      Authorization: \`Bearer \${apiKey}\`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  // Rate limits carry their own wait; the ladder in the queue defers to it.
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? 60);
    throw new ConnectorError("${display} rate limit", "RATE_LIMITED", {
      retryAfterMs: retryAfter * 1000,
    });
  }
  if (!res.ok) throw classifyStatus(res.status, await res.text());

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** Canonical product -> ${display}'s payload. Translate here, never upstream. */
function toPayload(p: CanonicalProduct) {
  return {
    seller_sku: p.sku,
    name: p.title,
    description: p.description,
    brand: p.brand,
    images: p.images.map((i) => i.url),
    weight_g: p.weightG,
    variants: p.variants.map((v) => ({
      seller_sku: v.sku,
      options: v.options,
      price: money(v.priceCents),
      stock: v.available,
    })),
  };
}

export const ${name}: MarketplaceConnector = {
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
    const body = await call(ctx, "/v1/products", {
      method: "POST",
      body: JSON.stringify(toPayload(p)),
    });
    return { remoteId: String(body?.product_id ?? p.sku), raw: body };
  },

  async updateProduct(ctx, p, remoteId) {
    await call(ctx, \`/v1/products/\${encodeURIComponent(remoteId)}\`, {
      method: "PUT",
      body: JSON.stringify(toPayload(p)),
    });
  },

  async updateInventory(ctx, u: InventoryUpdate) {
    await call(ctx, "/v1/inventory", {
      method: "POST",
      body: JSON.stringify({ seller_sku: u.sku, stock: u.available }),
    });
  },

  async updatePrice(ctx, u: PriceUpdate) {
    await call(ctx, "/v1/prices", {
      method: "POST",
      body: JSON.stringify({ seller_sku: u.sku, price: money(u.priceCents) }),
    });
  },
${
  orderImport
    ? `
  async listOrders(ctx, since): Promise<RemoteOrder[]> {
    const body = await call(
      ctx,
      \`/v1/orders?from=\${encodeURIComponent(since.toISOString())}&limit=50\`,
    );
    return (body?.orders ?? []).map((o: any) => ({
      externalId: String(o.order_id ?? o.id),
      status: String(o.status ?? "NEW"),
      currency: String(o.currency ?? "INR"),
      totalCents: Math.round(Number(o.total ?? 0) * 100),
      placedAt: o.created_at ?? new Date().toISOString(),
      customer: { name: o.buyer_name ?? "", email: "", phone: "" },
      shippingAddress: o.shipping_address ?? {},
      items: (o.items ?? []).map((it: any) => ({
        sku: it.seller_sku ?? "",
        title: it.name ?? "",
        quantity: Number(it.quantity ?? 1),
        priceCents: Math.round(Number(it.price ?? 0) * 100),
        remoteItemId: String(it.item_id ?? ""),
      })),
    }));
  },
`
    : ""
}};
`;

      return {
        path: `src/lib/server/connectors/${name}.ts`,
        source,
        registryEdit: {
          file: "src/lib/server/connectors/index.ts",
          addImport: `import { ${name} } from "./${name}";`,
          addToMap: `  ${name},`,
          grouping: `Nothing to do. CONNECTOR_GROUPS is derived from each manifest's \`group\`, which this scaffold already sets to ${q(group)} — naming a group that does not exist yet simply creates it.`,
        },
        thenRun: [
          "bun test — the self-test asserts every registered connector's manifest validates against the complete-product fixture.",
          `If it fails with "${name}: complete product passes", add the attributes your requiredFields ask for to COMPLETE_ATTRIBUTES in src/lib/server/fixtures.ts.`,
        ],
      };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ---------------------------------------------------------------- protocol

type Id = string | number | null;

const send = (msg: Record<string, unknown>) => {
  process.stdout.write(JSON.stringify(msg) + "\n");
};

const reply = (id: Id, result: unknown) => send({ jsonrpc: "2.0", id, result });
const fail = (id: Id, code: number, message: string) =>
  send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(msg: any): Promise<void> {
  const { id = null, method, params } = msg ?? {};

  // A notification has no id and must never be answered.
  const isNotification = id === null || id === undefined;

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      log(`client ${params?.clientInfo?.name ?? "unknown"} asked for ${asked ?? "no version"}`);
      return reply(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.has(asked) ? asked : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "opencommerce", version: VERSION },
        instructions:
          "OpenCommerce publishes one catalogue to many marketplaces. Call describe_opencommerce first for orientation, connector_sdk before writing a connector, and validate_product to explain why something is not listing. Syncs to live channels require explicit confirmation.",
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return;

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(
        id,
        { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) },
      );

    case "tools/call": {
      const tool = BY_NAME.get(params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const out = await tool.run(params?.arguments ?? {});
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        });
      } catch (e) {
        /*
         * Tool failures come back as a result with isError, not as a protocol
         * error: the model is supposed to read them and try something else,
         * and a JSON-RPC error would be swallowed by the client instead.
         */
        const message = e instanceof ToolError ? e.message : `${(e as Error).message}`;
        if (!(e instanceof ToolError)) log(`tool ${tool.name} threw:`, e);
        return reply(id, { content: [{ type: "text", text: message }], isError: true });
      }
    }

    default:
      if (isNotification) return;
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/*
 * Frames are newline-delimited JSON. Chunks arrive at whatever size the pipe
 * feels like, so the tail of a partial line is held over rather than parsed.
 */
let buffer = "";

for await (const chunk of Bun.stdin.stream()) {
  buffer += Buffer.from(chunk).toString("utf8");

  let cut: number;
  while ((cut = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, cut).trim();
    buffer = buffer.slice(cut + 1);
    if (!line) continue;

    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(null, -32700, "Parse error");
      continue;
    }

    try {
      await handle(msg);
    } catch (e) {
      log("handler crashed:", e);
      fail((msg as any)?.id ?? null, -32603, "Internal error");
    }
  }
}

log("stdin closed, exiting");
