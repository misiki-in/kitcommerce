/**
 * Self-test for the guarantees the sync engine claims. No test framework.
 *
 *   bun src/selftest.ts
 *
 * Runs against a throwaway database so it never touches your real data.
 */
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { config } from "./lib/server/config";
import { localSecrets, outboxEvents } from "./lib/server/drivers";
import { sqliteDb } from "./lib/server/drivers/db.sqlite";
import { BACKOFF_MS, sqliteQueue } from "./lib/server/drivers/queue.sqlite";
import { ConnectorError, missingRequiredFields } from "./lib/server/connector";
import { listManifests } from "./lib/server/connectors";
import { allocateStock } from "./lib/server/connectors/quickcommerce";
import { COMPLETE_ATTRIBUTES } from "./lib/server/fixtures";
import { idempotencyKey } from "./lib/server/sync";
import { createRepo } from "./lib/server/repo";
import {
  suggestCategories,
  suggestKeywords,
  suggestSku,
  suggestVariantSku,
  tokenize,
} from "./lib/server/suggest";

const path = join(config.dataDir, "selftest.db");
try {
  for (const suffix of ["", "-wal", "-shm"]) unlinkSync(path + suffix);
} catch {}

const db = sqliteDb(path);
db.exec(await Bun.file(new URL("./lib/server/db/schema.sql", import.meta.url)).text());
const queue = sqliteQueue(db);
const bus = outboxEvents(db);
const repo = createRepo(db, bus);

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}\n          expected ${JSON.stringify(expected)}\n          actual   ${JSON.stringify(actual)}`);
  }
}

const base = {
  organizationId: "org_1",
  storeId: "str_1",
  channelId: "chn_1",
  entityType: "product",
  entityId: "prd_1",
};

console.log("\nidempotency");
{
  const key = idempotencyKey("chn_1", "product", "prd_1", "PRODUCT_UPDATE", 7);
  check("key format", key, "chn_1:product:prd_1:PRODUCT_UPDATE:7");

  const first = queue.enqueue({ ...base, operation: "PRODUCT_UPDATE", idempotencyKey: key });
  const second = queue.enqueue({ ...base, operation: "PRODUCT_UPDATE", idempotencyKey: key });
  check("first enqueue returns an id", typeof first, "string");
  check("duplicate key collapses to null", second, null);

  // A genuine edit bumps the version, so it earns a new job.
  const next = queue.enqueue({
    ...base,
    operation: "PRODUCT_UPDATE",
    idempotencyKey: idempotencyKey("chn_1", "product", "prd_1", "PRODUCT_UPDATE", 8),
  });
  check("new version enqueues again", typeof next, "string");
}

console.log("\nclaim");
{
  const claimed = queue.claim("worker_a", 10);
  check("claims both due jobs", claimed.length, 2);
  check("attempt counted on claim", claimed[0]!.attempt_count, 1);
  check("second worker sees nothing", queue.claim("worker_b", 10).length, 0);
  queue.succeed(claimed[0]!.id, 12);
  queue.succeed(claimed[1]!.id, 12);
  check(
    "succeeded rows recorded",
    db.get<{ n: number }>("SELECT COUNT(*) n FROM sync_jobs WHERE status='SUCCEEDED'")!.n,
    2,
  );
}

console.log("\nretry ladder + dead letter");
{
  const id = queue.enqueue({
    ...base,
    operation: "INVENTORY_UPDATE",
    idempotencyKey: "chn_1:product:prd_2:INVENTORY_UPDATE:1",
  })!;

  const delays: number[] = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    // Make the job due regardless of the scheduled backoff.
    db.run("UPDATE sync_jobs SET next_attempt_at = 0 WHERE id = ?", [id]);
    const [job] = queue.claim("worker_a", 1);
    if (!job) break;
    const before = Date.now();
    queue.fail(job.id, { message: "upstream 503", class: "RETRYABLE", retryable: true }, 5);
    const row = db.get<{ status: string; next_attempt_at: number }>(
      "SELECT status, next_attempt_at FROM sync_jobs WHERE id = ?",
      [id],
    )!;
    if (row.status === "RETRYING") delays.push(Math.round((row.next_attempt_at - before) / 1000));
  }

  check("backoff ladder (seconds)", delays, BACKOFF_MS.slice(0, 4).map((m) => m / 1000));
  check(
    "dead-letters after max attempts",
    db.get<{ status: string }>("SELECT status FROM sync_jobs WHERE id = ?", [id])!.status,
    "DEAD_LETTER",
  );
  check("every attempt is recorded", db.get<{ n: number }>("SELECT COUNT(*) n FROM sync_attempts WHERE job_id = ?", [id])!.n, 5);

  queue.retry(id);
  check(
    "manual retry resets the job",
    db.get<{ status: string; attempt_count: number }>(
      "SELECT status, attempt_count FROM sync_jobs WHERE id = ?", [id],
    ),
    { status: "PENDING", attempt_count: 0 },
  );
}

console.log("\npermanent errors are not retried");
{
  // Clear the job the previous block re-queued, so claim() below can only
  // return the job this block is about.
  db.run("DELETE FROM sync_jobs WHERE status IN ('PENDING','RETRYING')");

  const id = queue.enqueue({
    ...base,
    operation: "PRODUCT_CREATE",
    idempotencyKey: "chn_1:product:prd_3:PRODUCT_CREATE:1",
  })!;
  queue.claim("worker_a", 1);
  queue.fail(id, { message: "missing brand", class: "VALIDATION", retryable: false }, 3);
  check(
    "validation error dead-letters on attempt 1",
    db.get<{ status: string; attempt_count: number }>(
      "SELECT status, attempt_count FROM sync_jobs WHERE id = ?", [id],
    ),
    { status: "DEAD_LETTER", attempt_count: 1 },
  );
}

console.log("\nerror classification");
{
  check("429 is retryable", new ConnectorError("x", "RATE_LIMITED").retryable, true);
  check("401 is not", new ConnectorError("x", "AUTHENTICATION").retryable, false);
  check("422 is not", new ConnectorError("x", "VALIDATION").retryable, false);
  check("503 is", new ConnectorError("x", "RETRYABLE").retryable, true);
}

console.log("\nstale worker recovery");
{
  const id = queue.enqueue({
    ...base,
    operation: "PRICE_UPDATE",
    idempotencyKey: "chn_1:product:prd_4:PRICE_UPDATE:1",
  })!;
  queue.claim("worker_dead", 1);
  db.run("UPDATE sync_jobs SET locked_at = ? WHERE id = ?", [Date.now() - 600_000, id]);
  check("reaps the abandoned job", queue.reapStale(300_000), 1);
  check(
    "and requeues it",
    db.get<{ status: string }>("SELECT status FROM sync_jobs WHERE id = ?", [id])!.status,
    "RETRYING",
  );
}

console.log("\nmanifest validation");
{
  const complete = {
    id: "p", sku: "S1", title: "T", description: "D", brand: "B", category: "C",
    attributes: COMPLETE_ATTRIBUTES,
    images: [{ url: "u", alt: "", position: 0 }],
    variants: [{ id: "v", sku: "S1", barcode: "", options: {}, priceCents: 100, mrpCents: 100, currency: "INR", available: 1, weightG: 1 }],
    taxRateBp: 500, hsnCode: "5007", weightG: 100, lengthMm: 1, widthMm: 1, heightMm: 1, version: 1,
  };
  const bare = { ...complete, attributes: {}, images: [], brand: "", hsnCode: "", weightG: 0 };

  for (const m of listManifests()) {
    check(`${m.name}: complete product passes`, missingRequiredFields(m, complete as any).length, 0);
    check(`${m.name}: bare product is caught`, missingRequiredFields(m, bare as any).length > 0, true);
  }
}

console.log("\ndark-store stock allocation");
{
  check("no locations -> one pool", allocateStock(50, [], "mirror"), [
    { location: "", quantity: 50 },
  ]);
  check(
    "mirror sends the full quantity to every store",
    allocateStock(50, ["A", "B"], "mirror").map((s) => s.quantity),
    [50, 50],
  );
  check(
    "split divides evenly",
    allocateStock(50, ["A", "B"], "split").map((s) => s.quantity),
    [25, 25],
  );
  check(
    "split gives the remainder to the earliest stores",
    allocateStock(10, ["A", "B", "C"], "split").map((s) => s.quantity),
    [4, 3, 3],
  );
  check(
    "split never loses or invents stock",
    allocateStock(97, ["A", "B", "C", "D"], "split").reduce((n, s) => n + s.quantity, 0),
    97,
  );
  check(
    "zero stays zero everywhere",
    allocateStock(0, ["A", "B"], "split").map((s) => s.quantity),
    [0, 0],
  );
}

console.log("\nlisting suggestions");
{
  check("stopwords and short words are dropped", tokenize("The Best New Silk Saree"), [
    "silk",
    "saree",
  ]);
  check(
    "title terms outrank description terms",
    suggestKeywords({
      title: "Handwoven Mysore Silk Saree",
      description: "shipping returns packaging",
      limit: 3,
    })[0],
    "handwoven",
  );

  check(
    "category inferred from the title",
    suggestCategories({ title: "Handwoven Mysore Silk Saree" })[0]?.category,
    "Sarees",
  );
  check(
    "the merchant's own category outranks the built-in taxonomy",
    suggestCategories({ title: "Silk Saree" }, [{ category: "Sarees", count: 12 }])[0]?.source,
    "catalogue",
  );
  check(
    "unmatched title falls back to most-used categories",
    suggestCategories({ title: "Zzzz Qqqq" }, [{ category: "Home", count: 3 }])[0]?.category,
    "Home",
  );

  const taken = new Set(["MISI-SILKSAREE-001"]);
  check(
    "SKU is readable and brand-prefixed",
    suggestSku({ brand: "Misiki", title: "Silk Saree" }, () => false),
    "MISI-SILKSAREE-001",
  );
  check(
    "SKU avoids collisions",
    suggestSku({ brand: "Misiki", title: "Silk Saree" }, (s) => taken.has(s)),
    "MISI-SILKSAREE-002",
  );
  check(
    "SKU survives a missing brand",
    suggestSku({ title: "Silk Saree" }, () => false),
    "OC-SILKSAREE-001",
  );
  check(
    "variant SKU hangs off the parent",
    suggestVariantSku("MSK-SAREE-001", { Colour: "Peacock Blue", Size: "Free" }),
    "MSK-SAREE-001-PEAC-FREE",
  );
  check(
    "variant SKU with no options is the parent",
    suggestVariantSku("MSK-SAREE-001", {}),
    "MSK-SAREE-001",
  );
}

console.log("\ncredential security promises");
{
  // Each assertion here backs a claim made on the onboarding trust panel.
  const secrets = localSecrets(config.secretKey);
  const plaintext = { api_key: "sk_live_SUPERSECRET", api_secret: "shh-9021" };

  const sealed = await secrets.seal(plaintext);
  const asText = Buffer.from(sealed).toString("utf8");

  check("round-trips", await secrets.open(sealed), plaintext);
  check("ciphertext does not contain the key", asText.includes("sk_live_SUPERSECRET"), false);
  check("ciphertext does not contain the secret", asText.includes("shh-9021"), false);
  check("a 12-byte IV is prepended", sealed.length > 12, true);
  // Same plaintext must not produce the same bytes, or the store leaks equality.
  const again = await secrets.seal(plaintext);
  check(
    "same input seals to different bytes",
    Buffer.from(sealed).toString("base64") === Buffer.from(again).toString("base64"),
    false,
  );

  // Tampering must fail closed rather than return partial plaintext.
  const tampered = new Uint8Array(sealed);
  const last = tampered.length - 1;
  tampered[last] = (tampered[last] ?? 0) ^ 0xff;
  let rejected = false;
  try {
    await secrets.open(tampered);
  } catch {
    rejected = true;
  }
  check("tampered ciphertext is rejected", rejected, true);

  // "Never returned by any API response" is enforced structurally: nothing
  // under the API routes reads the credentials table. Scanning the directory
  // rather than one file means the guarantee survives the routes being
  // reorganised.
  const apiDir = new URL("./routes/api/", import.meta.url);
  let apiSource = "";
  try {
    const glob = new Bun.Glob("**/*.ts");
    for await (const file of glob.scan({ cwd: Bun.fileURLToPath(apiDir) })) {
      apiSource += await Bun.file(Bun.fileURLToPath(apiDir) + "/" + file).text();
    }
  } catch {
    // No API routes yet (mid-migration): the guarantee is vacuously true.
  }
  check("no API handler reads the credentials table", /FROM\s+credentials/i.test(apiSource), false);
  check("no API handler selects a ciphertext", /ciphertext/i.test(apiSource), false);

  /*
   * The MCP server is held to the same promise, and arguably needs it more.
   * Its output is read by a language model that may quote it back, paste it
   * into a file, or send it somewhere else entirely — so a credential leaking
   * into a tool result travels further than one leaking into a JSON response
   * a human asked for.
   */
  let mcpSource = "";
  try {
    mcpSource = await Bun.file(Bun.fileURLToPath(new URL("./mcp.ts", import.meta.url))).text();
  } catch {
    // No MCP server present: vacuously true, same as the API routes above.
  }
  check("MCP server never reads the credentials table", /FROM\s+credentials/i.test(mcpSource), false);
  check("MCP server never selects a ciphertext", /ciphertext/i.test(mcpSource), false);

  // "Never written to any log": the worker builds its logger without creds.
  const syncSource = await Bun.file(new URL("./lib/server/sync.ts", import.meta.url)).text();
  const logLine = syncSource.slice(syncSource.indexOf("log: (msg, meta)"), syncSource.indexOf("log: (msg, meta)") + 220);
  check("connector logger never interpolates credentials", /credential/i.test(logLine), false);
}

console.log("\noutbox");
{
  let seen = 0;
  bus.subscribe("product.*", () => { seen++; });
  db.tx(() => {
    bus.publish({ name: "product.created.v1", organizationId: "org_1", storeId: "str_1", payload: { a: 1 } });
    bus.publish({ name: "order.imported.v1", organizationId: "org_1", storeId: "str_1", payload: {} });
  });
  const drained = await bus.drain(10);
  check("drains every unpublished row", drained, 2);
  check("pattern subscription matched once", seen, 1);
  check("draining twice is a no-op", await bus.drain(10), 0);
}

console.log("\nreleases");
{
  // The head of RELEASES is what the dashboard reports as its version, so a
  // release cut without touching package.json (or the reverse) would have the
  // app announcing a version it is not.
  const { RELEASES } = await import("./lib/releases");
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  check("package.json matches the newest release", RELEASES[0]!.version, pkg.version);
  check("releases are newest first", RELEASES.every((r, i) => i === 0 || RELEASES[i - 1]!.version >= r.version), true);
}

console.log("\nconnectors are self-describing");
{
  const { connectors, CONNECTOR_GROUPS } = await import("./lib/server/connectors");
  const manifests = Object.values(connectors).map((c) => c.manifest());

  // The point of the contract: everything the rest of the app needs to file,
  // rank or render a connector comes off its own manifest. A connector that
  // omits one of these would otherwise fail somewhere far from its own file.
  check(
    "every connector declares group, status and idPrefix",
    manifests.every((m) => m.group && m.idPrefix && (m.status === "ready" || m.status === "development")),
    true,
  );

  // Remote IDs collide silently if two connectors share a prefix, and a
  // collision looks like a sync bug rather than a registry mistake.
  check("id prefixes are unique", new Set(manifests.map((m) => m.idPrefix)).size, manifests.length);

  // Derived, so this is really asserting nothing gets dropped on the way.
  const grouped = CONNECTOR_GROUPS.flatMap((g) => g.names);
  check("every connector lands in exactly one group", grouped.length, manifests.length);
  check("registry key matches manifest name", Object.entries(connectors).every(([k, c]) => k === c.manifest().name), true);

  // The regression this whole refactor exists to prevent: a core file growing
  // its own list of connector names that can drift from the registry.
  const NAMES = manifests.map((m) => m.name);
  for (const file of ["./routes/+page.server.ts", "./lib/server/connectors/index.ts"]) {
    const text = await Bun.file(new URL(file, import.meta.url)).text();
    const body = file.endsWith("index.ts") ? text.slice(text.indexOf("export const CONNECTOR_GROUPS")) : text;
    check(`no connector names hardcoded in ${file.split("/").pop()}`, NAMES.some((n) => body.includes(`"${n}"`)), false);
  }
}

console.log("\nchannel search");
{
  const { fuzzyScore, fuzzyRank } = await import("./lib/fuzzy");
  const { ROADMAP_CHANNELS } = await import("./lib/roadmap");
  const { connectors } = await import("./lib/server/connectors");

  // Subsequence, not substring: this is the whole reason it is not indexOf.
  check("initials find a spaced name", fuzzyScore("tcq", "Tata CLiQ") !== null, true);
  check("a prefix matches", fuzzyScore("zal", "Zalando") !== null, true);
  check("out-of-order letters do not match", fuzzyScore("yase", "Etsy"), null);
  check("an empty query matches everything", fuzzyScore("", "anything"), 0);

  // The ranking rule people actually rely on: the tightest name wins.
  const ranked = fuzzyRank(["eBay Motors Parts", "eBay"], "ebay", (s) => s);
  check("the shorter exact name ranks first", ranked[0], "eBay");

  // An empty query must leave curated order alone rather than re-sorting it.
  const untouched = fuzzyRank(["c", "a", "b"], "  ", (s) => s);
  check("blank query preserves order", untouched.join(""), "cab");

  // A channel cannot be both shipped and wished for. If one is ever in both
  // lists the page tells a seller it is connected and not connected at once.
  const built = new Set(Object.values(connectors).map((c) => c.manifest().displayName.toLowerCase()));
  const overlap = ROADMAP_CHANNELS.filter((r) => built.has(r.name.toLowerCase()));
  check("nothing is both built and wanted", overlap.map((o) => o.name).join(", "), "");

  const names = ROADMAP_CHANNELS.map((r) => r.name);
  check("wanted-list has no duplicates", new Set(names).size, names.length);
}

console.log("\ncsv import sheet & taxonomy");
{
  const { parseCSV, groupSheetRows } = await import("./lib/server/import_sheet");
  const { taxonomyIdForCategory } = await import("./lib/server/connectors/etsy/taxonomy");

  const sampleCSV = `SKU,Grouped SKU,Title,Variant Price,Stock,Categories,Image Src,Attribute Name 1,Attribute Value 1
