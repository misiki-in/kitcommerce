# Shopify — going live

> Connector `shopify` · shop domain + Admin API access token (legacy custom app) **or** Client ID/Secret (Dev Dashboard app) · Last verified against official docs: 2026-08-27

This is a self-serve, own-store integration — no Shopify app review, no partner
program. What decides your route is a calendar date: since **January 1, 2026**
custom apps can no longer be created inside the Shopify admin, so new
integrations create an app in the **Dev Dashboard** (dev.shopify.com) and give
OpenCommerce its Client ID/Secret — the connector exchanges those for 24-hour
tokens automatically. Only stores that still have a custom app created in admin
before that date can use the old permanent `shpat_` token. Either way, expect
roughly 30 minutes. The store needs a paid Shopify plan to sell for real; a
free development store from the Dev Dashboard works for testing.

## Before you start

- A Shopify store you own (or store-owner access). Live selling needs a paid
  plan; a free development store created in the Dev Dashboard works for testing
  but cannot process real sales.
- The store's `*.myshopify.com` domain.
- Know your route:
  - **Route A — Dev Dashboard app** (everyone from 2026 on): the app must be
    created in the **same Shopify organization** as the store. The
    client-credentials token grant refuses stores outside the app's
    organization, which also means an agency cannot mint tokens against a
    client's store this way.
  - **Route B — legacy admin custom app**: only if the store already has one
    (created before Jan 1, 2026). Existing apps keep working; new ones cannot
    be created.

## Steps

### 1. Note the shop domain

In the Shopify admin (https://admin.shopify.com) go to **Settings → Domains**
and copy the `*.myshopify.com` domain (e.g. `example.myshopify.com`). That
exact value — no `https://`, no trailing slash — is the connect form's **Shop
domain**. It is the host the connector calls at
`https://{shop_domain}/admin/api/2026-07/graphql.json`.

### 2A. Route A — create a Dev Dashboard app

1. Log in at https://dev.shopify.com/dashboard/ with the store owner account
   (the app must live in the store's Shopify organization).
2. **Apps → Create app**, name it (e.g. "OpenCommerce sync"), and create it via
   the Dev Dashboard path — the API-only option, "best for automation or
   API-only apps with no admin UI". No Shopify CLI needed.
   (Docs: https://shopify.dev/docs/apps/build/dev-dashboard/create-apps-using-dev-dashboard)
3. In the app's version configuration, select the **Admin API access scopes**:
   - `write_products` (create/update products; includes the read access the
     SKU lookups need)
   - `read_orders` (order import)
   - `write_inventory` (stock sync via `inventorySetQuantities`)
   - `read_locations` (to look up the location GID)

   Then create/release the app version so the scopes take effect.
   (Docs: https://shopify.dev/docs/apps/launch/deployment/deploy-app-versions)
4. Install the app on the store: open the app in the Dev Dashboard, find the
   **Installs** section, click **Install app**, pick the store (if the org has
   several), confirm **Install**.
   (Docs: https://help.shopify.com/en/manual/apps/install-setup-apps)
5. Go to the app's **Settings** and copy the **Client ID** and **Client
   secret**. There is no static admin token in the UI for these apps — that is
   expected. You receive: the two values that go into the connect form.

OpenCommerce performs the token exchange itself: it POSTs the pair to
`https://{shop}.myshopify.com/admin/oauth/access_token` with
`grant_type=client_credentials`, caches the resulting token, and re-mints it
before the 24-hour expiry (`expires_in` is always 86399). You do not paste any
token for this route — leave the **Admin API access token** field empty.

### 2B. Route B — legacy admin custom app (pre-2026 stores only)

1. Shopify admin → **Settings → Apps and sales channels → Develop apps** →
   your app.
2. On the **Configuration** tab, make sure the Admin API scopes include
   `write_products`, `read_orders`, `write_inventory`, `read_locations`.
3. On the **API credentials** tab, the **Admin API access token** (`shpat_...`)
   is what goes in the connect form. It is revealed **only once**, at install.
   If nobody saved it, uninstall and reinstall the app to generate a new one —
   do **not** delete the app, because a deleted admin app cannot be recreated.
   (Docs: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin)

### 3. Find the inventory location GID

Shopify admin → **Settings → Locations** → click the fulfilment location. The
numeric ID is the last path segment of the browser URL. The connector needs the
GraphQL GID form in the channel's Extra config:

```json
{ "location_id": "gid://shopify/Location/1234567890" }
```

Alternatively query it with the token (requires `read_locations`):

```graphql
{ locations(first: 5) { nodes { id name } } }
```

Without `location_id`, products are created with zero stock and inventory sync
fails with a validation error.

## What goes where

| Connect-form field / config key | Where the value comes from |
| --- | --- |
| Shop domain | Admin → Settings → Domains: the `*.myshopify.com` domain, e.g. `example.myshopify.com` |
| Admin API access token *(optional)* | Route B only: admin → Settings → Apps and sales channels → Develop apps → [app] → API credentials (`shpat_...`, shown once). Leave empty on Route A |
| Client ID *(optional)* | Route A: Dev Dashboard → Apps → [app] → Settings |
| Client secret *(optional)* | Route A: Dev Dashboard → Apps → [app] → Settings |
| Extra config `location_id` | `gid://shopify/Location/{numericId}` — numeric ID from the location's admin URL, or the `locations` query |
| Extra config `publish_immediately` *(optional)* | `true` to create products as ACTIVE instead of DRAFT |

Supply **either** the access token **or** the Client ID/Secret pair. With
neither, the connector fails authentication naming both options.

## Verify

Connect the channel in the OpenCommerce dashboard, switch it to **Live**, and
hit **Test**. The health check runs the `{ shop { name } }` query against
`https://{shop_domain}/admin/api/2026-07/graphql.json` — on Route A this also
proves the client-credentials exchange works end to end. A healthy response
shows your shop's name as the detail.

## Notes & limits

- **API version**: pinned to `2026-07` (stable July 1, 2026 – July 16, 2027).
  Shopify releases quarterly and supports each version for 12 months; expect
  the pin to move about once a year.
- **Rate limits** are cost-based (leaky bucket), not request-counted:
  100 points/s on Standard plans, 200 on Advanced, 1000 on Plus. Throttled
  queries come back as HTTP 200 with a `THROTTLED` error code; the connector
  detects this and retries after the bucket refills.
- **Order history**: with `read_orders` alone, Shopify serves only the **last
  60 days** of orders. Older history needs the `read_all_orders` scope, which
  requires a separate access request (Dev Dashboard → API access → Read all
  orders → Request access) and was never available to legacy admin custom
  apps.
- **Order size**: the connector imports at most the first 50 line items per
  order.
- **Token lifetime** (Route A): client-credentials tokens expire every 24
  hours; the connector re-mints them automatically. The grant only works when
  app and store are in the same Shopify organization.
- **Token reveal** (Route B): the `shpat_` token is shown exactly once at
  install; store it in a password manager when you first see it.
- **Costs**: the Admin API itself is free. Live selling needs a paid plan —
  Basic is roughly $29–39/month depending on billing cycle (verify at
  https://www.shopify.com/pricing). Development stores are free but cannot
  take real payments.
- **PII**: order import carries customer names, emails, phones, and shipping
  addresses into OpenCommerce; treat your OpenCommerce database accordingly.
