/**
 * The application singleton.
 *
 * SvelteKit imports server modules per-request, so the database connection,
 * job queue and worker are created once here and reused. Every route and
 * script reaches them through this module rather than building its own.
 */
import { config } from "./config";
import { createAuth, createAuthz } from "./auth";
import { fsBlob, noopNotify, outboxEvents, sqlSearch } from "./drivers";
import { sqliteDb } from "./drivers/db.sqlite";
import { sqliteQueue } from "./drivers/queue.sqlite";
import { createRepo } from "./repo";
import { createPlanner, createWorker } from "./sync";

const db = sqliteDb(config.dbPath);

export const bus = outboxEvents(db);
export const queue = sqliteQueue(db);
export const repo = createRepo(db, bus);
export const auth = createAuth(db);
export const authz = createAuthz(db);
export const search = sqlSearch(db);
export const notify = noopNotify();
export const blob = fsBlob(config.uploadsDir);

export const planner = createPlanner(repo, queue);
planner.register(bus);

/**
 * One worker per process. Vite's dev server re-executes modules on HMR, so the
 * guard stops a reload from stacking a second polling loop on the same queue.
 */
const globalRef = globalThis as unknown as { __ocWorker?: ReturnType<typeof createWorker> };
if (!globalRef.__ocWorker && config.worker.enabled) {
  globalRef.__ocWorker = createWorker(repo, queue, bus);
  globalRef.__ocWorker.start();
}
export const worker = globalRef.__ocWorker;

export { config };