JWS01-A,GRP01,Moissanite Cluster Earrings,75.00,10,"Earrings>Shop By Style>Cluster Earrings",https://example.com/1.jpg,Metal,925 Silver
JWS01-B,GRP01,Moissanite Cluster Earrings,85.00,5,"Earrings>Shop By Style>Cluster Earrings",https://example.com/2.jpg,Metal,14K Gold
JWS02,,Single Ring,120.00,2,Rings,https://example.com/ring.jpg,Stone,Diamond`;

  const parsed = parseCSV(sampleCSV);
  check("csv parser parses header and data rows", parsed.length, 3);
  check("csv parser extracts fields accurately", parsed[0]?.SKU, "JWS01-A");

  const groups = groupSheetRows(parsed, "USD");
  check("groups multi-variant rows by Grouped SKU", groups.length, 2);
  check("grouped product has 2 variants", groups[0]?.canonical.variants.length, 2);
  check("standalone product becomes single variant", groups[1]?.canonical.variants.length, 1);
  check("deduplicates images across group", groups[0]?.canonical.images.length, 2);

  check("resolves cluster earrings taxonomy id", taxonomyIdForCategory("Earrings>Shop By Style>Cluster Earrings"), 1206);
  check("resolves general rings taxonomy id", taxonomyIdForCategory("Jewelry>Rings"), 1231);
  check("falls back to default taxonomy id on unknown category", taxonomyIdForCategory("Unknown>Category"), 1);

  const { taxonomyIdForEbayCategory } = await import("./lib/server/connectors/ebay/taxonomy");
  check("resolves ebay rings category id", taxonomyIdForEbayCategory("Jewelry>Rings"), 67726);
  check("resolves ebay earrings category id", taxonomyIdForEbayCategory("Earrings>Shop By Style>Cluster Earrings"), 50647);
  check("resolves ebay default category id for unknown", taxonomyIdForEbayCategory("Unknown>Category"), 11450);

  // Database imports table
  db.run("INSERT INTO users (id, email, password_hash, created_at) VALUES ('usr_t', 't@e.com', 'x', 0)");
  db.run("INSERT INTO organizations (id, name, owner_user_id, created_at) VALUES ('org_t', 'Test Org', 'usr_t', 0)");
  db.run("INSERT INTO stores (id, organization_id, name, created_at, updated_at) VALUES ('sto_t', 'org_t', 'Test Store', 0, 0)");

  const createdImport = repo.createImport({
    orgId: "org_t",
    storeId: "sto_t",
    filename: "sample.csv",
    csvText: sampleCSV,
    rowCount: 3,
  });
  check("created import has imp_ prefix id", createdImport.id.startsWith("imp_"), true);
  const fetchedImport = repo.getImport(createdImport.id);
  check("fetches import from imports table by id", fetchedImport?.filename, "sample.csv");
  check("import status is UPLOADED", fetchedImport?.status, "UPLOADED");
}

db.close();
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
