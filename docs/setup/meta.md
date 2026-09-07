# Meta (Facebook & Instagram) — going live

> Connector `meta` (and legacy `facebook`, `instagram`) · Easy Connect OAuth (App ID & Secret) or System-user access token (`catalog_management` + `business_management`) · Last verified against official docs: 2026-08-27

Facebook Shop and Instagram Shopping share the exact same Meta Product Catalog over the Graph API. The unified `meta` connector synchronizes your canonical products, prices, variants, and stock levels to that shared catalogue in a single place.

You can connect in two ways:
1. **1-Click Easy Connect**: Enter your Meta App ID & App Secret from Meta for Developers to automatically grant permissions, exchange tokens, and auto-discover your catalogues.
2. **System User Token (Manual)**: Provide a System User Access Token and Catalog ID from Business Settings and Commerce Manager.

## Quick Connection Options

### Option A: Easy Connect (Recommended)
1. In [Meta for Developers](https://developers.facebook.com/apps), create or open your Business App.
2. Copy your **App ID** and **App Secret** (from App Settings → Basic).
3. Under **Facebook Login → Settings**, add your callback URI (e.g. `http://localhost:5173/auth/meta/callback`).
4. In OpenCommerce, click **Connect Meta**, enter your App ID & App Secret, and click **Connect with Meta**.
5. Approve the consent dialog — your access token is generated, 60-day refreshable tokens are stored, and catalogues are auto-discovered!

### Option B: Manual Setup with System User Token

Follow steps 1–7 below to manually mint a permanent system-user token.

## Steps

### 1. Create a Meta Business Portfolio
Log in at https://business.facebook.com/overview and create a business portfolio (a Business Manager account).

### 2. Create a catalogue in Commerce Manager
Open https://business.facebook.com/commerce/, click **Add products / Create catalogue**, choose type **E-commerce**, pick the portfolio as owner and name the catalogue.

### 3. Find the Catalog ID
In Commerce Manager select the catalogue and open its **Settings** tab — the Catalog ID is shown there (`catalog_id`).

### 4. Create a Meta app
At https://developers.facebook.com/apps click **Create App**, choose the **Business** use case / app type, and connect it to your business portfolio.

### 5. Create a system user
In Business Settings (https://business.facebook.com/settings) go to **Users → System users → Add** with role **Admin**.

### 6. Generate the permanent access token
On the system user's row click **Generate new token**: select the app from step 4, set token expiration to **Never**, and tick the scopes **`catalog_management`** and **`business_management`**. Copy the token (`access_token`).

### 7. Find the Business ID
Business Settings → **Business info** shows the portfolio's ID (`business_id`).

### 8. Connect Facebook & Instagram Shops
In Commerce Manager, connect your Facebook Page and Instagram Professional Account to the shared catalogue.

## What goes where

| Connect-form field | Where the value comes from |
| --- | --- |
| `app_id` (optional) | Meta for Developers → App settings → Basic (App ID) |
| `app_secret` (optional) | Meta for Developers → App settings → Basic (App Secret) |
| `catalog_id` (optional) | Commerce Manager → catalogue → **Settings** tab, or auto-discovered |
| `access_token` | Business Settings → System users → Generate new token, or generated via 1-Click Connect |
| `business_id` (optional) | Business Settings → **Business info**; auto-discovered |

In Commerce Manager create a **Shop**, select the Facebook Page as the sales channel, pick the catalogue, and choose checkout on **your website** (the only option since native checkout was phased out mid-2025). Submit the shop for review. Approval typically takes a few days, and Meta may require business verification (Business Settings → **Security Centre**, legal documents).

### 9. Instagram Shopping (skip if you only want Facebook)

1. In the Instagram app: **Settings → Account type and tools → Switch to professional account** (Business). A personal account cannot be connected to a shop. (Help: https://help.instagram.com/502981923235522)
2. In Business Settings → **Accounts → Instagram accounts**, add the professional account to the portfolio, and connect it to the Facebook Page (Page settings → Linked accounts, or during shop creation).
3. In Commerce Manager, open the shop and add the Instagram account as a **sales channel** alongside the Page, confirming the same catalogue.
4. Submit for **Shopping review** from Commerce Manager (or in the Instagram app: Settings → Business → Set up shopping). Meta checks the connected Page, your domain, and that the catalogue holds real products with working links; approval takes a few days.
5. After approval, **Tag products** appears in the Instagram composer for posts, reels and stories. Tags open the product detail and send the buyer to its `landing_url` to pay.

The API happily writes the catalogue before review passes — nothing is *shoppable* until it does.

### 10. Smoke-test the credentials

```
GET https://graph.facebook.com/v26.0/{catalog_id}?access_token={token}
```

should return the catalogue's id and name. This is exactly the call the connector's health check makes.

## What goes where

The same values work for both connectors; paste them into each connect form you use.

| Connect-form field | Connector(s) | Where the value comes from |
| --- | --- | --- |
| `catalog_id` | facebook, instagram | Commerce Manager → catalogue → **Settings** tab, or the `/commerce/catalogs/{id}/` URL (step 3) |
| `business_id` (optional) | facebook, instagram | Business Settings → **Business info** (step 7); informational — catalogue calls never send it |
| `access_token` | facebook, instagram | Business Settings → **System users → Generate new token**, expiry *Never*, scopes `catalog_management` + `business_management` (step 6); shown once |

No Extra config JSON keys are needed for the Meta connectors.

## Verify

Connect the channel in the dashboard and hit **Test**. The health check does `GET /{catalog_id}` on `graph.facebook.com/v26.0` — a healthy result means the token can see the catalogue. Then publish one product and check it appears in Commerce Manager → catalogue → Items (batch writes are asynchronous; allow a minute).

## Notes & limits

- **Costs**: none. No API, catalogue, or platform fees. The real cost is running your own checkout-capable website.
- **No orders, anywhere**: Meta removed native checkout globally (June–August 2025); shops remain, but purchases complete on the seller's site, so there is nothing to import and `orderImport: false` is permanent until Meta reintroduces on-platform checkout. Order-management endpoints still documented by Meta are legacy.
- **Approval waits**: shop review takes a few days; Instagram Shopping review is a second, account-level review. Business verification can add more days — start it early if asked.
- **Rate limits**: catalogue batch calls are budgeted per catalogue per minute (roughly `8 + 8·log2(unique users seeing your items)`), and throttling arrives as Graph error codes 4 / 17 / 613 / 80014 in the response body, not HTTP 429. The connector detects these and backs off using the `X-Business-Use-Case-Usage` header's `estimated_time_to_regain_access`.
- **Batch size**: `items_batch` accepts up to 5,000 requests per call (28 MB payload cap) — far above what the sync planner sends.
- **Asynchronous writes**: `items_batch` returns job handles; the connector makes one status check (~2 s later) and surfaces per-item rejections as validation errors. Items are addressed by retailer id (your SKU) on every subsequent write.
- **Version clock**: the connector pins Graph API **v26.0**. Meta expires each version roughly two years after release (v21.0 expires 2027-01-21), so expect to bump the pin — a one-line change in `social.ts` — about once a year.
- **PII**: none flows through this integration — it is catalogue-only, and no customer data exists on Meta's side to fetch.
- **Scopes**: keep the token to `catalog_management` + `business_management`. A leaked token cannot touch ads or pages it was never scoped to; rotate it from the same System users screen if in doubt.
