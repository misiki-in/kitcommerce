/**
 * The sync engine.
 *
 * Two halves:
 *   1. A planner that turns domain events into per-channel jobs.
 *   2. A worker that executes jobs against connectors, with retry, backoff,
 *      error classification and dead-lettering.
 *
 * Nothing here knows any connector's name. Adding a marketplace changes the
 * registry only.
 */
import {
  ConnectorError,
  missingRequiredFields,
  type CanonicalProduct,
  type ConnectorContext,
  type MarketplaceConnector,
} from "./connector";
import { getConnector } from "./connectors";
import { localSecrets } from "./drivers";
import { config } from "./config";
import type { Repo, ChannelRow } from "./repo";
import type { DomainEvent, EventBus, Queue } from "./ports";
import { newId } from "./ids";

const secrets = localSecrets(config.secretKey);

export const OPERATIONS = {
  PRODUCT_CREATE: "PRODUCT_CREATE",
  PRODUCT_UPDATE: "PRODUCT_UPDATE",
  PRICE_UPDATE: "PRICE_UPDATE",
  INVENTORY_UPDATE: "INVENTORY_UPDATE",
  ORDER_IMPORT: "ORDER_IMPORT",
} as const;

/**
 * Idempotency key (spec 22): <channel>:<entity>:<id>:<op>:<version>.
 *
 * The version component is what makes a retry safe and a genuine change
 * distinct: retrying the same logical write reuses the key and collapses into
 * the existing job; editing the product bumps the version and earns a new one.
 */
export function idempotencyKey(
  channelId: string,
  entityType: string,
  entityId: string,
  operation: string,
  version: number,
): string {
  return `${channelId}:${entityType}:${entityId}:${operation}:${version}`;
}

// ------------------------------------------------------------------ planner

export function createPlanner(repo: Repo, queue: Queue) {
  /** Which channels should receive this product, and can they accept it yet? */
  function planProduct(orgId: string, storeId: string, productId: string, operation: string): number {
    const product = repo.canonical(productId);
    if (!product) return 0;

    const channels = repo.listChannels(storeId);
    let queued = 0;

    for (const channel of channels) {
      const connector = getConnector(channel.connector);
      const manifest = connector.manifest();
      const caps = manifest.capabilities;
      const mapping = repo.getMapping(productId, channel.id);
      const isCreate = !mapping?.remote_product_id;

      // Respect declared capabilities -- never call an operation a connector
      // says it does not support (spec 13).
      if (isCreate && !caps.createProduct) continue;
      if (!isCreate && !caps.updateProduct) continue;

      // Validate against the manifest BEFORE queueing. A product missing a
      // required marketplace field becomes a visible INCOMPLETE mapping in the
      // UI rather than a job that fails five times and dead-letters (spec 43).
      const missing = missingRequiredFields(manifest, product);
      if (missing.length > 0) {
        repo.upsertMapping({
          productId,
          channelId: channel.id,
          status: "INCOMPLETE",
          missingFields: missing.map((f) => ({ path: f.path, label: f.label, help: f.help })),
          lastError: `missing required field(s): ${missing.map((f) => f.label).join(", ")}`,
        });
        continue;
      }

      repo.upsertMapping({
        productId,
        channelId: channel.id,
        status: mapping?.remote_product_id ? "MAPPED" : "PENDING",
        missingFields: [],
        lastError: "",
      });

      const op = isCreate ? OPERATIONS.PRODUCT_CREATE : operation;
      const id = queue.enqueue({
        organizationId: orgId,
        storeId,
        channelId: channel.id,
        operation: op,
        entityType: "product",
        entityId: productId,
        idempotencyKey: idempotencyKey(channel.id, "product", productId, op, product.version),
        payload: { sku: product.sku },
      });
      if (id) queued++;
    }
    return queued;
  }

  function planSimple(
    orgId: string,
    storeId: string,
    productId: string,
    operation: "PRICE_UPDATE" | "INVENTORY_UPDATE",
  ): number {
    const product = repo.canonical(productId);
    if (!product) return 0;
    let queued = 0;

    for (const channel of repo.listChannels(storeId)) {
      const caps = getConnector(channel.connector).manifest().capabilities;
      if (operation === "PRICE_UPDATE" && !caps.priceSync) continue;
      if (operation === "INVENTORY_UPDATE" && !caps.inventorySync) continue;

      // Only push to channels where the product actually exists remotely.
      const mapping = repo.getMapping(productId, channel.id);
      if (!mapping?.remote_product_id) continue;

      const id = queue.enqueue({
        organizationId: orgId,
        storeId,
        channelId: channel.id,
        operation,
        entityType: "product",
        entityId: productId,
        idempotencyKey: idempotencyKey(
          channel.id, "product", productId, operation, product.version,
        ),
        payload: { sku: product.sku },
      });
      if (id) queued++;
    }
    return queued;
  }

  /** Wire the planner to the event bus. This is the whole fan-out policy. */
  function register(bus: EventBus): void {
    bus.subscribe("product.created.v1", (e: DomainEvent) => {
      planProduct(e.organizationId, e.storeId, String(e.payload.productId), OPERATIONS.PRODUCT_CREATE);
    });
    bus.subscribe("product.updated.v1", (e: DomainEvent) => {
      planProduct(e.organizationId, e.storeId, String(e.payload.productId), OPERATIONS.PRODUCT_UPDATE);
    });
    bus.subscribe("price.changed.v1", (e: DomainEvent) => {
      planSimple(e.organizationId, e.storeId, String(e.payload.productId), "PRICE_UPDATE");
    });
    bus.subscribe("inventory.changed.v1", (e: DomainEvent) => {
      planSimple(e.organizationId, e.storeId, String(e.payload.productId), "INVENTORY_UPDATE");
    });
  }

  return { planProduct, planSimple, register };
}

