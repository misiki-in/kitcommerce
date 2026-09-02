/**
 * Universal Connector Execution & Channel Orchestration Service.
 *
 * Provides a clean plugin-style interface for executing channel operations
 * (product publishing, updates, deletions, and discovery) dynamically without
 * hardcoding marketplace-specific handlers in routes or workflows.
 */
import type { CanonicalProduct, ConnectorContext, MarketplaceConnector, RemoteProduct } from "../connector";
import { getConnector } from "./index";
import { config } from "../config";
import { localSecrets } from "../drivers";
import type { Repo } from "../repo";

const secrets = localSecrets(config.secretKey);

export interface ChannelContextResult {
  connector: MarketplaceConnector;
  ctx: ConnectorContext;
  channel: any;
}

/**
 * Builds a typed, authenticated ConnectorContext for any connected channel dynamically.
 */
export async function buildChannelContext(
  repo: Repo,
  channelId: string,
  storeOverride?: any,
): Promise<ChannelContextResult | null> {
  const channel = repo.getChannel(channelId);
  if (!channel) return null;

  const connector = getConnector(channel.connector);
  if (!connector) return null;

  const credRow = repo.db.get<{ ciphertext: Uint8Array }>(
    "SELECT ciphertext FROM credentials WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
    [channel.id],
  );

  let credentials: Record<string, string> = {};
  if (credRow?.ciphertext) {
    try {
      credentials = await secrets.open<Record<string, string>>(new Uint8Array(credRow.ciphertext));
    } catch {}
  }

  let channelConfig: Record<string, any> = {};
  if (channel.config) {
    try {
      channelConfig = typeof channel.config === "string" ? JSON.parse(channel.config) : channel.config;
    } catch {}
  }

  const store = storeOverride || repo.getStore(channel.store_id);

  const ctx: ConnectorContext = {
    config: channelConfig,
    credentials,
    seller: {
      storeName: store?.name || "",
      description: store?.description || "",
      logoUrl: store?.logo_url || "",
      legalName: store?.legal_name || "",
      businessType: store?.business_type || "",
      taxId: store?.tax_id || "",
      registrationNo: store?.registration_no || "",
      supportEmail: store?.support_email || "",
      supportPhone: store?.support_phone || "",
      website: store?.website || "",
      address: {
        line1: store?.address_line1 || "",
        line2: store?.address_line2 || "",
        city: store?.city || "",
        state: store?.state || "",
        postalCode: store?.postal_code || "",
        country: store?.country || "IN",
      },
      currency: store?.currency || "USD",
    },
    log: (msg: string, meta?: Record<string, unknown>) =>
      console.log(`[${channel.connector}:${channel.id}] ${msg}`, meta ? JSON.stringify(meta) : ""),
  };

  return { connector, ctx, channel };
}

/**
 * Dynamically publishes or updates a canonical product to a specific sales channel.
 */
