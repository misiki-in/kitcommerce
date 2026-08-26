# OpenCommerce

Open-source commerce integration infrastructure. Publish one catalogue to
Amazon, Flipkart, Meesho, Myntra, AJIO, JioMart, Zepto, Instamart, Blinkit,
Nykaa, Tata CLiQ, Snapdeal, eBay and Etsy — with retries, idempotency and a full
audit trail — starting from a single command.

```bash
git clone <repo> && cd opencommerce
bun dev
```

That is the whole setup. No database to install, no broker, no `.env`, no
config file, no API keys. Bun's built-in SQLite is the database and the job
queue; the encryption key is generated on first boot.

**Zero runtime dependencies.** Nothing is imported at run time that Bun does
not already provide — the database, password hashing, HTTP server and job queue
are all built in. The only `devDependency` is the TypeScript compiler, used for
`bun typecheck`; it never ships and `bun dev` does not need it.

Want data to look at first?

```bash
bun seed     # demo account, 4 marketplaces connected, catalogue with variants
bun dev      # then sign in as demo@opencommerce.dev / demo1234
```

Other commands:

| | |
| --- | --- |
| `bun check` | type check + self-test (the one to run before committing) |
| `bun typecheck` | TypeScript 7 native compiler, ~0.2s over the whole codebase |
| `bun test` | self-test, 75 assertions, no test framework |
| `bun bench` | where a sync job actually spends its time |
| `bun reset` | wipe local data |

---

## What it does

```
        your catalogue                    OpenCommerce                marketplaces
   ┌──────────────────────┐            ┌────────────────┐          ┌──────────────┐
   │ products, variants,  │            │  canonical     │          │  Amazon      │
   │ images, attributes   │──────────▶ │  model         │────────▶ │  Flipkart    │
   │ company + store info │            │  + sync engine │          │  Meesho      │
   └──────────────────────┘            └────────────────┘          │  Myntra …    │
     wizard, or an                       events → jobs →           └──────────────┘
     adapter (Litekart)                  retries → audit
```

You enter a product once. The engine works out which channels can accept it,
validates it against each marketplace's declared requirements, and queues one
job per channel. Price and stock changes fan out the same way. Orders come back
the other direction.

### Working today

- **Two-step onboarding** — Google sign-in (optional) or email, then connect a
  marketplace. Company details are asked for later, from the dashboard
- **Five-step product wizard** — basics, pricing & stock, images, channel
  details, review. Each step saves a real draft, so a refresh never loses work
- **Listing suggestions, no AI** — SKU generation with collision avoidance,
  category inference (your own catalogue outranks the built-in taxonomy) and
  keyword extraction. Deterministic, so the same input always suggests the same
  thing and the self-test can assert it
- **Fourteen marketplace connectors**, each with real endpoint implementations
  *and* a mock mode that needs no seller account:

  | | |
  | --- | --- |
  | India — horizontal | Amazon · Flipkart · Meesho · JioMart · Snapdeal · Tata CLiQ |
  | India — fashion & beauty | Myntra · AJIO · Nykaa |
  | India — quick commerce | Zepto · Swiggy Instamart · Blinkit |
  | Global | eBay · Etsy |

- **Quick commerce is modelled honestly** — Zepto/Instamart/Blinkit stock is
  per dark store, not one pool, so those channels take a `locations` list and an
  explicit `mirror` or `split` allocation policy
- **Encrypted credentials** — AES-256-GCM before the first write, with a key
  generated on this machine. Nine assertions in the self-test hold the code to
  the promises the onboarding screen makes
- **Sync engine** — per-channel jobs, idempotency keys, exponential backoff
  (5s → 30s → 2m → 10m → 30m), error classification, dead-letter, manual retry
- **Pre-flight validation** — a product missing a marketplace-required field
  becomes a visible `INCOMPLETE` mapping instead of five failed jobs
- **Order import** — deduplicated on `(source, external_id)`
- **Dashboard + REST API** — the dashboard is just one client of the API

