# Etsy — going live

> Connector `etsy` · OAuth 2.0 PKCE + `x-api-key: keystring:shared_secret` · Last verified against official docs: 2026-08-27

Etsy is one of the easier marketplaces to wire up: app registration is self-serve with automated approval (usually minutes), and OpenCommerce ships the OAuth redirect, so the seller never touches curl. You need an active Etsy shop in good standing, a Seller App registered on that account, and an OpenCommerce installation reachable over HTTPS. Budget under an hour end to end — most of it is Etsy's registration form and the browser consent step.

## Before you start

- **An active Etsy shop in good standing.** No shop yet: [etsy.com/sell](https://www.etsy.com/sell) → "Get started" (shop preferences, name, first listing, payment/billing). Shops opened since 2024 pay a one-time setup fee, typically $15–29 depending on region.
- **No app already registered on the account** — Seller App eligibility is one app per account.
- **OpenCommerce reachable over HTTPS** at a stable URL. Etsy requires TLS on OAuth callbacks, so `http://localhost` will not do for the redirect; use a tunnel or a real deployment and set `OC_PUBLIC_URL`.
- Know which access tier you need. A **Seller App** can only touch the shop of the account that registered it — exactly what a self-hosted OpenCommerce needs, and the fastest path. Building a tool *other* sellers will connect requires a **Personal App** ([etsy.com/developers/register](https://www.etsy.com/developers/register), manual review) and then a separate **Commercial Access** application on top. This guide follows the Seller App path.

## Steps

### 1. Register a Seller App

Go to the Etsy Developer Portal at [etsy.com/developers](https://www.etsy.com/developers), find **Create a seller app** and select **Get started**. Sign in with the Etsy account that owns the shop. Enter an app name (e.g. "OpenCommerce sync") and why you want API access, then select **Read Terms and Create App**. Approval is automated and usually lands within a few minutes; once approved you must agree to the API Terms of Use.

You receive: an approved app in the developer portal.

### 2. Collect the keystring and shared secret

Open **Your Apps** at [etsy.com/developers/your-apps](https://www.etsy.com/developers/your-apps) and select your app. Copy the API Key **keystring** and the **shared secret** — they sit next to each other on the app page. Every v3 API call must send both, colon-joined, as the `x-api-key` header (`keystring:shared_secret`); the connector does the joining for you.

You receive: the keystring (also your OAuth client ID) and the shared secret.

### 3. Register the OAuth callback on the app

Still in the app's settings in Your Apps, add a callback/redirect URI:

```
https://<your OC_PUBLIC_URL host>/auth/etsy/callback
```

It must be `https://` and must match what OpenCommerce sends byte for byte.

### 4. Configure OpenCommerce

Set these environment variables and restart:

```
ETSY_CLIENT_ID=<keystring>
ETSY_SHARED_SECRET=<shared secret>
OC_PUBLIC_URL=https://<where this installation is reachable>
# optional — default shown; scopes are FROZEN at the grant, widen them now or re-grant later
ETSY_SCOPES="listings_r listings_w transactions_r"
```

With both `ETSY_CLIENT_ID` and `ETSY_SHARED_SECRET` set, the Etsy card in the dashboard grows a **Connect with Etsy** button (the secret is required — credentials granted without it cannot make API calls). If you will ever push shipment/tracking updates back to Etsy, add `transactions_w` to `ETSY_SCOPES` *before* granting — a refresh token cannot widen its scopes later.

### 5. Run the grant

Dashboard → **Channels** → **Etsy** → **Connect with Etsy**. A browser consent screen opens on etsy.com (be logged in as the shop owner); approve access. OpenCommerce exchanges the code at `https://api.etsy.com/v3/public/oauth/token` and stores the credentials encrypted.

You receive (stored automatically): an access token valid **1 hour** and a refresh token valid **90 days**, which **rotates on every renewal**. The connector renews access tokens itself from the refresh token — nothing to do on a running installation. If the channel sits idle past 90 days, redo this step.

### 6. Find your shop_id

The connector needs the numeric shop ID in the channel's config (`shop_id` — channel config, not a credential). Two ways to get it:

- Call `GET https://openapi.etsy.com/v3/application/users/me` (getMe) with headers `x-api-key: keystring:sharedsecret` and `Authorization: Bearer <access_token>` — the response is `{user_id, shop_id}`.
- No curl handy: open Shop Manager and read the numeric ID out of the URL (`etsy.com/your/shops/<shop_id>/…`). Do **not** use the numeric prefix of your access token — that is your `user_id`, which is not the shop ID.

### 7. Create a shipping profile

In Etsy Shop Manager go to **Settings → Shipping settings** ([direct link](https://www.etsy.com/your/shops/me/tools/shipping-profiles)) and create at least one shipping profile. Note its numeric ID and put it on products as `attributes.etsy_shipping_profile_id`. Drafts can be created without it (optional since January 2026), but a listing cannot go live until it has one.

## What goes where

| Field | Where it comes from |
| --- | --- |
| `api_key` (connect form) | The keystring from Your Apps → your app. Filled automatically by Connect with Etsy. Legacy escape hatch: pasting `keystring:sharedsecret` here works without the field below. |
| `shared_secret` (connect form) | Next to the keystring on the same app page. Filled automatically when `ETSY_SHARED_SECRET` is set. |
| `access_token` (connect form, optional) | Minted by the grant (step 5). Lives 1 hour; auto-renewed whenever a refresh token exists, so it can stay empty. |
| `refresh_token` (connect form, optional) | From the grant (step 5). 90 days, rotates on every renewal. |
| `shop_id` (Extra config JSON) | Step 6 — `GET /users/me` (getMe), or the Shop Manager URL. |
| `attributes.etsy_taxonomy_id` (per product) | Numeric leaf category from Etsy's seller taxonomy. |
| `attributes.who_made`, `attributes.when_made` (per product) | Etsy's required listing facts; the product form constrains the values. |
| `attributes.etsy_shipping_profile_id` (per product) | Step 7 — Shop Manager → Settings → Shipping settings. |

Env vars `ETSY_CLIENT_ID`, `ETSY_SHARED_SECRET`, `ETSY_SCOPES`, `OC_PUBLIC_URL` identify *this installation*, not the seller — they live in the deployment, not the connect form.

## Verify

Connect the channel in the dashboard, switch it to **Live**, and hit **Test**. The health check calls `GET /v3/application/shops/{shop_id}` (getShop) with both credentials, which also exercises the token refresh. For a key-only smoke test outside OpenCommerce: `GET https://api.etsy.com/v3/application/openapi-ping` with just the `x-api-key` header returns `{"application_id": …}`.

## Notes & limits

- **Rate limits:** defaults are 10,000 requests/day and 10 requests/second (per key for public calls, per OAuth token for authenticated ones); your app's actual budget shows in the developer portal, and every response carries `x-limit-per-day` / `x-remaining-today` headers. The connector self-caps at 5 rps and honours `retry-after` on 429. The daily budget is a sliding 24-hour window.
- **Token reality:** access tokens last 1 hour; refresh tokens last 90 days and rotate on every renewal. The connector handles renewal in memory. A channel idle for 90+ days needs the grant redone; so does any scope change.
- **Listings land as drafts.** Etsy requires images before a listing can be active, and this connector does not upload images yet — every created listing is a draft. Add photos and activate it in Shop Manager. `publish_immediately` in channel config only logs a reminder.
- **Fees:** the API is free. Selling costs: $0.20 per listing per 4-month term (charged again on renewal after each sale), 6.5% transaction fee on the order total, country-specific payment processing fees, plus the one-time shop setup fee for new shops.
- **`when_made` rolls forward:** the newest bucket is `2020_2026` in the 2026 API and Etsy renames it yearly — expect a connector update each January.
- **PII:** order import pulls buyer names, emails and shipping addresses via `getShopReceipts` (needs the `transactions_r` scope). Handle exports accordingly.
- **Webhooks exist but are not used yet:** Etsy now offers order webhooks (`order.paid`, `order.canceled`, `order.shipped`, `order.delivered`) registered via Manage your apps → Webhook portal, HMAC-SHA256 signed. This connector still polls receipts; no webhook endpoint to register.
