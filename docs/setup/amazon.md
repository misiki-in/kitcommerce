# Amazon — going live

> Connector `amazon` · Login with Amazon (LWA) OAuth2: client ID + client secret + refresh token + selling partner ID · Last verified against official docs: 2026-08-27

Amazon's Selling Partner API is fully self-serve, but every credential sits behind a human-reviewed developer registration inside Seller Central. Expect a professional seller account, a written developer profile with a security questionnaire, and an approval wait of roughly 3 business days — longer (community reports say 7+) if you request the restricted role that unlocks buyer names and shipping addresses on orders. Once approved, minting the actual keys takes minutes. There are two ways to hand them to OpenCommerce: paste them into the connect form yourself (route A), or let the operator configure the built-in OAuth app so sellers just click Connect (route B).

## Before you start

- A **professional** Seller Central account, and you must be its **Primary User** — secondary users cannot register developers or self-authorize apps.
  - India: register at https://sell.amazon.in (the portal is https://sellercentral.amazon.in). You need PAN, GSTIN (for most categories), and a bank account. Amazon.in has no monthly subscription — fees are per-sale.
  - US and most other regions: the Professional selling plan (USD 39.99/month in the US) is required. Amazon's docs state private SP-API seller apps cannot be built on Individual accounts.
- Decide which roles you need. This connector uses: **Product Listing**, **Pricing**, **Amazon Fulfillment** (order/inventory data), and — only if you want buyer names, emails and shipping addresses imported with orders — **Direct-to-Consumer Shipping (Restricted)**. Without the restricted role, orders still import, just without buyer PII.
- Pick your route: **A (self-authorization)** needs no server configuration; **B (Connect button)** needs the operator to set `AMAZON_*` environment variables first. Both routes start with steps 1–3.

## Steps

### 1. Create or verify your Seller Central account

Sign in at https://sellercentral.amazon.in (India) or your region's Seller Central. Confirm under Settings > User Permissions that you are the Primary User.

### 2. Register as a private SP-API developer

Docs: https://developer-docs.amazon.com/sp-api/docs/registering-as-a-developer

