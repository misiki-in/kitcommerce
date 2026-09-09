/**
 * Zero-config by construction.
 *
 * A fresh clone runs with no .env, no flags and no external services: the
 * database is a file, the queue is that same file, uploads go to disk, and the
 * encryption key is generated on first boot. Every value below has a working
 * default; environment variables only exist so the same code can be deployed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const dataDir = process.env.OC_DATA_DIR ?? join(root, "data");

mkdirSync(dataDir, { recursive: true });

/**
 * Generated once and reused. Kept out of git (data/ is gitignored) so a clone
 * never inherits someone else's key, and a restart never orphans stored
 * credentials. Set OC_SECRET_KEY (base64, 32 bytes) to manage it externally.
 */
function loadOrCreateKey(): Uint8Array {
  const fromEnv = process.env.OC_SECRET_KEY;
  if (fromEnv) {
    const buf = Buffer.from(fromEnv, "base64");
    if (buf.length !== 32) {
      throw new Error("OC_SECRET_KEY must be exactly 32 bytes, base64-encoded");
    }
    return new Uint8Array(buf);
  }
  const keyfile = join(dataDir, ".keyfile");
  if (existsSync(keyfile)) {
    return new Uint8Array(Buffer.from(readFileSync(keyfile, "utf8").trim(), "base64"));
  }
  const key = crypto.getRandomValues(new Uint8Array(32));
  writeFileSync(keyfile, Buffer.from(key).toString("base64"), { mode: 0o600 });
  return key;
}

