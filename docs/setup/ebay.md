# eBay — going live

> Connector `ebay` · OAuth2 (App ID + Cert ID + seller refresh token) · Last verified against official docs: 2026-08-27

eBay's Sell APIs are fully self-serve and free: any eBay Developers Program
member can mint production keys without a partner manager. Two gates slow you
down. Production keys are created **disabled** until you handle the marketplace
account-deletion-notification requirement (or formally opt out), and new
applications start on a low daily call quota (~5,000 calls/day per API) until
you pass the free Application Growth Check. Budget one to two hours of clicking,
plus up to two business days if developer-program signup lands in manual review.

## Before you start

- An eBay account **registered to sell** — Seller Hub reachable at
  <https://www.ebay.com/sh/ovw> with payouts (managed payments) onboarding
  complete. A plain buyer account can finish the OAuth consent but cannot
  publish offers.
- Your OpenCommerce installation reachable over **HTTPS** if you want the
  built-in Connect button — eBay refuses non-HTTPS/localhost redirect URLs on
  production.
- The seller present (or on a call) for one sign-in: the refresh token is
  minted by the seller approving a consent screen.

## Steps

### 1. Join the eBay Developers Program

Register at <https://developer.ebay.com> (top-right **Register**). Free; email
verification required. Accounts are usually usable immediately, occasionally
after a short manual review (up to ~2 business days). You receive: a developer
account.

### 2. Create an application keyset

Go to **Your Account → Application Keys** — <https://developer.ebay.com/my/keys>
— and create a keyset. You receive a **Sandbox** keyset immediately and a
**Production** keyset row, each showing three values:

- **App ID (Client ID)** → the connect form's *App ID (Client ID)*
- **Cert ID (Client Secret)** → the connect form's *Cert ID (Client Secret)*
- **Dev ID** → not needed; the REST OAuth flow this connector uses ignores it

### 3. Activate the production keyset (account-deletion notifications)

Production keys stay **disabled** until your application handles eBay
Marketplace Account Deletion/Closure notifications —
<https://developer.ebay.com/marketplace-account-deletion>. On the Application
Keys page follow the alert/notification link next to the production keyset and
do one of:

- **Register an HTTPS endpoint** plus a verification token. eBay validates it
  with `GET <your-endpoint>?challenge_code=...`; your endpoint must reply
  `{"challengeResponse": "<sha256 hex of challengeCode + verificationToken + endpointURL>"}`.
  After verification, eBay POSTs a notification whenever a user whose data you
  hold deletes their account, and you are obliged to delete their data.
- **Opt out**, allowed if you do not persist eBay user data outside eBay.

Until one of these is done, every production API call is rejected.

### 4. Create the OAuth redirect (RuName)

