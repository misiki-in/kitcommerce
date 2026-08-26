/**
 * Where does a sync job actually spend its time?
 *
 *   bun src/bench.ts
 *
 * Measures the parts of the pipeline WE control, with the marketplace call
 * removed (mock latency 0). Whatever this reports is the ceiling on what a
 * faster language could win back.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "./lib/server/config";
import { outboxEvents } from "./lib/server/drivers";
import { sqliteDb } from "./lib/server/drivers/db.sqlite";
import { sqliteQueue } from "./lib/server/drivers/queue.sqlite";
import { createRepo } from "./lib/server/repo";
import { createPlanner } from "./lib/server/sync";
import { getConnector } from "./lib/server/connectors";
import { COMPLETE_ATTRIBUTES } from "./lib/server/fixtures";
import { missingRequiredFields } from "./lib/server/connector";
import { newId } from "./lib/server/ids";
import type { ConnectorContext } from "./lib/server/connector";

const dir = join(config.dataDir, "bench");
try {
  rmSync(dir, { recursive: true });
} catch {}
const db = sqliteDb(join(dir, "bench.db"));
db.exec(await Bun.file(new URL("./lib/server/db/schema.sql", import.meta.url)).text());

const bus = outboxEvents(db);
const queue = sqliteQueue(db);
const repo = createRepo(db, bus);
const planner = createPlanner(repo, queue);
planner.register(bus);

const ORG = newId("org");
const N = 2000;

function time(label: string, iterations: number, fn: () => unknown | Promise<unknown>) {
  return async () => {
    const start = Bun.nanoseconds();
    for (let i = 0; i < iterations; i++) await fn();
    const totalNs = Bun.nanoseconds() - start;
    const perOpUs = totalNs / iterations / 1000;
    results.push({ label, perOpUs, opsPerSec: 1_000_000 / perOpUs });
  };
}

const results: Array<{ label: string; perOpUs: number; opsPerSec: number }> = [];

// ---------------------------------------------------------------- fixtures

db.run("INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)", [
  "usr_bench", "bench@local", "x", Date.now(),
]);
db.run("INSERT INTO organizations (id, name, owner_user_id, created_at) VALUES (?,?,?,?)", [
  ORG, "Bench", "usr_bench", Date.now(),
]);
const store = repo.createStore(ORG, "Bench Store");

const channel = repo.createChannel({
  orgId: ORG, storeId: store.id, connector: "flipkart",
  name: "Flipkart bench", mode: "mock",
  // No artificial latency: we want the language cost, not a sleep().
  config: { mockLatencyMs: 0 },
});

const save = await repo.saveProduct({
  orgId: ORG,
  storeId: store.id,
  sku: "BENCH-001",
  title: "Handwoven Mysore Silk Saree — Peacock Blue",
  description: "Pure mulberry silk woven on a traditional pit loom.",
  brand: "Misiki",
  category: "Sarees",
  status: "ACTIVE",
  attributes: COMPLETE_ATTRIBUTES,
  taxRateBp: 500,
  hsnCode: "5007",
  weightG: 620,
  variants: Array.from({ length: 4 }, (_, i) => ({
    sku: `BENCH-001-V${i}`,
    options: { Colour: `C${i}` },
    priceCents: 1249900,
    mrpCents: 1599900,
    currency: "INR",
    available: 20,
  })),
  images: [{ url: "https://example.com/a.jpg" }, { url: "https://example.com/b.jpg" }],
});
const productId = save.id;
const canonical = repo.canonical(productId)!;
const connector = getConnector("flipkart");
const manifest = connector.manifest();

const ctx: ConnectorContext = {
  mode: "mock",
  config: { mockLatencyMs: 0 },
  credentials: {},
  seller: {
    storeName: store.name, description: "", logoUrl: "", legalName: "Bench Pvt Ltd",
    businessType: "private_limited", taxId: "29AAAAA0000A1Z5", registrationNo: "",
    supportEmail: "", supportPhone: "", website: "",
    address: { line1: "", line2: "", city: "", state: "", postalCode: "", country: "IN" },
    currency: "INR",
  },
  log: () => {},
};

// ------------------------------------------------------------------- steps

let counter = 0;

await time("canonical assembly (3 queries + JSON parse)", N, () => repo.canonical(productId))();
await time("manifest validation (10 required fields)", N, () =>
  missingRequiredFields(manifest, canonical))();
await time("connector payload build + mock call", N, () =>
  connector.createProduct(ctx, canonical))();
await time("queue enqueue (dedupe check + insert)", N, () =>
  queue.enqueue({
    organizationId: ORG, storeId: store.id, channelId: channel.id,
    operation: "PRODUCT_UPDATE", entityType: "product", entityId: productId,
    idempotencyKey: `bench:${counter++}`,
  }))();
await time("queue claim + succeed (2 tx)", N, () => {
  const [job] = queue.claim("bench", 1);
  if (job) queue.succeed(job.id, 1);
})();
await time("product save (hash + replace variants/images)", 500, async () => {
  await repo.saveProduct({
    orgId: ORG, storeId: store.id, id: productId,
    sku: "BENCH-001", title: `Title ${counter++}`,
    status: "ACTIVE", attributes: COMPLETE_ATTRIBUTES,
  });
})();

// ------------------------------------------------------------------ report

const jobCompute =
  results.find((r) => r.label.startsWith("canonical"))!.perOpUs +
  results.find((r) => r.label.startsWith("manifest"))!.perOpUs +
  results.find((r) => r.label.startsWith("connector"))!.perOpUs +
  results.find((r) => r.label.startsWith("queue claim"))!.perOpUs;

const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\n  Per-operation cost (${N} iterations each, marketplace latency removed)\n`);
console.log(`  ${pad("step", 46)}${pad("µs/op", 12)}ops/sec`);
console.log(`  ${"-".repeat(46 + 12 + 10)}`);
for (const r of results) {
  console.log(
    `  ${pad(r.label, 46)}${pad(r.perOpUs.toFixed(1), 12)}${Math.round(r.opsPerSec).toLocaleString()}`,
  );
}

console.log(`
  Compute per sync job (everything except the network call)
     ${jobCompute.toFixed(0)} µs  =  ${(jobCompute / 1000).toFixed(2)} ms

  A real marketplace call costs 200-2000 ms, and connectors are rate-limited
  to 3-8 requests/second by the marketplaces themselves:

     Flipkart  5 req/s      Meesho  3 req/s
     Amazon    5 req/s      Etsy    5 req/s

  So one job is ~${(jobCompute / 1000 / 500 * 100).toFixed(2)}% our code and ~${(100 - jobCompute / 1000 / 500 * 100).toFixed(2)}% waiting on the marketplace,
  assuming an optimistic 500 ms round trip.

  Publishing 10,000 SKUs to Flipkart at its 5 req/s cap:
     network-bound floor   ${(10000 / 5 / 60).toFixed(0)} minutes
     our compute           ${((jobCompute * 10000) / 1_000_000 / 60).toFixed(2)} minutes
`);

db.close();
try {
  rmSync(dir, { recursive: true });
} catch {}
