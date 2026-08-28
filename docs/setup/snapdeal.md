# Snapdeal — going live

> Connector `snapdeal` · clientId + X-Auth-Token + X-Seller-Authz-Token headers · Last verified against official docs: 2026-08-27

Snapdeal is the rare Indian marketplace here with genuinely public API docs:
the full seller-API reference lives at sellerapis.snapdeal.com. Access is
still two-step — an API-user registration form with a ~2-day human approval,
then a per-seller authorization the seller performs in a browser — but no
account manager gatekeeps it. Expect a working setup within a few days of
having a seller account.

## Before you start

- A Snapdeal seller account (standard KYC: GSTIN, PAN, bank details).
- Somewhere to receive the authorization redirect — the per-seller token is
  returned in a redirect URL, so have a `returnURL` you can read.

## Steps

### 1. Register as a Snapdeal seller

Sign up at <https://seller.snapdeal.com/> and manage the store at
<https://sellers.snapdeal.com/> (panel login with registered email +
password).

### 2. Register as an API User

Submit the API-user registration form linked from
<https://sellerapis.snapdeal.com/reference/api-authentication>. The Snapdeal
API team responds within about two days with your **clientId** and an
**access token** (sent as `X-Auth-Token`). Sandbox and production need
separate tokens: sandbox gateway `http://staging-apigateway.snapdeal.com`,
production `https://apigateway.snapdeal.com/seller-api`.

### 3. Get the seller authorization token

Send the seller to
`https://authorize.snapdeal.com/authserverui/login?returnURL={RETURN_URL}&appId={appId}`.
The seller logs in with their Snapdeal username/password, and the
**X-Seller-Authz-Token** comes back in the redirect URL. This token scopes
your API access to that seller's data.

### 4. Read the API reference

Full endpoint docs — inventory, pricing, orders, `/seller/v2/info`, the
`/vendorself/...` fulfilment routes, and the API Picker — are public at
<https://sellerapis.snapdeal.com/>. Note: the site currently serves a
`*.readme.io` TLS certificate, so browsers may warn; the content is
legitimate ReadMe-hosted documentation.

## What goes where

| Field | Where the value comes from |
| --- | --- |
| Client ID | The API team's approval reply (step 2) |
| API access token | Same reply — this is the `X-Auth-Token`; keep sandbox and production tokens separate |
| Seller authorization token | The redirect URL after the seller logs in at authorize.snapdeal.com (step 3) |
| Extra config `baseUrl` | Only for sandbox runs: `http://staging-apigateway.snapdeal.com` (production is the built-in default) |

## Verify

In the dashboard, connect the `snapdeal` channel, switch mode to **Live**, and
hit **Test**. The health check calls `GET
https://apigateway.snapdeal.com/seller-api/seller/v2/info` — a documented
endpoint, so a failure here points at credentials or authorization, not at
the connector's path.

## Notes & limits

- No registration or API fees; standard category commissions on sales.
- Only the profile path is verified against the public docs so far — the
  catalogue/inventory/price/order paths in the connector are still generic
  sketches that need mapping to Snapdeal's documented endpoint families
  (open sellerapis.snapdeal.com in a browser; its TLS misconfig blocks
  automated fetches).
- The per-seller token is minted by a human login; if it is revoked or
  expires, repeat step 3 — the clientId and X-Auth-Token stay valid
  independently.