In Seller Central go to **Apps and Services > Develop Apps** (the developer console — also reachable via the Solution Provider Portal at https://solutionproviderportal.amazon.com). Complete the developer profile:

- Describe your data use in **under 500 original words** (what you sync, why, where it is stored).
- Answer the security-controls questionnaire: encryption at rest, access control, data retention.
- Request the roles listed above. The Direct-to-Consumer Shipping (Restricted) role triggers an extra data-protection review against Amazon's Data Protection Policy.

You receive: an approved developer registration (a case in Seller Central). Standard roles historically clear in ~3 business days; the restricted PII role takes ~7+ business days. **If Amazon asks follow-up questions, respond within 5 days or the case is closed.**

### 3. Create the app client — this mints the LWA Client ID and Secret

Docs: https://developer-docs.amazon.com/sp-api/docs/registering-your-application

On the **Develop Apps** page click **Add new app client**. Name the app, choose API type **SP-API**, audience **Sellers**, and tick the roles approved on your profile. The new row in the app list has an **LWA credentials** column — click **View** to reveal:

- **Client ID** — starts with `amzn1.application-oa2-client.`
- **Client Secret** — expires every 180 days (see Notes & limits)

The same row also shows the app's **Application ID** (`amzn1.sellerapps.app.…`) — route B needs it.

### 4A. (Route A) Self-authorize — this mints the refresh token

Docs: https://developer-docs.amazon.com/sp-api/docs/self-authorization

On the Develop Apps page, open the app's **Authorize** action and click the **Authorize app** button. A **refresh token** (starts with `Atzr|`) is displayed once on that page — copy it immediately. Each click of Authorize app generates a *new* refresh token; old ones remain valid, so rotate deliberately. Self-authorization only covers your own selling account.

### 5A. (Route A) Find your Selling Partner (Merchant) ID

In Seller Central go to **Settings > Account Info > Business Information > Merchant Token**. That token (e.g. `A2ABC123…`) is the `seller_id` the connect form asks for — it addresses your account in Listings Items API paths.

Now open the OpenCommerce dashboard, add an Amazon channel, and paste all four values into the connect form.

### 4B. (Route B) Operator: configure the built-in OAuth redirect

Set these environment variables on the OpenCommerce installation, then restart it:

- `AMAZON_APPLICATION_ID` — the app's `amzn1.sellerapps.app.…` ID from the Develop Apps page (**not** the LWA client ID)
- `AMAZON_LWA_CLIENT_ID` / `AMAZON_LWA_CLIENT_SECRET` — from the LWA credentials panel (step 3)
- `AMAZON_SELLER_CENTRAL_HOST` — the consent page's regional host: `sellercentral.amazon.in` for India (defaults to `sellercentral.amazon.com`)
- `AMAZON_APP_DRAFT=1` — only while the app is still in draft state (it adds `version=beta` to the consent URL; a published app rejects that parameter, so unset it after the app goes live)
- `OC_PUBLIC_URL` — the installation's public base URL

In the app client's configuration in Seller Central, register the OAuth redirect URI as `<OC_PUBLIC_URL>/auth/amazon/callback` — it must match byte for byte.

### 5B. (Route B) Seller: click Connect

In the OpenCommerce dashboard the Amazon channel now shows a **Connect** button. It hands off to the Seller Central consent page; after you approve, Amazon redirects back with the authorization code and your `selling_partner_id`, and OpenCommerce exchanges and stores the credentials itself. Nothing to copy.

## What goes where

Connect form (route A — route B fills these automatically):

| Field | Value looks like | Where it comes from |
| --- | --- | --- |
| LWA Client ID (`client_id`) | `amzn1.application-oa2-client.…` | Develop Apps > your app > LWA credentials > View |
| LWA Client Secret (`client_secret`) | opaque string | Same panel. Re-copy after every 180-day rotation |
| Refresh Token (`refresh_token`) | `Atzr\|…` | Develop Apps > your app > Authorize > "Authorize app" (shown once) |
| Selling Partner ID (`seller_id`) | `A2ABC123…` | Settings > Account Info > Business Information > Merchant Token |

Extra config JSON keys the connector reads:

| Key | What it does |
| --- | --- |
| `marketplace` | Storefront: `IN` (default), `US`, `UK`, `DE`, `AE`, `AU`, `JP`. Picks the region host and marketplace ID |
| `default_product_type` | The Amazon product type your listings use (e.g. `SHIRT`). Inventory and price patches are **rejected** when this mismatches the listing's real product type; unset, the connector falls back to `PRODUCT`, which most listings are not |
| `fulfillment` | `fulfillment_channel_code` for merchant-fulfilled offers; defaults to `DEFAULT` |

Environment variables (route B only, set by the operator): `AMAZON_APPLICATION_ID`, `AMAZON_LWA_CLIENT_ID`, `AMAZON_LWA_CLIENT_SECRET`, `AMAZON_SELLER_CENTRAL_HOST`, `AMAZON_APP_DRAFT`, `OC_PUBLIC_URL` — see step 4B.

## Verify

Connect the channel in the dashboard, flip it to **Live**, and press **Test**. The health check calls `GET /sellers/v1/marketplaceParticipations` on the region host; a green result proves the LWA token exchange and the marketplace grant both work. That endpoint allows roughly **one call per minute** (0.016 rps, burst 15), so repeated Test clicks in quick succession will start returning 429.

## Notes & limits

- **LWA client secret rotates every 180 days — mandatory.** Amazon notifies 90 days ahead; after you generate the new secret the old one dies in 7 days. The Client ID and refresh token survive rotation — only `client_secret` in OpenCommerce (or `AMAZON_LWA_CLIENT_SECRET` for route B) needs updating. Docs: https://developer-docs.amazon.com/sp-api/docs/rotating-your-apps-lwa-credentials
- **Orders API v0 is on a removal clock: 2027-03-27.** The connector deliberately stays on v0 for now and will migrate to Orders v2026-01-01 before that date; nothing for you to do, but do not pin expectations on v0 URLs in your own tooling.
- **Buyer PII is gated.** Without the Direct-to-Consumer Shipping (Restricted) role the connector cannot mint a Restricted Data Token; it logs this once per sync and imports orders without buyer name, email, or shipping address rather than failing. Restricted Data Tokens live ~1 hour, and all buyer data falls under Amazon's Data Protection Policy (encrypt at rest, delete when no longer needed).
- **Approval waits:** ~3 business days for standard roles, ~7+ for the restricted role (community-reported, not an Amazon SLA). Reply to Amazon's case questions within 5 days or the case closes. Private seller apps are also subject to Amazon's authorization-limit policy (in force since April 2022).
- **Rate limits** (per operation): `getOrders` 0.0167 rps burst 20; `getOrderItems` 0.5 rps burst 30 (the connector paces itself after ~25 orders in one run); `putListingsItem` 5 rps burst 10; `patchListingsItem` 5 rps burst 5. SP-API sends no `Retry-After` header on throttle — the connector retries after a fixed 60s.
- **Fees:** SP-API itself is free. India: no monthly seller subscription on amazon.in; per-sale referral and closing fees apply, and GST registration is effectively required. US and most other marketplaces: Professional selling plan (USD 39.99/month in the US) is required.
- Every click of **Authorize app** creates a new refresh token and old ones stay valid — revoke/rotate deliberately, and store only the one you actually use.