export async function syncProductToChannel(
  repo: Repo,
  channelId: string,
  product: CanonicalProduct,
  options: { store?: any; forceCreate?: boolean } = {},
): Promise<{ success: boolean; remoteId?: string; jobId?: string; error?: string }> {
  const chInfo = await buildChannelContext(repo, channelId, options.store);
  if (!chInfo) {
    return { success: false, error: `Channel #${channelId} not configured or found.` };
  }

  const { connector, ctx } = chInfo;
  const existingMapping = options.forceCreate ? null : repo.getMapping(product.id, channelId);
  const operation = existingMapping?.remote_product_id ? "PRODUCT_UPDATE" : "PRODUCT_CREATE";
  const jobId = "job_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const now = Date.now();
  const started = Date.now();

  try {
    let remoteId = "";
    if (existingMapping?.remote_product_id) {
      // Update existing remote listing
      await connector.updateProduct(ctx, product, existingMapping.remote_product_id);
      remoteId = existingMapping.remote_product_id;
    } else {
      // Create new remote listing
      const remote = await connector.createProduct(ctx, product);
      remoteId = remote.remoteId;
    }

    repo.upsertMapping({
      productId: product.id,
      channelId,
      status: "LIVE",
      remoteProductId: remoteId,
      synced: true,
      lastError: "",
    });

    // Record completed sync_job and attempt for full activity & job inspector support
    const durationMs = Date.now() - started;
    repo.db.run(
      `INSERT OR REPLACE INTO sync_jobs
         (id, organization_id, store_id, channel_id, operation, entity_type,
          entity_id, idempotency_key, payload, status, attempt_count,
          max_attempts, next_attempt_at, created_at, started_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,'{}','SUCCEEDED',1,5,0,?,?,?)`,
      [
        jobId,
        product.orgId || ctx.seller.storeName || "",
        chInfo.channel.store_id,
        channelId,
        operation,
        "product",
        product.id,
        `import:${channelId}:${product.id}:${now}`,
        now,
        started,
        now + durationMs,
      ],
    );

    repo.db.run(
      `INSERT INTO sync_attempts
         (id, job_id, attempt, status, duration_ms, created_at)
       VALUES (?,?,1,'SUCCEEDED',?,?)`,
      ["att_" + Math.random().toString(36).slice(2, 10), jobId, durationMs, now],
    );

    return { success: true, remoteId, jobId };
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    const durationMs = Date.now() - started;

    repo.upsertMapping({
      productId: product.id,
      channelId,
      status: "ERROR",
      lastError: errorMsg,
    });

    repo.db.run(
      `INSERT OR REPLACE INTO sync_jobs
         (id, organization_id, store_id, channel_id, operation, entity_type,
          entity_id, idempotency_key, payload, status, attempt_count,
          max_attempts, next_attempt_at, last_error, created_at, started_at, completed_at)
       VALUES (?,?,?,?,?,?,?,?,'{}','DEAD_LETTER',1,5,0,?,?,?,?)`,
      [
        jobId,
        product.orgId || ctx.seller.storeName || "",
        chInfo.channel.store_id,
        channelId,
        operation,
        "product",
        product.id,
        `import:${channelId}:${product.id}:${now}`,
        errorMsg.slice(0, 1000),
        now,
        started,
        now + durationMs,
      ],
    );

    repo.db.run(
      `INSERT INTO sync_attempts
         (id, job_id, attempt, status, error, duration_ms, created_at)
       VALUES (?,?,1,'FAILED',?,?,?)`,
      ["att_" + Math.random().toString(36).slice(2, 10), jobId, errorMsg.slice(0, 1000), durationMs, now],
    );

    return { success: false, error: errorMsg, jobId };
  }
}

/**
 * Dynamically deletes/unlinks a product from a sales channel.
 */
export async function deleteProductFromChannel(
  repo: Repo,
  channelId: string,
  productId: string,
): Promise<{ success: boolean; error?: string }> {
  const mapping = repo.getMapping(productId, channelId);
  if (!mapping?.remote_product_id) {
    repo.deleteMapping(productId, channelId);
    return { success: true };
  }

  const chInfo = await buildChannelContext(repo, channelId);
  if (!chInfo) {
    repo.deleteMapping(productId, channelId);
    return { success: true };
  }

  const { connector, ctx } = chInfo;

  try {
    if (typeof connector.deleteProduct === "function") {
      await connector.deleteProduct(ctx, mapping.remote_product_id);
    }
    repo.deleteMapping(productId, channelId);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}

/**
 * Dynamically discovers channel configurations & profiles (shipping, shops, return policies)
 * without hardcoded marketplace logic.
 */
export async function discoverChannelResources(
  repo: Repo,
  channelId: string,
  configOverrides: Record<string, any> = {},
): Promise<{ success: boolean; data?: Record<string, any>; error?: string }> {
  const chInfo = await buildChannelContext(repo, channelId);
  if (!chInfo) {
    return { success: false, error: `Channel #${channelId} not found.` };
  }

  const { connector, ctx } = chInfo;
  Object.assign(ctx.config, configOverrides);

  if (typeof connector.discover !== "function") {
    return { success: true, data: {} };
  }

  try {
    const data = await connector.discover(ctx);
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message || String(err) };
  }
}