On the Application Keys page click **User Tokens** next to the production keyset (direct link: <https://developer.ebay.com/my/auth/?env=production>), expand **Get a Token from eBay via Your Application**, and add an eBay Redirect URL:
- **Display Title**: OpenCommerce Sync (or your application name)
- **Privacy Policy URL**: `https://<your-OpenCommerce-host>/privacy` (or your store URL)
- **Your auth accepted URL**: `https://<your-OpenCommerce-host>/auth/ebay/callback`
- **Your auth declined URL**: `https://<your-OpenCommerce-host>/dash/channels?oauth_error=declined`

You will receive an **RuName** (formatted like `YourName-AppName-PRD-12345678-abcdef`).

### 5. Server Configuration (Zero-Fuss 1-Click Connect for Sellers)

Set these environment variables on your OpenCommerce server (`.env`) and restart:

```env
EBAY_CLIENT_ID=Your-App-ID-From-Keyset
EBAY_CLIENT_SECRET=Your-Cert-ID-From-Keyset
EBAY_RU_NAME=YourName-AppName-PRD-12345678-abcdef
OC_PUBLIC_URL=https://your-opencommerce-domain.com
```

### 6. User Connection (1-Click Connect)

Once the server environment variables are configured:
1. Users go to **Dashboard → Channels → Available Connectors → eBay**.
2. Click **Connect with eBay**.
3. Sign in to their eBay Seller account and click **Agree**.
4. OpenCommerce automatically exchanges the authorization code, stores the encrypted refresh token, and **auto-discovers their business policies (fulfillment, return, payment) and warehouse location**. No manual IDs or curl commands required!

### 7. Alternative: Self-Hosted User Connection without Server Environment

If you are running self-hosted without configuring server environment variables:
1. Open **Channels → eBay**.
2. In the connection card, enter your **App ID**, **Cert ID**, and **RuName**.
3. Click **Connect with eBay**. OpenCommerce will execute the grant flow and auto-discover all policies and inventory locations.

### 7. Alternative: mint the refresh token by hand

For completeness — the outcome is identical to step 6.

1. Open, signed in as the seller (scopes URL-encoded, `redirect_uri` is the
   RuName):

   ```
   https://auth.ebay.com/oauth2/authorize?client_id=<App ID>&redirect_uri=<RuName>&response_type=code&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.inventory%20https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope%2Fsell.fulfillment
   ```

2. After consent, your accepted URL receives `?code=...` — it expires in about
   five minutes.
3. Exchange it:

   ```
   curl -X POST https://api.ebay.com/identity/v1/oauth2/token \
     -H "Authorization: Basic $(printf '%s:%s' "$APP_ID" "$CERT_ID" | base64)" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "grant_type=authorization_code&code=<code>&redirect_uri=<RuName>"
   ```

   The response holds `access_token` (7,200 s — discard it) and
   `refresh_token` (~18 months) → paste the refresh token, App ID and Cert ID
   into the connect form.

The User Tokens page can also mint a token directly via **Sign in to
Production** — if you use it, pick the **OAuth** token type. The legacy
*Auth'n'Auth* token does not work with the REST Sell APIs this connector calls.

### 8. Optional: sandbox first

Create a sandbox test user at <https://developer.ebay.com/my/sandbox>, then
repeat steps 4–7 with the **sandbox** keyset against
`auth.sandbox.ebay.com/oauth2/authorize` and
`api.sandbox.ebay.com/identity/v1/oauth2/token`. With `EBAY_SANDBOX=1` the
Connect button targets sandbox and sets the channel's `sandbox` config for you;
on the manual route add `{"sandbox": true}` to the channel's Extra config.
Sandbox and production refresh tokens are not interchangeable.

## What goes where

| Field / key | Where the value comes from |
| --- | --- |
| Connect form · App ID (Client ID) | Production keyset row at <https://developer.ebay.com/my/keys> (sandbox keyset's App ID when running sandbox) |
| Connect form · Cert ID (Client Secret) | Same keyset row, click to reveal — sandbox and production Cert IDs differ |
| Connect form · User Refresh Token | Output of the consent-flow exchange (step 6 or 7); it is not shown anywhere in the developer portal |
| Extra config `marketplace_id` | Target marketplace; defaults to `EBAY_US` (`EBAY_GB`, `EBAY_DE`, `EBAY_AU`, `EBAY_CA`, `EBAY_IN`, …) |
| Extra config `sandbox` | `true` only with a sandbox keyset + token; the Connect button sets it automatically when `EBAY_SANDBOX=1` |
| Extra config `content_language` | `Content-Language` header on API calls; defaults to `en-US` (use `de-DE` with `EBAY_DE`) |

Per-product attributes the connector requires before it will publish:

| Product attribute | Where the value comes from |
| --- | --- |
| `attributes.ebay_category_id` | Leaf category ID from the Taxonomy API or a draft listing (step 5) |
| `attributes.condition` | One of `NEW`, `LIKE_NEW`, `USED_EXCELLENT`, `USED_GOOD`, `USED_ACCEPTABLE` |
| `attributes.ebay_fulfillment_policy_id` | Shipping policy ID — Seller Hub → Business Policies (step 5) |
| `attributes.ebay_payment_policy_id` | Payment policy ID — same page |
| `attributes.ebay_return_policy_id` | Return policy ID — same page |
| `attributes.ebay_merchant_location_key` | The key you chose when creating the inventory location (step 5) |

## Verify

In the dashboard open **Channels**, connect (or edit) the eBay channel, set the
mode to **Live**, save, then hit **Test** on the channel row. The health check
performs the refresh-token exchange against
`POST https://api.ebay.com/identity/v1/oauth2/token` (sandbox host when
`sandbox` is set) — `HEALTHY` means keyset and refresh token match and the
environment is right; `AUTH_FAILURE` usually means a sandbox token against
production (or vice versa), a revoked consent, or an expired refresh token.
Then publish one test product and confirm it appears in Seller Hub → Listings.

## Notes & limits

- **Fees**: the Developers Program and all API usage are free. Normal selling
  fees apply to real listings — insertion fees beyond the monthly free
  allocation, final value fees per sale; no store subscription is required.
- **Rate limits**: new applications get roughly 5,000 calls/day *per API*,
  reset at midnight UTC. The free **Application Growth Check** (requested via
  the developer portal) raises Sell API limits into the millions per day. On
  HTTP 429 the connector honours `Retry-After` when eBay sends it and
  otherwise backs off 15 minutes, because the binding limit is that daily
  quota, not a per-second window.
- **Token clocks**: refresh tokens last ~18 months (540 days) and die early if
  the seller changes their password or revokes access — re-run Connect to
  re-mint. Access tokens (2 h) are cached and renewed automatically.
- **Order history**: the `creationdate` filter behind order import cannot
  reach further back than two years.
- **PII**: buyer names, addresses and emails imported with orders fall under
  the account-deletion obligations from step 3 — if you registered a
  notification endpoint, keep it responding, or eBay disables your keys.
- **Sandbox**: a separate universe — separate keyset, separate test users,
  separate tokens; nothing carries over to production.
