# Flipkart — going live

> Connector `flipkart` · OAuth2 client credentials (self-access application) · Last verified against official docs: 2026-08-27

API access itself is free, self-serve and instant: any active Flipkart seller can create a "self-access application" from the Seller Dashboard and use its Application ID/Secret with the connector. The real gates are elsewhere — seller verification (GSTIN/PAN/bank) before the account is active, and the catalogue: the v3 API cannot create catalogue products, so every SKU you sync must already exist on Flipkart with an FSN, which can mean Seller Hub uploads, QC, and brand approval taking days. With an active seller account and listed products, expect the API portion to take under an hour.

## Before you start

- **Business paperwork**: a GSTIN (mandatory for most categories; a few, like books, allow PAN-only enrolment), PAN, an active bank account for settlements, and a pickup address.
- **Products on Flipkart**: every SKU needs an existing catalogue product identified by an FSN. If your products are not listed yet, budget time for catalogue QC and, for branded goods, brand approval.
- **One warning up front**: self-access credentials are for your own seller account only. Flipkart's docs state that sharing them with a third party or aggregator "will lead to seller account deactivation". Aggregators have their own route (step 7).

## Steps

### 1. Register as a Flipkart seller

Sign up at https://seller.flipkart.com with phone and email OTP, then complete profile and bank verification (GSTIN/PAN/bank) until the dashboard shows the account active. You receive: an active Seller Dashboard. Note the docs' own warning — the username and password from seller registration do **not** provide API access; credentials come from step 3.

### 2. Create your products in Seller Hub first

The v3 Listing API only attaches offers to catalogue products that already exist — it cannot create catalogue entries. In the Seller Dashboard, go to **Listings > Add New Listings** (single or bulk upload); branded products may route through the Brand Regulation / brand-approval flow first. For products already sold on Flipkart by others, match the existing catalogue entry instead of creating a duplicate.

You receive: a catalogue product per SKU, identified by its **FSN** (Flipkart's product ID, 13–16 characters). It is shown against each listing in the dashboard's Listings views, and it is also the `pid=` parameter in any flipkart.com product page URL. Record one FSN per SKU — the connector sends it as `product_id` on every write, via the product attribute `flipkart_fsn`.

### 3. Create a self-access API application

In the Seller Dashboard, go to **Manage Profile > Developer Access**, click **Create New Access**, enter an application name and description, and submit. The application appears in your list with an **Application ID** and **Application Secret** — these are the connector's `client_id` and `client_secret`. There is no approval wait; the credentials work immediately.

(Older documentation routed this through the Developer Admin portal at https://api.flipkart.net/oauth-register/login with application type "Self-Access Application"; the Seller Dashboard path is the currently documented one, but the portal is where to look if your dashboard lacks the Developer Access page.)

### 4. Mint a token to prove the credentials

```
curl -u <application-id>:<application-secret> "https://api.flipkart.net/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api"
```

You receive JSON with `access_token`, `token_type: "bearer"`, `expires_in` in seconds (roughly 60 days) and a `refresh_token` (roughly 180 days). If this curl works, the connector's health check will pass — it performs exactly this call. Do not paste the token anywhere; the connector mints and caches its own.

### 5. Find your location_id

Flipkart tracks stock per dispatch location, and both listing creation and inventory updates must name the location's id. It is assigned during seller onboarding (your pickup/dispatch address), and it appears in the Seller Dashboard's dispatch-address settings and in listing API responses (`GET https://api.flipkart.net/sellers/listings/v3/{sku}` for any already-listed SKU). Put it in the channel's Extra config as `location_id` — the connector refuses listing and inventory writes without it.

### 6. Optional: exercise the sandbox first

A sandbox exists at https://sandbox-api.flipkart.net with identical paths — its own token mint at `/oauth-service/oauth/token`, the same `/sellers/...` APIs, plus sandbox-only endpoints for creating test orders and marking them shipped. Set `"sandbox": true` in the channel's Extra config to point the connector at it.

Current docs show the sandbox curls but not sandbox credential issuance: try your production Application ID/Secret against the sandbox token URL first; if refused, register a sandbox application at https://sandbox-api.flipkart.net/oauth-register/login (the route older docs describe) or ask seller support.

### 7. Only for aggregators: the third-party partner route

If you run OpenCommerce on behalf of **other** sellers, self-access credentials are the wrong — and bannable — tool. Register at https://partners.flipkart.com selecting "Yes" for API Partner; Flipkart verifies details within 72 hours. Then go to **Profile > Manage API Access > Create Application** with a valid HTTPS redirect URL and use the authorization-code flow at https://api.flipkart.net/oauth-service/oauth/authorize. Note: this connector implements the self-access client-credentials flow only; the partner flow would need connector changes.

## What goes where

| Connect-form field / config key | Where the value comes from |
| --- | --- |
| Application ID (`client_id`) | Seller Dashboard > Manage Profile > Developer Access — shown for your self-access application (step 3) |
| Application Secret (`client_secret`) | Same page, displayed alongside the Application ID. Treat it like a password; never share it |
| Extra config `location_id` | Your dispatch location's id from seller onboarding (step 5). **Required** for listing and inventory writes |
| Extra config `sandbox` | `true` to target https://sandbox-api.flipkart.net; omit for production |
| Extra config `fulfillment_profile` | Optional; defaults to `NON_FBF` (seller-fulfilled). Set `FBF` only if enrolled in Fulfilment by Flipkart |
| Extra config `dispatch_sla` | Optional dispatch SLA in days sent in listing payloads (default 2) |
| Product attribute `flipkart_fsn` | The FSN from step 2, set per product in the Channel requirements panel — the listing attaches to this catalogue product |

## Verify

Connect the channel in the dashboard, switch it to **Live**, and hit **Test**. The health check mints an OAuth token at `/oauth-service/oauth/token` (`grant_type=client_credentials&scope=Seller_Api`) — green means the Application ID/Secret are valid. It does not validate listing payloads for your vertical: push one product and watch the job log, since Flipkart returns per-SKU FAILURE entries (with its own attribute errors) inside an HTTP 200 and the connector surfaces them as validation errors.

## Notes & limits

- **Costs**: registration and API access are free — no subscription, deposit, or API fee. Flipkart deducts commission, fixed/closing fees, and shipping fees from settlements; holding a GSTIN is effectively required for most categories.
- **Rate limits**: none documented. Flipkart's documented cap is batch size — at most 10 SKUs per listing create/update call (the connector sends one per call). The manifest's requests-per-second numbers are self-imposed.
- **Catalogue**: product creation, QC and brand approval happen in Seller Hub, not the API. A listing write for a SKU whose `flipkart_fsn` is missing or wrong fails validation.
- **Tokens**: access tokens last ~60 days and refresh tokens ~180; the connector caches and renews automatically — never hardcode a token.
- **Orders**: the connector pulls pre-dispatch shipments (states APPROVED, PACKING_IN_PROGRESS) via `POST /sellers/v3/shipments/filter`, up to 10 pages per sync. That response carries orders, items and prices but no buyer contact details — addresses and labels stay in Seller Hub and the label flows.
- **Doc inconsistency to watch**: Flipkart's price-update page spells the field `sellingPrice` while the create schema uses `selling_price`; the connector sends `selling_price`. If sandbox price updates fail validation, this casing is the first suspect, along with the `fulfillment`/`packages` sub-shapes the docs do not publish.
- **Hard rule**: never hand self-access credentials to a third party — Flipkart deactivates seller accounts for it.