function resolveDbPath(): string {
  const urlOrPath = process.env.DATABASE_URL || process.env.OC_DB_URL || process.env.OC_DB_PATH;
  if (!urlOrPath) {
    return join(dataDir, "opencommerce.db");
  }
  // If provided as sqlite URL e.g. "sqlite://path/to/db" or "file:path/to/db"
  if (urlOrPath.startsWith("sqlite://")) {
    return urlOrPath.slice("sqlite://".length);
  }
  if (urlOrPath.startsWith("file://")) {
    return urlOrPath.slice("file://".length);
  }
  if (urlOrPath.startsWith("file:")) {
    return urlOrPath.slice("file:".length);
  }
  return urlOrPath;
}

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",

  dataDir,
  dbPath: resolveDbPath(),
  uploadsDir: join(dataDir, "uploads"),

  secretKey: loadOrCreateKey(),
  sessionTtlMs: 1000 * 60 * 60 * 24 * 30,

  /** Service-layer cap, deliberately not a DB constraint (see docs). */
  maxStoresPerOrg: Number(process.env.OC_MAX_STORES_PER_ORG ?? 1),

  /**
   * The account `bun seed` creates. The login form prefills these ONLY when
   * this exact account exists and NODE_ENV is not production, so a deployed
   * instance always shows an empty form.
   */
  demo: {
    email: "demo@opencommerce.dev",
    password: "demo1234",
  },

  /**
   * Google sign-in. Entirely optional: with no client ID configured the button
   * is shown but disabled and email/password remains the working path, so a
   * fresh clone still needs zero configuration.
   */
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI ??
      `http://localhost:${Number(process.env.PORT ?? 3000)}/auth/google/callback`,
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },

  /**
   * AI listing drafts. Entirely optional, and off in every default install.
   *
   * Two steps turn it on, neither of them taken for you: `bun add
   * @anthropic-ai/sdk` and an ANTHROPIC_API_KEY. That keeps the promise a
   * fresh clone makes — no key, no account, no runtime dependency — while
   * still letting a seller who wants drafting have it. With the key unset,
   * $server/ai returns null and the deterministic suggester answers instead.
   *
   * Design-time only. See the header of $server/ai.ts for why this must never
   * reach the sync path.
   */
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    model: process.env.OC_AI_MODEL ?? "claude-opus-5",
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  /**
   * Where this installation is reachable from outside.
   *
   * OAuth callbacks are registered with the marketplace ahead of time and must
   * match byte for byte, so this cannot be inferred per request from a Host
   * header a proxy may have rewritten. Localhost is the right default for the
   * clone-and-run path; a deployment sets OC_PUBLIC_URL once.
   */
  publicUrl: process.env.OC_PUBLIC_URL ?? `http://localhost:${Number(process.env.PORT ?? 3000)}`,

  /**
   * Marketplace OAuth apps.
   *
   * Only needed for the marketplaces whose APIs require a token the seller
   * grants rather than a key they can copy. Unset means the connect form still
   * works exactly as before — the button simply does not appear.
   *
   * These identify *this installation* to the marketplace, not the seller, so
   * they are per-deployment configuration rather than per-channel credentials.
   * Every seller's own tokens still land encrypted in the credentials table.
   */
  oauth: {
    etsy: {
      clientId: process.env.ETSY_CLIENT_ID ?? "",
      /**
       * Sits next to the keystring on the app page. Etsy's x-api-key header is
       * "keystring:shared_secret", so without this the exchanged credentials
       * only work if the seller pastes the combined form by hand.
       */
      sharedSecret: process.env.ETSY_SHARED_SECRET ?? "",
      // Read and write listings, read sales. Deliberately no listings_d: this
      // system never deletes a seller's listings, so it should not hold the
      // permission to.
      scopes: process.env.ETSY_SCOPES ?? "listings_r listings_w transactions_r",
    },
    meta: {
      appId: process.env.META_APP_ID ?? process.env.FACEBOOK_APP_ID ?? "",
      appSecret: process.env.META_APP_SECRET ?? process.env.FACEBOOK_APP_SECRET ?? "",
      scopes: process.env.META_SCOPES ?? "catalog_management,business_management",
    },
    amazon: {
      /** amzn1.sellerapps.app.… from Developer Central, not the LWA client ID. */
      applicationId: process.env.AMAZON_APPLICATION_ID ?? "",
      clientId: process.env.AMAZON_LWA_CLIENT_ID ?? "",
      clientSecret: process.env.AMAZON_LWA_CLIENT_SECRET ?? "",
      /**
       * The consent page lives on the seller's own Seller Central host, which
       * is regional: sellercentral.amazon.in for India,
       * sellercentral-europe.amazon.com for the EU, and so on. Configured
       * rather than derived from a marketplace table, because the mapping
       * belongs to Amazon and would rot here.
       */
      sellerCentralHost: process.env.AMAZON_SELLER_CENTRAL_HOST ?? "sellercentral.amazon.com",
      /** Draft apps are only reachable with version=beta; a live app rejects it. */
      draft: process.env.AMAZON_APP_DRAFT === "1",
    },
    ebay: {
      clientId: process.env.EBAY_CLIENT_ID ?? "",
      clientSecret: process.env.EBAY_CLIENT_SECRET ?? "",
      /** eBay's RuName, not a URL. See $server/oauth for why. */
      ruName: process.env.EBAY_RU_NAME ?? "",
      sandbox:
        process.env.EBAY_ENVIRONMENT === "sandbox" ||
        process.env.EBAY_SANDBOX === "1" ||
        process.env.EBAY_SANDBOX === "true",
      scopes:
        process.env.EBAY_SCOPES ??
        "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.account",
    },
  },

  worker: {
    enabled: process.env.OC_WORKER !== "off",
    concurrency: Number(process.env.OC_WORKER_CONCURRENCY ?? 4),
    pollMs: Number(process.env.OC_WORKER_POLL_MS ?? 1000),
    staleAfterMs: 5 * 60 * 1000,
  },

  /** Which driver satisfies each port. Defaults need no infrastructure. */
  drivers: {
    db: process.env.OC_DRIVER_DB ?? "sqlite", // sqlite | postgres
    queue: process.env.OC_DRIVER_QUEUE ?? "sqlite", // sqlite | postgres | redis
    search: process.env.OC_DRIVER_SEARCH ?? "sql", // sql | meilisearch
    notify: process.env.OC_DRIVER_NOTIFY ?? "noop", // noop | resend | sendgrid
    blob: process.env.OC_DRIVER_BLOB ?? "fs", // fs | s3
  },
};

export type Config = typeof config;
