# Writing a connector

A marketplace connector knows one sales channel and nothing else. It never sees
Litekart types, never sees another connector, and receives only the canonical
model. Adding one touches **two files**.

## 1. The connector

Create `src/lib/server/connectors/<name>.ts` implementing `MarketplaceConnector`
from [`../src/lib/server/connector.ts`](../src/lib/server/connector.ts):

```ts
export const amazon: MarketplaceConnector = {
  manifest: () => manifest,
  health(ctx)                        { … },
  createProduct(ctx, product)        { … },   // -> { remoteId }
  updateProduct(ctx, product, remoteId) { … },
  updateInventory(ctx, update)       { … },
  updatePrice(ctx, update)           { … },
  listOrders(ctx, since)             { … },
};
```

`ctx` carries the channel's mode, config, decrypted credentials, the seller
profile, and a logger. **Never log credentials** — the logger is not filtered.

## 2. The registry

```ts
// src/lib/server/connectors/index.ts
import { amazon } from "./amazon";
export const connectors = { flipkart, ebay, meesho, etsy, amazon };
```

That is the entire integration. The dashboard, the API, the planner and the
worker all discover the connector through its manifest.

---

## The manifest is a contract

```ts
const manifest: Manifest = {
  name: "amazon",
  displayName: "Amazon",
  version: "0.1.0",
  platformType: "marketplace",
  authentication: {
    type: "oauth2",
    fields: [{ key: "refresh_token", label: "LWA Refresh Token", secret: true }],
  },
  regions: ["IN", "US"],
  capabilities: { createProduct: true, inventorySync: true, /* … */ },
  requiredFields: [
    { path: "attributes.browse_node_id", label: "Browse node", required: true,
      help: "Amazon category node" },
  ],
  rateLimits: { requestsPerSecond: 5, burst: 10 },
  docsUrl: "https://developer-docs.amazon.com/sp-api/",
  setupGuide: "https://github.com/misiki-in/kitcommerce/blob/main/docs/setup/amazon.md",
};
```

Two fields do real work at runtime:

**`capabilities`** — the planner will never queue an operation you declare
`false`. Declaring `orderImport: false` means `listOrders` is never called.

**`requiredFields`** — validated *before* a job is queued. A product missing one
becomes an `INCOMPLETE` mapping visible in the dashboard, with the field named,
rather than a job that fails five times and dead-letters. `path` is read out of
the canonical product (`title`, `brand`, `attributes.foo`, `images`).

Every entry you add here surfaces automatically in the product form's "Channel
requirements" panel. That panel is the whole reason the mapping story works
without developer help — invest in good `label` and `help` text.

---

## Errors decide retry behaviour

Throw `ConnectorError` with a class. The class alone determines whether the job
is retried, rescheduled, or dead-lettered immediately:

| Class | Retried? | Use for |
| --- | --- | --- |
| `RETRYABLE` | yes | 5xx, timeouts, transient network failures |
| `RATE_LIMITED` | yes, honouring `retryAfterMs` | 429 |
| `CONFLICT` | yes | 409, optimistic-concurrency rejections |
| `AUTHENTICATION` | **no** | 401/403 — also marks the channel `AUTH_FAILURE` |
| `VALIDATION` | **no** | 400/422 — the payload will never be accepted as-is |
| `NOT_FOUND` | **no** | 404 |
| `UNKNOWN` | **no** | anything you cannot classify |

Getting this wrong is the most common connector bug. Retrying a validation error
burns rate limit, delays every other job behind it, and hides the real problem
from the merchant. `classifyStatus(status, body)` maps HTTP codes onto the
taxonomy — override it wherever your API is more specific.

```ts
if (res.status === 429) {
  const retryAfter = Number(res.headers.get("retry-after") ?? 30);
  throw new ConnectorError("rate limited", "RATE_LIMITED",
    { retryAfterMs: retryAfter * 1000 });
}
```

---

## Mock mode is required

Every connector must work with no credentials, so the pipeline is demonstrable
on a fresh clone and so contributors can develop without a seller account:

```ts
if (ctx.mode === "mock") {
  await mockLatency(ctx);
  mockMaybeFail(ctx, "createProduct");        // honours channel mockFailureRate
  const remoteId = mockRemoteId("AMZ", p.sku); // derived from SKU, not random
  return { remoteId };
}
```

Derive mock remote IDs from the SKU rather than randomly. That makes a retry
return the same remote ID, so the idempotency guarantee is *observable* rather
than merely claimed.

---

## Idempotency

The core builds the key; you do not:

```
<channel>:<entity>:<id>:<operation>:<version>
chn_abc:product:prd_123:PRODUCT_UPDATE:17
```

Duplicate keys collapse to a no-op at enqueue time. A real edit bumps the
product version and earns a new key. Where the remote API has its own
idempotency mechanism (a client token, a PUT keyed by SKU), use it — pass the
key through so a retry that crossed with a slow success cannot double-create.

Prefer naturally idempotent verbs. eBay's `PUT /inventory_item/{sku}` is a
replace, which is why the eBay connector is safe under retry without any
extra bookkeeping.

---

## Prices

Never modify the canonical price. Channel price rules are applied by the core as
a publish-time transformation, from channel config:

```json
{ "priceRule": { "type": "percent", "value": 8 } }
```

Your `updatePrice` receives the already-transformed `priceCents`.

---

## Checklist before opening a PR

1. Manifest with honest `capabilities` and complete `requiredFields`
2. Mock path for every method
3. Live path with correct error classification
4. One line in `src/lib/server/connectors/index.ts`
5. A row in [`connector-roadmap.md`](./connector-roadmap.md) moved to ✅
6. `bun test` passes — the self-test validates every registered manifest
7. Note in the connector's docblock if any live endpoint is unverified
8. A setup guide in [`docs/setup/`](./setup/) — the manual steps a seller
   walks to get live credentials — linked from the manifest's `setupGuide`.
   Where credentials are issued by hand, say so in `credentialsNote`; the
   connect dialog shows both.
