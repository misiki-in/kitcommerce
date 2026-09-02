/**
 * Standalone database migration runner.
 * Run via `bun db:migrate` or `bun migrate`.
 */
import { config } from "./lib/server/config";
import { sqliteDb } from "./lib/server/drivers/db.sqlite";
import schema from "./lib/server/db/schema.sql?raw";

console.log(`[db:migrate] Connecting to SQLite database at: ${config.dbPath}`);
const db = sqliteDb(config.dbPath);

try {
  console.log("[db:migrate] Applying schema and migrations...");
  db.exec(schema);
  console.log("[db:migrate] Database schema successfully migrated and up to date! ✅");
} catch (err: any) {
  console.error("[db:migrate] Migration failed ❌:", err.message);
  process.exit(1);
}