### Deliberately not here yet

Teams and roles, multi-store, AI, Postgres, Redis, shipping, accounting, and
bulk marketplace writes (the single biggest throughput win — see `bun bench`).
Each has a seam waiting for it — see [Design decisions](#design-decisions).

---

## Mock mode

Every connector ships a simulator, so the entire pipeline is demonstrable
offline:

```
[flipkart] mock: created Flipkart listing FKS1B2KOO0 for MSK-SAREE-001
[meesho]   mock: created Meesho catalog MSH1B2KOO0 with 2 variation(s)
[ebay]     mock: published eBay listing EBAY1B2KOO0 for MSK-SAREE-001
[etsy]     mock: created Etsy listing ETSY1B2KOO0 for MSK-SAREE-001
```

Remote IDs are derived from the SKU rather than random, so retrying a job
produces the same remote ID — the idempotency guarantee is observable, not just
asserted.

To watch the retry ladder and dead-lettering, set a failure rate on a channel:

```json
{ "mockFailureRate": 0.4 }
```

Switch a channel to **live** and add credentials to hit the real API. Nothing
above the connector changes.

> **Before going live.** Only two of these APIs are fully public, and the
> connectors say so in their own docblocks:
>
> - **Verified against public docs** — Amazon (SP-API), eBay (Sell Inventory +
>   Fulfillment), Etsy (Open API v3)
> - **Documented shape, unverified** — Flipkart (required attributes vary per
>   vertical) and every partner-gated portal: Meesho, Myntra, AJIO, JioMart,
>   Nykaa, Tata CLiQ, Snapdeal, Zepto, Instamart, Blinkit
>
> For the second group, expect to correct paths and field names once you have
> real credentials — each is a one-file change. Mock mode is unaffected.

---

## Design decisions

Each of these is a seam, chosen so the thing it defers is an *addition* later
rather than a rewrite.

### Minimal stack, everything else a driver

Infrastructure is a plugin plane, alongside platform adapters and marketplace
connectors. Every port's default driver needs zero external infrastructure:

| Port | Default | Later drivers |
| --- | --- | --- |
| `db` | SQLite (`bun:sqlite`) | Postgres |
| `queue` | the database itself | Redis Streams, BullMQ, NATS, SQS |
| `events` | transactional outbox | Kafka, NATS, Redis |
| `search` | SQL `LIKE` | Meilisearch, Typesense |
| `notify` | noop (log) | Resend, SendGrid, SMTP |
| `blob` | local disk | S3, R2 |
| `secrets` | AES-256-GCM, local key | Vault, KMS |

Interfaces live in [`src/ports.ts`](src/ports.ts), defaults in
[`src/drivers/`](src/drivers/). The interface is defined by the *weakest*
guarantee any driver can meet — which is why Kafka belongs on `events` and never
on `queue`: its offset model cannot express per-job ack, delay and dead-letter.

**The database is not abstracted.** SQL is written in the open in
[`src/repo.ts`](src/repo.ts) so the SQLite → Postgres move is a readable diff.
Projects like this die by abstracting their primary datastore.

Note the default queue is *durable*, not absent. `sync_jobs` is a real queue:
jobs survive restarts, and because it lives in the same database as your data,
the event and the state change commit in one transaction. A Redis default could
not give you that — the minimal stack is more correct here, not less.

### Tenancy: columns now, roles later

One account → one personal organization → one store → unlimited channels.
There are no teams, roles or invites. But `organization_id` and `store_id` are
on every table from the first row, because:

| | cost now | cost later |
| --- | --- | --- |
| scoping columns | a column and an index | migrating + backfilling every row |
| memberships, roles, invites | weeks, shapes every handler | one new table |

Every access decision goes through one chokepoint in
[`src/auth.ts`](src/auth.ts) (`canAccessStore`, `canAccessProduct`, …). Today
each body is an ownership comparison; when roles arrive, only that file changes.
Forty handlers doing inline `if (row.organization_id === …)` is what makes RBAC a
rewrite — so there are none.

The one-store limit is a service-layer constant (`maxStoresPerOrg`), **not** a
`UNIQUE` constraint, so raising it is a config change rather than a migration.

### No AI in core

There is no LLM dependency, no API key, no model choice, and there never needs
to be one. AI arrives as an **MCP server** — OpenCommerce exposes what it can
already do as tools, and whatever assistant you already use drives it. That
keeps the AI dependency count at zero permanently.

```bash
bun mcp                              # stdio; your editor starts it
claude mcp add opencommerce -- bun src/mcp.ts
```

Fourteen tools in two families. **Operate**: read and write the catalogue,
queue syncs, and ask `validate_product` why something is not listing. **Extend**:
`connector_sdk` hands an assistant the connector contract, and
`scaffold_connector` returns a compiling connector with a working mock mode —
which is what turns "add Shopee" into a change someone can make without having
read the codebase first.

Two guarantees the server keeps: it never reads stored channel credentials —
`bun test` greps it for the same SQL patterns it greps the API routes for — and
it will not publish to a **live** marketplace without `confirmLive: true`. See
[`docs/mcp.md`](docs/mcp.md).

AI stays out of the sync path specifically. A non-deterministic attribute mapper
would break idempotency outright: the same product retried after a rate-limit
could produce a different payload than the first attempt, while the idempotency
key claims they are identical — which is how you get duplicate listings.
AI-*suggested* mappings are fine as a design-time affordance; the committed
mapping is what executes.

### Server-rendered dashboard

Deviation from the original spec, which called for SvelteKit. A second toolchain
and a build step do not fit inside `bun dev`. The REST API is the real interface,
so a SvelteKit dashboard can replace [`src/http/web*.ts`](src/http/) later
without the server changing.

---

## Adding a marketplace

Two files. One new connector, one line in the registry:

```ts
// src/connectors/index.ts
export const connectors = { flipkart, ebay, meesho, etsy, amazon };
```

Nothing in the sync engine, the API or the dashboard knows a connector's name.
A connector declares its capabilities and required fields in a manifest, and the
core respects both — it will never call an operation a connector says it does not
support, and it validates products against `requiredFields` before queueing.

See [`docs/connector-roadmap.md`](docs/connector-roadmap.md) for what's next.

---

## Layout

```
src/
  index.ts          entry: wiring + routes + server
  ports.ts          infrastructure interfaces
  drivers/          default driver implementations
  connector.ts      marketplace connector SDK (types, errors, validation)
  connectors/       flipkart · ebay · meesho · etsy · mock harness
  adapters/         litekart (platform adapter plane)
  repo.ts           data access, canonical assembly, change detection
  auth.ts           identity, sessions, the authz chokepoint
  sync.ts           event → job planner, and the worker
  http/             router, REST API, dashboard pages
  db/schema.sql     one migration
  seed.ts           demo data     selftest.ts   30 assertions
docs/
  connector-roadmap.md
data/               gitignored: database, uploads, encryption key
```

## API

```
GET  /api/v1/health
GET  /api/v1/connectors            GET /api/v1/connectors/:name
GET  /api/v1/stores                GET /api/v1/stores/:id
GET  /api/v1/products              POST /api/v1/products
GET  /api/v1/products/:id          POST /api/v1/products/:id/sync
GET  /api/v1/channels
GET  /api/v1/jobs                  GET /api/v1/jobs/:id
POST /api/v1/jobs/:id/retry
GET  /api/v1/orders
```

Credentials are never returned by any endpoint — no handler reads that table.

## Configuration

None required. Every value has a working default; environment variables exist
only so the same code can be deployed:

```
PORT=3000                  OC_DATA_DIR=./data
OC_SECRET_KEY=<base64 32>  OC_MAX_STORES_PER_ORG=1
OC_WORKER=off              OC_WORKER_CONCURRENCY=4
```

## License

MIT.
