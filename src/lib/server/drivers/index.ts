/**
 * The remaining default drivers. Each is the smallest thing that satisfies its
 * port with zero external infrastructure.
 *
 *   events  -> transactional outbox in the DB + in-process dispatch
 *   search  -> LIKE over the products table
 *   blob    -> local filesystem under ./data/uploads
 *   notify  -> noop (writes to the log; the dashboard is the real inbox)
 *   secrets -> AES-256-GCM with a key generated on first boot
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type {
  Blob,
  Db,
  DomainEvent,
  EventBus,
  Message,
  Notify,
  Search,
  SearchHit,
  Secrets,
} from "../ports";
import { newId } from "../ids";

// ----------------------------------------------------------------- event bus

export function outboxEvents(db: Db): EventBus {
  const subs: Array<{ pattern: string; fn: (e: DomainEvent) => void | Promise<void> }> = [];

  const matches = (pattern: string, name: string) =>
    pattern === "*" || pattern === name || (pattern.endsWith("*") && name.startsWith(pattern.slice(0, -1)));

  return {
    name: "outbox",

    publish(e: DomainEvent) {
      // Caller is expected to be inside db.tx() so the event and the state
      // change commit together. That atomicity is the whole reason the default
      // event bus lives in the database rather than in a broker.
      db.run(
        `INSERT INTO events (id, organization_id, store_id, name, payload, created_at)
         VALUES (?,?,?,?,?,?)`,
        [newId("evt"), e.organizationId, e.storeId, e.name, JSON.stringify(e.payload), Date.now()],
      );
    },

    subscribe(pattern, fn) {
      subs.push({ pattern, fn });
    },

    async drain(limit: number): Promise<number> {
      const rows = db.all<{
        id: string;
        organization_id: string;
        store_id: string;
        name: string;
        payload: string;
      }>(
        "SELECT * FROM events WHERE published_at IS NULL ORDER BY created_at ASC LIMIT ?",
        [limit],
      );

      for (const r of rows) {
        const e: DomainEvent = {
          name: r.name,
          organizationId: r.organization_id,
          storeId: r.store_id,
          payload: JSON.parse(r.payload),
        };
        for (const s of subs) {
          if (!matches(s.pattern, e.name)) continue;
          try {
            await s.fn(e);
          } catch (err) {
            console.error(`[events] handler failed for ${e.name}:`, err);
          }
        }
        db.run("UPDATE events SET published_at = ? WHERE id = ?", [Date.now(), r.id]);
      }
      return rows.length;
    },
  };
}

// -------------------------------------------------------------------- search

export function sqlSearch(db: Db): Search {
  return {
    name: "sql",
    query(storeId: string, q: string, limit: number): SearchHit[] {
      const like = `%${q.toLowerCase()}%`;
      const rows = db.all<{ id: string }>(
        `SELECT id FROM products
          WHERE store_id = ?
            AND (lower(title) LIKE ? OR lower(sku) LIKE ? OR lower(brand) LIKE ?)
          ORDER BY updated_at DESC
          LIMIT ?`,
        [storeId, like, like, like, limit],
      );
      // Ranking is intentionally flat. Callers must not depend on score order,
      // so a Meilisearch driver can supply real relevance later without
      // changing any consumer.
      return rows.map((r) => ({ id: r.id, score: 1 }));
    },
  };
}

// ---------------------------------------------------------------------- blob

export function fsBlob(dir: string, publicPrefix = "/uploads"): Blob {
  mkdirSync(dir, { recursive: true });
  return {
    name: "fs",
    async put(key, data, _contentType) {
      const path = join(dir, key);
      mkdirSync(join(path, ".."), { recursive: true });
      await Bun.write(path, data as any);
      return `${publicPrefix}/${key}`;
    },
    async delete(key) {
      try {
        await Bun.file(join(dir, key)).delete();
      } catch {
        /* already gone */
      }
    },
  };
}

// -------------------------------------------------------------------- notify

export function noopNotify(): Notify {
  return {
    name: "noop",
    async send(m: Message) {
      console.log(`[notify:noop] to=${m.to} subject=${JSON.stringify(m.subject)}`);
    },
  };
}

// ------------------------------------------------------------------- secrets

/**
 * AES-256-GCM. The key is generated on first boot and kept in data/.keyfile so
 * a fresh clone needs no environment variable; set OC_SECRET_KEY (base64, 32
 * bytes) to take over key management in production.
 */
export function localSecrets(key: Uint8Array): Secrets {
  const imported = crypto.subtle.importKey("raw", key as any, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);

  return {
    name: "local-aes-gcm",

    async seal(plain: unknown): Promise<Uint8Array> {
      const k = await imported;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        k,
        new TextEncoder().encode(JSON.stringify(plain)),
      );
      // iv is prepended; it is not secret, only unique per message.
      const out = new Uint8Array(iv.length + ct.byteLength);
      out.set(iv, 0);
      out.set(new Uint8Array(ct), iv.length);
      return out;
    },

    async open<T>(sealed: Uint8Array): Promise<T> {
      const k = await imported;
      const iv = sealed.slice(0, 12);
      const ct = sealed.slice(12);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, k, ct);
      return JSON.parse(new TextDecoder().decode(pt)) as T;
    },
  };
}
