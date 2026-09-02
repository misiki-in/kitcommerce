/**
 * Data access. Plain SQL against the Db port -- no ORM, no query builder.
 *
 * The database is not a port and is not abstracted: SQL lives here in the open
 * so the SQLite -> Postgres move is a readable diff rather than an archaeology
 * project.
 */
import type { CanonicalProduct } from "./connector";
import { contentHash, newId } from "./ids";
import type { Db, EventBus, JobStatus } from "./ports";

/** Job counts keyed by every status, so no lookup can be undefined. */
export type JobStats = Record<JobStatus, number>;

/** One row of the merged activity timeline. */
export interface ActivityEntry {
  kind: "sync" | "change" | "order";
  id: string;
  at: number;
  status: string;
  title: string;
  detail: string;
  error: string;
  connector: string;
  href: string;
  meta: string;
}

// ------------------------------------------------------------------- types

export interface Store {
  id: string;
  organization_id: string;
  name: string;
  platform: string;
  platform_id: string;
  status: string;
  description: string;
  logo_url: string;
  banner_url: string;
  support_email: string;
  support_phone: string;
  website: string;
  legal_name: string;
  business_type: string;
  tax_id: string;
  registration_no: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  currency: string;
}

export interface PickupLocation {
  id: string;
  organization_id: string;
  store_id: string;
  label: string;
  contact_name: string;
  contact_phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  is_default: number;
}

export interface ProductRow {
  id: string;
  organization_id: string;
  store_id: string;
  external_id: string;
  source: string;
  sku: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  status: string;
  attributes: string;
  tax_rate_bp: number;
  hsn_code: string;
  weight_g: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
  content_hash: string;
  version: number;
  updated_at: number;
}

export interface VariantRow {
  id: string;
  product_id: string;
  external_id: string;
  sku: string;
  barcode: string;
  options: string;
  price_cents: number;
  mrp_cents: number;
  currency: string;
  available: number;
  reserved: number;
  weight_g: number;
  position: number;
}

export interface ImageRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  url: string;
  alt: string;
  position: number;
}

export interface ChannelRow {
  id: string;
  organization_id: string;
  store_id: string;
  connector: string;
  name: string;
  status: string;
  mode: string;
  config: string;
  last_health_at: number | null;
  last_error: string;
}

export interface ImportRow {
  id: string;
  organization_id: string;
  store_id: string;
  filename: string;
  csv_text: string;
  row_count: number;
  status: string;
  results: string;
  created_at: number;
  updated_at: number;
}
export type ImportSheetRow = ImportRow;

// -------------------------------------------------------------------- repo