// ------------------------------------------------------------------- worker

async function buildContext(repo: Repo, channel: ChannelRow): Promise<ConnectorContext> {
  const store = repo.getStore(channel.store_id)!;

  let credentials: Record<string, string> = {};
  const row = repo.db.get<{ ciphertext: Uint8Array }>(
    "SELECT ciphertext FROM credentials WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
    [channel.id],
  );
  if (row?.ciphertext) {
    try {
      credentials = await secrets.open<Record<string, string>>(new Uint8Array(row.ciphertext));
    } catch {
      throw new ConnectorError("stored credentials could not be decrypted", "AUTHENTICATION");
    }
  }

  return {
    mode: channel.mode === "live" ? "live" : "mock",
    config: JSON.parse(channel.config || "{}"),
    credentials,
    seller: {
      storeName: store.name,
      description: store.description,
      logoUrl: store.logo_url,
      legalName: store.legal_name,
      businessType: store.business_type,
      taxId: store.tax_id,
      registrationNo: store.registration_no,
      supportEmail: store.support_email,
      supportPhone: store.support_phone,
      website: store.website,
      address: {
        line1: store.address_line1,
        line2: store.address_line2,
        city: store.city,
        state: store.state,
        postalCode: store.postal_code,
        country: store.country,
      },
      currency: store.currency,
    },
    // Credentials are never passed to the logger.
    log: (msg, meta) =>
      console.log(`[${channel.connector}:${channel.id}] ${msg}`, meta ? JSON.stringify(meta) : ""),
  };
}

async function execute(
  repo: Repo,
  connector: MarketplaceConnector,
  ctx: ConnectorContext,
  channel: ChannelRow,
  job: { operation: string; entity_id: string; organization_id: string; store_id: string },
): Promise<void> {
  const product: CanonicalProduct | null = repo.canonical(job.entity_id);
  if (!product) throw new ConnectorError(`product ${job.entity_id} no longer exists`, "NOT_FOUND");

  const mapping = repo.getMapping(product.id, channel.id);
  const variant = product.variants[0];

  switch (job.operation) {
    case OPERATIONS.PRODUCT_CREATE: {
      const remote = await connector.createProduct(ctx, product);
      repo.upsertMapping({
        productId: product.id,
        channelId: channel.id,
        remoteProductId: remote.remoteId,
        status: "LIVE",
        version: product.version,
        mappingData: remote.url ? { url: remote.url } : {},
        synced: true,
        lastError: "",
      });
      return;
    }

    case OPERATIONS.PRODUCT_UPDATE: {
      const remoteId = mapping?.remote_product_id;
      if (!remoteId) throw new ConnectorError("no remote mapping to update", "NOT_FOUND");
      await connector.updateProduct(ctx, product, remoteId);
      repo.upsertMapping({
        productId: product.id,
        channelId: channel.id,
        status: "LIVE",
        version: product.version,
        synced: true,
        lastError: "",
      });
      return;
    }

    case OPERATIONS.PRICE_UPDATE: {
      const remoteId = mapping?.remote_product_id;
      if (!remoteId) throw new ConnectorError("no remote mapping to price", "NOT_FOUND");
      if (!variant) throw new ConnectorError("product has no variant to price", "VALIDATION");
      await connector.updatePrice(ctx, {
        sku: variant.sku,
        remoteId,
        priceCents: applyPriceRule(ctx, variant.priceCents),
        mrpCents: variant.mrpCents,
        currency: variant.currency,
      });
      repo.upsertMapping({
        productId: product.id, channelId: channel.id, synced: true, lastError: "",
      });
      return;
    }

    case OPERATIONS.INVENTORY_UPDATE: {
      const remoteId = mapping?.remote_product_id;
      if (!remoteId) throw new ConnectorError("no remote mapping for inventory", "NOT_FOUND");
      if (!variant) throw new ConnectorError("product has no variant", "VALIDATION");
      await connector.updateInventory(ctx, {
        sku: variant.sku,
        remoteId,
        available: variant.available,
      });
      repo.upsertMapping({
        productId: product.id, channelId: channel.id, synced: true, lastError: "",
      });
      return;
    }

    default:
      throw new ConnectorError(`unknown operation ${job.operation}`, "VALIDATION");
  }
}

