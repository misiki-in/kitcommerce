/**
 * Default database driver: SQLite via bun:sqlite (built into the runtime).
 *
 * Zero install, zero config, one file on disk. The Postgres driver implements
 * the same `Db` interface; nothing above this line knows which is running.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Db, Row } from "../ports";

export function sqliteDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });

  // WAL lets the HTTP handlers read while the sync worker writes.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Wait rather than throw SQLITE_BUSY when the worker holds the write lock.
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");

  let depth = 0;

  return {
    all<T = Row>(sql: string, params: any[] = []): T[] {
      return db.query(sql).all(...(params as any)) as T[];
    },
    get<T = Row>(sql: string, params: any[] = []): T | null {
      return (db.query(sql).get(...(params as any)) as T) ?? null;
    },
    run(sql: string, params: any[] = []): void {
      // db.query() caches prepared statements, which breaks for one-shot DDL
      // (the cached statement is finalized after use). db.run() does not cache.
      if (params.length === 0) db.run(sql);
      else db.run(sql, params as any);
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    tx<T>(fn: () => T): T {
      // Nested tx() calls join the outer transaction rather than opening a
      // second one, which SQLite would reject.
      if (depth > 0) return fn();
      depth++;
      try {
        return db.transaction(fn)() as T;
      } finally {
        depth--;
      }
    },
    close() {
      db.close();
    },
  };
}