export function createRepo(db: Db, bus: EventBus) {
  const now = () => Date.now();

  const repo = {
    db,
    bus,

    // ------------------------------------------------------------- stores

    getStore(id: string): Store | null {
      return db.get<Store>("SELECT * FROM stores WHERE id = ?", [id]);
    },

    storesForOrg(orgId: string): Store[] {
      return db.all<Store>(
        "SELECT * FROM stores WHERE organization_id = ? ORDER BY created_at ASC",
        [orgId],
      );
    },

    createStore(orgId: string, name: string): Store {
      const id = newId("str");
      db.run(
        `INSERT INTO stores (id, organization_id, name, created_at, updated_at)
         VALUES (?,?,?,?,?)`,
        [id, orgId, name, now(), now()],
      );
      return repo.getStore(id)!;
    },

    updateStore(id: string, fields: Record<string, string>): void {
      const allowed = [
        "platform", "platform_id",
        "name", "description", "logo_url", "banner_url", "support_email",
        "support_phone", "website", "legal_name", "business_type", "tax_id",
        "registration_no", "address_line1", "address_line2", "city", "state",
        "postal_code", "country", "currency",
      ];
      const keys = Object.keys(fields).filter((k) => allowed.includes(k));
      if (keys.length === 0) return;
      const sets = keys.map((k) => `${k} = ?`).join(", ");
      db.run(`UPDATE stores SET ${sets}, updated_at = ? WHERE id = ?`, [
        ...keys.map((k) => fields[k] ?? ""),
        now(),
        id,
      ]);
    },

    // -------------------------------------------------- pickup locations

    pickupLocations(storeId: string): PickupLocation[] {
      return db.all<PickupLocation>(
        "SELECT * FROM pickup_locations WHERE store_id = ? ORDER BY is_default DESC, created_at ASC",
        [storeId],
      );
    },

    getPickupLocation(id: string): PickupLocation | null {
      return db.get<PickupLocation>("SELECT * FROM pickup_locations WHERE id = ?", [id]);
    },

    savePickupLocation(input: {
      id?: string;
      orgId: string;
      storeId: string;
      label: string;
      contactName: string;
      contactPhone: string;
      line1: string;
      line2: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
      isDefault: boolean;
    }): string {
      const id = input.id ?? newId("pck");
      db.tx(() => {
        // Exactly one default, enforced here rather than by a partial index so
        // the rule reads the same on SQLite and Postgres.
        if (input.isDefault) {
          db.run("UPDATE pickup_locations SET is_default = 0 WHERE store_id = ?", [input.storeId]);
        }
        const existing = input.id ? repo.getPickupLocation(input.id) : null;
        if (existing) {
          db.run(
            `UPDATE pickup_locations SET
               label=?, contact_name=?, contact_phone=?, address_line1=?, address_line2=?,
               city=?, state=?, postal_code=?, country=?, is_default=?, updated_at=?
             WHERE id=?`,
            [
              input.label, input.contactName, input.contactPhone, input.line1, input.line2,
              input.city, input.state, input.postalCode, input.country,
              input.isDefault ? 1 : 0, now(), id,
            ],
          );
        } else {
          const first = repo.pickupLocations(input.storeId).length === 0;
          db.run(
            `INSERT INTO pickup_locations
               (id, organization_id, store_id, label, contact_name, contact_phone,
                address_line1, address_line2, city, state, postal_code, country,
                is_default, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              id, input.orgId, input.storeId, input.label, input.contactName,
              input.contactPhone, input.line1, input.line2, input.city, input.state,
              input.postalCode, input.country,
              input.isDefault || first ? 1 : 0, now(), now(),
            ],
          );
        }
      });
      return id;
    },

    deletePickupLocation(id: string): void {
      db.run("DELETE FROM pickup_locations WHERE id = ?", [id]);
    },

    // ----------------------------------------------------------- products

    listProducts(storeId: string, limit = 200): ProductRow[] {
      return db.all<ProductRow>(
        "SELECT * FROM products WHERE store_id = ? ORDER BY updated_at DESC LIMIT ?",
        [storeId, limit],
      );
    },

    getProduct(id: string): ProductRow | null {
      return db.get<ProductRow>("SELECT * FROM products WHERE id = ?", [id]);
    },

    /** Hard-delete a product. Variants, images and mappings cascade automatically. */
    deleteProduct(id: string): void {
      db.run("DELETE FROM products WHERE id = ?", [id]);
    },

    /** Delete a single channel mapping for a product. */
    deleteMapping(productId: string, channelId: string): void {
      db.run("DELETE FROM product_mappings WHERE product_id = ? AND channel_id = ?", [productId, channelId]);
    },

    getProductBySku(storeId: string, sku: string): ProductRow | null {
      return db.get<ProductRow>("SELECT * FROM products WHERE store_id = ? AND sku = ?", [
        storeId,
        sku,
      ]);
    },

    variants(productId: string): VariantRow[] {
      return db.all<VariantRow>(
        "SELECT * FROM product_variants WHERE product_id = ? ORDER BY position ASC",
        [productId],
      );
    },

    images(productId: string): ImageRow[] {
      return db.all<ImageRow>(
        "SELECT * FROM product_images WHERE product_id = ? ORDER BY position ASC",
        [productId],
      );
    },

    /** Assemble the canonical product a connector receives. */
    canonical(productId: string): CanonicalProduct | null {
      const p = repo.getProduct(productId);
      if (!p) return null;
      return {
        id: p.id,
        sku: p.sku,
        title: p.title,
        description: p.description,
        brand: p.brand,
        category: p.category,
        attributes: JSON.parse(p.attributes || "{}"),
        images: repo.images(p.id).map((i) => ({ url: i.url, alt: i.alt, position: i.position })),
        variants: repo.variants(p.id).map((v) => ({
          id: v.id,
          sku: v.sku,
          barcode: v.barcode,
          options: JSON.parse(v.options || "{}"),
          priceCents: v.price_cents,
          mrpCents: v.mrp_cents,
          currency: v.currency,
          available: v.available,
          weightG: v.weight_g,
        })),
        taxRateBp: p.tax_rate_bp,
        hsnCode: p.hsn_code,
        weightG: p.weight_g,
        lengthMm: p.length_mm,
        widthMm: p.width_mm,
        heightMm: p.height_mm,
        version: p.version,
      };
    },

    /**
     * Upsert a product with its variants and images, and emit the right event.
     * Everything happens in one transaction with the outbox row, so a crash can
     * never leave a product saved but its sync unqueued.
     */
    async saveProduct(input: {
      orgId: string;
      storeId: string;
      id?: string;
      externalId?: string;
      source?: string;
      sku: string;
      title: string;
      description?: string;
      brand?: string;
      category?: string;
      status?: string;
      attributes?: Record<string, unknown>;
      taxRateBp?: number;
      hsnCode?: string;
      weightG?: number;
      lengthMm?: number;
      widthMm?: number;
      heightMm?: number;
      /** Omit to leave the stored variants untouched (wizard step saves). */
      variants?: Array<{
        sku: string;
        barcode?: string;
        options?: Record<string, string>;
        priceCents: number;
        mrpCents?: number;
        currency?: string;
        available?: number;
        weightG?: number;
      }>;
      /** Omit to leave the stored images untouched. */
      images?: Array<{ url: string; alt?: string }>;
      /** Set to false for batch imports to avoid individual event fan-out. Default: true. */
      emitEvents?: boolean;
    }): Promise<{ id: string; created: boolean; changed: boolean }> {
      const existing = input.id
        ? repo.getProduct(input.id)
        : repo.getProductBySku(input.storeId, input.sku);

      // A step that does not submit variants/images must not delete them, so
      // fall back to what is already stored rather than to an empty list.
      const variants =
        input.variants ??
        (existing
          ? repo.variants(existing.id).map((v) => ({
              sku: v.sku,
              barcode: v.barcode,
              options: JSON.parse(v.options || "{}"),
              priceCents: v.price_cents,
              mrpCents: v.mrp_cents,
              currency: v.currency,
              available: v.available,
              weightG: v.weight_g,
            }))
          : []);
      const images =
        input.images ??
        (existing ? repo.images(existing.id).map((i) => ({ url: i.url, alt: i.alt })) : []);

      // Hash covers only what a marketplace would care about, so cosmetic
      // no-op saves do not fan out jobs to every channel (spec 11).
      const hash = await contentHash({
        sku: input.sku,
        title: input.title,
        description: input.description ?? "",
        brand: input.brand ?? "",
        category: input.category ?? "",
        attributes: input.attributes ?? {},
        images: images.map((i) => i.url),
        variants: variants.map((v) => ({
          sku: v.sku,
          options: v.options ?? {},
          price: v.priceCents,
          mrp: v.mrpCents ?? 0,
          available: v.available ?? 0,
        })),
        weightG: input.weightG ?? 0,
        hsnCode: input.hsnCode ?? "",
      });

      const priceChanged =
        existing != null &&
        repo.variants(existing.id).some((v) => {
          const match = variants.find((n) => n.sku === v.sku);
          return match != null && match.priceCents !== v.price_cents;
        });
      const stockChanged =
        existing != null &&
        repo.variants(existing.id).some((v) => {
          const match = variants.find((n) => n.sku === v.sku);
          return match != null && (match.available ?? 0) !== v.available;
        });

      if (existing && existing.content_hash === hash) {
        return { id: existing.id, created: false, changed: false };
      }

      const id = existing?.id ?? newId("prd");
      const version = (existing?.version ?? 0) + 1;

      db.tx(() => {
        if (existing) {
          db.run(
            `UPDATE products SET
               sku=?, title=?, description=?, brand=?, category=?, status=?,
               attributes=?, tax_rate_bp=?, hsn_code=?, weight_g=?, length_mm=?,
               width_mm=?, height_mm=?, content_hash=?, version=?, updated_at=?
             WHERE id=?`,
            [
              input.sku, input.title, input.description ?? "", input.brand ?? "",
              input.category ?? "", input.status ?? existing.status,
              JSON.stringify(input.attributes ?? {}), input.taxRateBp ?? 0,
              input.hsnCode ?? "", input.weightG ?? 0, input.lengthMm ?? 0,
              input.widthMm ?? 0, input.heightMm ?? 0, hash, version, now(), id,
            ],
          );
        } else {
          db.run(
            `INSERT INTO products
               (id, organization_id, store_id, external_id, source, sku, title,
                description, brand, category, status, attributes, tax_rate_bp,
                hsn_code, weight_g, length_mm, width_mm, height_mm,
                content_hash, version, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              id, input.orgId, input.storeId, input.externalId ?? "",
              input.source ?? "native", input.sku, input.title,
              input.description ?? "", input.brand ?? "", input.category ?? "",
              input.status ?? "DRAFT", JSON.stringify(input.attributes ?? {}),
              input.taxRateBp ?? 0, input.hsnCode ?? "", input.weightG ?? 0,
              input.lengthMm ?? 0, input.widthMm ?? 0, input.heightMm ?? 0,
              hash, version, now(), now(),
            ],
          );
        }

        // Variants and images are replaced wholesale -- simpler than diffing,
        // and the content hash already told us something actually changed.
        db.run("DELETE FROM product_images WHERE product_id = ?", [id]);
        db.run("DELETE FROM product_variants WHERE product_id = ?", [id]);

        variants.forEach((v, i) => {
          db.run(
            `INSERT INTO product_variants
               (id, product_id, sku, barcode, options, price_cents, mrp_cents,
                currency, available, weight_g, position, created_at, updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              newId("var"), id, v.sku, v.barcode ?? "",
              JSON.stringify(v.options ?? {}), v.priceCents,
              v.mrpCents ?? v.priceCents, v.currency ?? "INR",
              v.available ?? 0, v.weightG ?? 0, i, now(), now(),
            ],
          );
        });

        images.forEach((img, i) => {
          db.run(
            `INSERT INTO product_images (id, product_id, url, alt, position, created_at)
             VALUES (?,?,?,?,?,?)`,
            [newId("img"), id, img.url, img.alt ?? "", i, now()],
          );
        });

        const shouldEmit = input.emitEvents ?? true;
        if (shouldEmit) {
          const payload = { productId: id, sku: input.sku, version };
          if (!existing) {
            bus.publish({ name: "product.created.v1", organizationId: input.orgId, storeId: input.storeId, payload });
          } else {
            bus.publish({ name: "product.updated.v1", organizationId: input.orgId, storeId: input.storeId, payload });
            if (priceChanged) {
              bus.publish({ name: "price.changed.v1", organizationId: input.orgId, storeId: input.storeId, payload });
            }
            if (stockChanged) {
              bus.publish({ name: "inventory.changed.v1", organizationId: input.orgId, storeId: input.storeId, payload });
            }
          }
        }
      });

      return { id, created: !existing, changed: true };
    },

    deleteProduct(id: string): void {
      db.run("DELETE FROM products WHERE id = ?", [id]);
    },

    // ----------------------------------------------------------- channels

    listChannels(storeId: string): ChannelRow[] {
      return db.all<ChannelRow>(
        "SELECT * FROM channels WHERE store_id = ? ORDER BY created_at ASC",
        [storeId],
      );
    },

    getChannel(id: string): ChannelRow | null {
      return db.get<ChannelRow>("SELECT * FROM channels WHERE id = ?", [id]);
    },

    createChannel(input: {
      orgId: string;
      storeId: string;
      connector: string;
      name: string;
      mode: string;
      config: Record<string, unknown>;
    }): ChannelRow {
      const id = newId("chn");
      db.run(
        `INSERT INTO channels
           (id, organization_id, store_id, connector, name, mode, config, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          id, input.orgId, input.storeId, input.connector, input.name,
          input.mode, JSON.stringify(input.config), now(), now(),
        ],
      );
      db.run(
        `INSERT INTO audit_logs (id, organization_id, store_id, action, entity_type, entity_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
        [newId("aud"), input.orgId, input.storeId, "ChannelConnected", "channel", id, now()],
      );
      return repo.getChannel(id)!;
    },

    setChannelHealth(id: string, status: string, error = ""): void {
      db.run(
        "UPDATE channels SET status=?, last_error=?, last_health_at=?, updated_at=? WHERE id=?",
        [status, error, now(), now(), id],
      );
    },

    updateChannel(id: string, input: { name?: string; config?: Record<string, unknown> }): void {
      if (input.name && input.config) {
        db.run("UPDATE channels SET name = ?, config = ?, updated_at = ? WHERE id = ?", [
          input.name,
          JSON.stringify(input.config),
          now(),
          id,
        ]);
      } else if (input.name) {
        db.run("UPDATE channels SET name = ?, updated_at = ? WHERE id = ?", [input.name, now(), id]);
      } else if (input.config) {
        db.run("UPDATE channels SET config = ?, updated_at = ? WHERE id = ?", [
          JSON.stringify(input.config),
          now(),
          id,
        ]);
      }
    },

    deleteChannel(id: string): void {
      db.run("DELETE FROM channels WHERE id = ?", [id]);
    },

    // ----------------------------------------------------------- mappings

    getMapping(productId: string, channelId: string) {
      return db.get<{
        id: string;
        product_id: string;
        channel_id: string;
        remote_product_id: string;
        status: string;
        mapping_data: string;
        missing_fields: string;
        version: number;
        last_synced_at: number | null;
        last_error: string;
      }>("SELECT * FROM product_mappings WHERE product_id = ? AND channel_id = ?", [
        productId,
        channelId,
      ]);
    },

    mappingsForProduct(productId: string) {
      return db.all<any>(
        `SELECT m.*, c.name AS channel_name, c.connector
           FROM product_mappings m
           JOIN channels c ON c.id = m.channel_id
          WHERE m.product_id = ?`,
        [productId],
      );
    },

    mappingsForChannel(channelId: string) {
      return db.all<any>(
        `SELECT m.*, p.title, p.sku
           FROM product_mappings m
           JOIN products p ON p.id = m.product_id
          WHERE m.channel_id = ?
          ORDER BY m.updated_at DESC`,
        [channelId],
      );
    },

    upsertMapping(input: {
      productId: string;
      channelId: string;
      status?: string;
      remoteProductId?: string;
      missingFields?: unknown[];
      mappingData?: Record<string, unknown>;
      lastError?: string;
      version?: number;
      synced?: boolean;
    }) {
      const existing = repo.getMapping(input.productId, input.channelId);
      if (!existing) {
        db.run(
          `INSERT INTO product_mappings
             (id, product_id, channel_id, remote_product_id, status, mapping_data,
              missing_fields, version, last_synced_at, last_error, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            newId("map"), input.productId, input.channelId,
            input.remoteProductId ?? "", input.status ?? "PENDING",
            JSON.stringify(input.mappingData ?? {}),
            JSON.stringify(input.missingFields ?? []), input.version ?? 0,
            input.synced ? now() : null, input.lastError ?? "", now(), now(),
          ],
        );
        return;
      }
      db.run(
        `UPDATE product_mappings SET
           remote_product_id = COALESCE(NULLIF(?,''), remote_product_id),
           status = COALESCE(?, status),
           mapping_data = COALESCE(?, mapping_data),
           missing_fields = COALESCE(?, missing_fields),
           version = COALESCE(?, version),
           last_synced_at = CASE WHEN ? THEN ? ELSE last_synced_at END,
           last_error = ?,
           updated_at = ?
         WHERE id = ?`,
        [
          input.remoteProductId ?? "",
          input.status ?? null,
          input.mappingData ? JSON.stringify(input.mappingData) : null,
          input.missingFields ? JSON.stringify(input.missingFields) : null,
          input.version ?? null,
          input.synced ? 1 : 0,
          now(),
          input.lastError ?? "",
          now(),
          existing.id,
        ],
      );
    },

    // --------------------------------------------------------------- jobs

    listJobs(storeId: string, limit = 100) {
      return db.all<any>(
        `SELECT j.*, c.name AS channel_name, c.connector
           FROM sync_jobs j
           LEFT JOIN channels c ON c.id = j.channel_id
          WHERE j.store_id = ?
          ORDER BY j.created_at DESC
          LIMIT ?`,
        [storeId, limit],
      );
    },

    getJob(id: string) {
      return db.get<any>("SELECT * FROM sync_jobs WHERE id = ?", [id]);
    },

    getBatchJobs(storeId: string, channelId: string, operation: string, createdAt: number, windowMs = 60000) {
      return db.all<any>(
        `SELECT j.*, p.title as product_title, p.sku as product_sku
           FROM sync_jobs j
           LEFT JOIN products p ON p.id = j.entity_id
          WHERE j.store_id = ?
            AND j.channel_id = ?
            AND j.operation = ?
            AND j.created_at BETWEEN ? AND ?
          ORDER BY j.created_at ASC`,
        [storeId, channelId, operation, createdAt - windowMs, createdAt + windowMs],
      );
    },

    jobAttempts(jobId: string) {
      return db.all<any>(
        "SELECT * FROM sync_attempts WHERE job_id = ? ORDER BY attempt ASC",
        [jobId],
      );
    },

    /**
     * Counts per status. The return type names every status explicitly so
     * callers get `number` rather than `number | undefined`, and so a new
     * JobStatus fails to compile here instead of silently reading as zero.
     */
    jobStats(storeId: string): JobStats {
      const rows = db.all<{ status: string; n: number }>(
        "SELECT status, COUNT(*) AS n FROM sync_jobs WHERE store_id = ? GROUP BY status",
        [storeId],
      );
      const out: JobStats = {
        PENDING: 0, RUNNING: 0, SUCCEEDED: 0, FAILED: 0, RETRYING: 0, DEAD_LETTER: 0,
      };
      for (const r of rows) {
        if (r.status in out) out[r.status as JobStatus] = r.n;
      }
      return out;
    },

    /**
     * One merged timeline: sync jobs, audit entries and order imports.
     *
     * Three tables rather than one events table on purpose -- each has its own
     * shape and lifecycle -- so the merge happens here at read time. At
     * dashboard sizes that is a few hundred rows; if it ever is not, this is
     * the single place a materialised feed would go.
     */
    activity(storeId: string, limit = 200): ActivityEntry[] {
      const jobs = db.all<any>(
        `SELECT j.*, c.name AS channel_name, c.connector
           FROM sync_jobs j LEFT JOIN channels c ON c.id = j.channel_id
          WHERE j.store_id = ? ORDER BY j.created_at DESC LIMIT ?`,
        [storeId, limit],
      );
      const audits = db.all<any>(
        `SELECT * FROM audit_logs WHERE store_id = ? ORDER BY created_at DESC LIMIT ?`,
        [storeId, limit],
      );
      const orderRows = db.all<any>(
        `SELECT o.*, c.name AS channel_name FROM orders o
           LEFT JOIN channels c ON c.id = o.channel_id
          WHERE o.store_id = ? ORDER BY o.created_at DESC LIMIT ?`,
        [storeId, limit],
      );

      const out: ActivityEntry[] = [];

      // Group closely-timed sync jobs by channel & operation into aggregated entries
      const groupedJobs = new Map<string, any[]>();
      for (const j of jobs) {
        // Group jobs occurring within a 60-second window for the same channel & operation
        const timeBucket = Math.floor(j.created_at / 60000);
        const groupKey = `${j.channel_id || j.connector}_${j.operation}_${timeBucket}`;
        if (!groupedJobs.has(groupKey)) {
          groupedJobs.set(groupKey, []);
        }
        groupedJobs.get(groupKey)!.push(j);
      }

      for (const [_, group] of groupedJobs) {
        const first = group[0];
        const count = group.length;
        const failedCount = group.filter((j) => j.status === "DEAD_LETTER" || j.status === "FAILED").length;
        const retryingCount = group.filter((j) => j.status === "RETRYING").length;
        const succeededCount = group.filter((j) => j.status === "SUCCEEDED").length;

        let status = first.status;
        if (failedCount > 0) {
          status = failedCount === count ? "DEAD_LETTER" : "PARTIAL";
        } else if (retryingCount > 0) {
          status = "RETRYING";
        } else if (succeededCount === count) {
          status = "SUCCEEDED";
        }

        const latest = group.reduce((prev, curr) => (curr.created_at > prev.created_at ? curr : prev), first);
        const connector = first.connector || latest?.connector || (first.channel_name ? first.channel_name.split(" ")[0]?.toLowerCase() : "") || "";
        const channelTitle = first.channel_name || (connector ? connector.charAt(0).toUpperCase() + connector.slice(1) : "Marketplace");
        const opName = first.operation.replace(/_/g, " ").toLowerCase();

        if (count === 1) {
          out.push({
            kind: "sync",
            id: first.id,
            at: first.created_at,
            status: first.status,
            title: `${opName}`,
            detail: `${channelTitle}`,
            error: first.last_error ?? "",
            connector,
            href: `/jobs/${first.id}`,
            meta: `attempt ${first.attempt_count}/${first.max_attempts}`,
          });
        } else {
          // Batched sync for multiple items on this channel
          const hasErrors = group.find((j) => j.last_error);

          out.push({
            kind: "sync",
            id: latest.id,
            at: latest.created_at,
            status,
            title: `${channelTitle} · ${count} products ${opName.replace("product ", "")}ed`,
            detail: `${count} items synced to ${channelTitle}${failedCount > 0 ? ` (${failedCount} failed)` : ""}`,
            error: hasErrors ? hasErrors.last_error : "",
            connector,
            href: `/jobs/${latest.id}?batch=${latest.created_at}`,
            meta: `${count} items`,
          });
        }
      }
      for (const a of audits) {
        let metaObj: any = {};
        try { metaObj = JSON.parse(a.metadata || "{}"); } catch {}

        let detail = a.entity_type ? `${a.entity_type} ${a.entity_id}` : "";
        if (a.action === "SheetImported") {
          detail = metaObj.filename ? `${metaObj.filename} (${metaObj.importedCount} products)` : detail;
        } else if (a.action === "ProductsDeleted" || a.action === "ProductsUnlisted") {
          detail = metaObj.detail || `${metaObj.count || 1} product${(metaObj.count || 1) === 1 ? "" : "s"}`;
        } else if (a.action === "ProductSyncedToMarketplace") {
          detail = metaObj.detail || `${metaObj.channel || metaObj.connector || "Marketplace"}: ${metaObj.count || 1} items`;
        } else if (metaObj.sku) {
          detail = `${metaObj.sku}${metaObj.channel ? ` → ${metaObj.channel}` : ""}`;
        }

        let href = metaObj.href || "";
        if (!href) {
          if (a.entity_type === "product") href = `/dash/products/${a.entity_id}`;
          else if (a.entity_type === "import_sheet") href = `/dash/products/import?id=${a.entity_id}`;
          else if (a.entity_type === "channel") href = `/dash/channels`;
        }

        out.push({
          kind: "change",
          id: a.id,
          at: a.created_at,
          status: metaObj.status || "",
          title: a.action.replace(/([A-Z])/g, " $1").trim(),
          detail,
          error: metaObj.error || "",
          connector: metaObj.connector || "",
          href,
          meta: metaObj.meta || "",
        });
      }
      for (const o of orderRows) {
        out.push({
          kind: "order",
          id: o.id,
          at: o.created_at,
          status: o.status,
          title: `order ${o.external_id}`,
          detail: o.channel_name ?? o.source,
          error: "",
          connector: o.source,
          href: "/dash/orders",
          meta: `${(o.total_cents / 100).toFixed(2)} ${o.currency}`,
        });
      }

      return out.sort((x, y) => y.at - x.at).slice(0, limit);
    },

    // ------------------------------------------------------------- orders

    listOrders(storeId: string, limit = 100) {
      return db.all<any>(
        `SELECT o.*, c.name AS channel_name
           FROM orders o
           LEFT JOIN channels c ON c.id = o.channel_id
          WHERE o.store_id = ?
          ORDER BY o.created_at DESC
          LIMIT ?`,
        [storeId, limit],
      );
    },

    orderItems(orderId: string) {
      return db.all<any>("SELECT * FROM order_items WHERE order_id = ?", [orderId]);
    },

    /** Returns false when the order already existed (dedupe on source+id). */
    saveOrder(input: {
      orgId: string;
      storeId: string;
      channelId: string;
      externalId: string;
      source: string;
      status: string;
      currency: string;
      totalCents: number;
      placedAt: string;
      customer: unknown;
      shippingAddress: unknown;
      items: Array<{
        sku: string; title: string; quantity: number; priceCents: number; remoteItemId: string;
      }>;
    }): boolean {
      const existing = db.get<{ id: string }>(
        "SELECT id FROM orders WHERE source = ? AND external_id = ?",
        [input.source, input.externalId],
      );
      if (existing) return false;

      const id = newId("ord");
      db.tx(() => {
        db.run(
          `INSERT INTO orders
             (id, organization_id, store_id, channel_id, external_id, source, status,
              currency, total_cents, customer, shipping_address, placed_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, input.orgId, input.storeId, input.channelId, input.externalId,
            input.source, input.status, input.currency, input.totalCents,
            JSON.stringify(input.customer), JSON.stringify(input.shippingAddress),
            Date.parse(input.placedAt) || now(), now(),
          ],
        );
        for (const it of input.items) {
          db.run(
            `INSERT INTO order_items
               (id, order_id, sku, title, quantity, price_cents, remote_item_id)
             VALUES (?,?,?,?,?,?,?)`,
            [newId("oit"), id, it.sku, it.title, it.quantity, it.priceCents, it.remoteItemId],
          );
        }
        bus.publish({
          name: "order.imported.v1",
          organizationId: input.orgId,
          storeId: input.storeId,
          payload: { orderId: id, source: input.source, externalId: input.externalId },
        });
      });
      return true;
    },

    // ------------------------------------------------------------- imports

    createImport(input: {
      orgId: string;
      storeId: string;
      filename: string;
      csvText: string;
      rowCount?: number;
    }): ImportRow {
      const id = newId("imp");
      db.run(
        `INSERT INTO imports
           (id, organization_id, store_id, filename, csv_text, row_count, status, results, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [id, input.orgId, input.storeId, input.filename, input.csvText, input.rowCount ?? 0, "UPLOADED", "{}", now(), now()],
      );
      return repo.getImport(id)!;
    },

    getImport(id: string): ImportRow | null {
      return db.get<ImportRow>("SELECT * FROM imports WHERE id = ?", [id]);
    },

    updateImport(id: string, fields: Partial<Pick<ImportRow, "status" | "results">>): void {
      const sets: string[] = [];
      const vals: any[] = [];
      if (fields.status !== undefined) {
        sets.push("status = ?");
        vals.push(fields.status);
      }
      if (fields.results !== undefined) {
        sets.push("results = ?");
        vals.push(fields.results);
      }
      if (sets.length === 0) return;
      db.run(`UPDATE imports SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, [...vals, now(), id]);
    },

    // Aliases for compatibility
    createImportSheet(input: any) {
      return repo.createImport(input);
    },
    getImportSheet(id: string) {
      return repo.getImport(id);
    },
    updateImportSheet(id: string, fields: any) {
      return repo.updateImport(id, fields);
    },

    // -------------------------------------------------------------- audit

    audit(input: {
      orgId: string; storeId?: string; actorUserId?: string; action: string;
      entityType?: string; entityId?: string; metadata?: unknown;
    }): void {
      db.run(
        `INSERT INTO audit_logs
           (id, organization_id, store_id, actor_user_id, action, entity_type,
            entity_id, metadata, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          newId("aud"), input.orgId, input.storeId ?? "", input.actorUserId ?? "",
          input.action, input.entityType ?? "", input.entityId ?? "",
          JSON.stringify(input.metadata ?? {}), now(),
        ],
      );
    },

    recentAudit(orgId: string, limit = 20) {
      return db.all<any>(
        "SELECT * FROM audit_logs WHERE organization_id = ? ORDER BY created_at DESC LIMIT ?",
        [orgId, limit],
      );
    },
  };

  return repo;
}

export type Repo = ReturnType<typeof createRepo>;