/**
 * Channel price rules are transformations at publish time; the canonical price
 * is never modified (spec 26). `{ "priceRule": { "type": "percent", "value": 5 } }`
 */
function applyPriceRule(ctx: ConnectorContext, cents: number): number {
  const rule = ctx.config.priceRule;
  if (!rule) return cents;
  if (rule.type === "percent") return Math.round(cents * (1 + Number(rule.value) / 100));
  if (rule.type === "flat") return cents + Math.round(Number(rule.value) * 100);
  return cents;
}

export function createWorker(repo: Repo, queue: Queue, bus: EventBus) {
  const workerId = newId("wrk");
  let running = false;
  let timer: Timer | null = null;

  async function tick(): Promise<void> {
    // Publish outbox events first: they are what create the jobs below.
    await bus.drain(100);

    queue.reapStale(config.worker.staleAfterMs);

    const jobs = queue.claim(workerId, config.worker.concurrency);
    if (jobs.length === 0) return;

    await Promise.all(
      jobs.map(async (job) => {
        const started = Date.now();
        try {
          const channel = repo.getChannel(job.channel_id);
          if (!channel) throw new ConnectorError("channel was deleted", "NOT_FOUND");

          const connector = getConnector(channel.connector);
          const ctx = await buildContext(repo, channel);
          await execute(repo, connector, ctx, channel, job);

          queue.succeed(job.id, Date.now() - started);
          repo.setChannelHealth(channel.id, "HEALTHY");
        } catch (e) {
          const err =
            e instanceof ConnectorError
              ? e
              : new ConnectorError(String((e as Error)?.message ?? e), "UNKNOWN");

          queue.fail(
            job.id,
            {
              message: err.message,
              class: err.class,
              retryable: err.retryable,
              retryAfterMs: err.retryAfterMs,
            },
            Date.now() - started,
          );

          repo.upsertMapping({
            productId: job.entity_id,
            channelId: job.channel_id,
            status: err.class === "VALIDATION" ? "INCOMPLETE" : "ERROR",
            lastError: err.message,
          });

          // An auth failure is a channel-level problem, not a job-level one:
          // surface it so the merchant reconnects instead of watching every
          // job fail (spec 43).
          if (err.class === "AUTHENTICATION" && job.channel_id) {
            repo.setChannelHealth(job.channel_id, "AUTH_FAILURE", err.message);
          } else if (err.class === "RATE_LIMITED" && job.channel_id) {
            repo.setChannelHealth(job.channel_id, "RATE_LIMITED", err.message);
          }
        }
      }),
    );
  }

  return {
    workerId,
    tick,
    start() {
      if (running) return;
      running = true;
      const loop = async () => {
        if (!running) return;
        try {
          await tick();
        } catch (e) {
          console.error("[worker] tick failed:", e);
        }
        timer = setTimeout(loop, config.worker.pollMs);
      };
      loop();
      console.log(`[worker] started (${workerId}, concurrency ${config.worker.concurrency})`);
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
    },
  };
}

/** Pull orders from every channel that supports order import (spec 24). */
export async function importOrders(repo: Repo, storeId: string, sinceMs: number): Promise<number> {
  const store = repo.getStore(storeId);
  if (!store) return 0;
  let imported = 0;

  for (const channel of repo.listChannels(storeId)) {
    const connector = getConnector(channel.connector);
    if (!connector.manifest().capabilities.orderImport) continue;

    try {
      const ctx = await buildContext(repo, channel);
      // Give the mock simulator real SKUs so imported orders reference the
      // merchant's actual catalogue.
      const skus = repo.listProducts(storeId, 5).map((p) => p.sku);
      ctx.config = { ...ctx.config, mockOrderSkus: skus };

      const orders = await connector.listOrders(ctx, new Date(sinceMs));
      for (const o of orders) {
        const created = repo.saveOrder({
          orgId: store.organization_id,
          storeId,
          channelId: channel.id,
          externalId: o.externalId,
          source: channel.connector,
          status: o.status,
          currency: o.currency,
          totalCents: o.totalCents,
          placedAt: o.placedAt,
          customer: o.customer,
          shippingAddress: o.shippingAddress,
          items: o.items,
        });
        if (created) imported++;
      }
      repo.setChannelHealth(channel.id, "HEALTHY");
    } catch (e) {
      const err = e as ConnectorError;
      repo.setChannelHealth(
        channel.id,
        err.class === "AUTHENTICATION" ? "AUTH_FAILURE" : "API_FAILURE",
        err.message ?? String(e),
      );
    }
  }
  return imported;
}
