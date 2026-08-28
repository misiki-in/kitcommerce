# Meta (Facebook & Instagram) — going live

> Connectors `facebook` and `instagram` · System-user access token (`catalog_management` + `business_management`) · Last verified against official docs: 2026-08-27

Both connectors write the same Meta Product Catalog over the Graph API, so this is one setup done once: the same `catalog_id` and `access_token` go into both connect forms. Everything is free and self-serve — Business Manager, Commerce Manager, the developer app and the Catalog API have no fees and no partner program — and the clicking takes an hour or two. The one wait you cannot skip is Meta's shop review (typically a few days, sometimes with business verification). One reality to plan around: Meta removed native checkout globally between June and August 2025, so every purchase now completes on **your own website** — each product's `landing_url` — and no orders ever exist on Meta. Both connectors declare `orderImport: false`; this integration is catalogue sync, and only catalogue sync.

## Before you start

- A personal Facebook profile that can create (or already administers) a **Facebook Page** for the shop — create one at https://www.facebook.com/pages/create if none exists.
- Your **own e-commerce site**: checkout happens there, and every product needs a working landing page URL (the connector's required `attributes.landing_url`).
- For Instagram: an Instagram account you are willing to switch to a **Professional (Business)** account.
- Legal business details on hand in case Meta asks for business verification during shop review.

## Steps

### 1. Create a Meta Business Portfolio

Log in at https://business.facebook.com/overview and create a business portfolio (a Business Manager account): business name, your name, work email. You receive the portfolio that will own the catalogue, the app and the system user.

### 2. Create a catalogue in Commerce Manager

Open https://business.facebook.com/commerce/, confirm the correct business portfolio is selected in the left menu, click **Add products / Create catalogue**, choose type **E-commerce**, pick the portfolio as owner and name the catalogue. You can leave it empty — the API sync will fill it. You receive: a catalogue.

### 3. Find the Catalog ID

In Commerce Manager select the catalogue and open its **Settings** tab — the Catalog ID is shown there, and it also appears in the browser URL (`business.facebook.com/commerce/catalogs/{catalog_id}/...`). You receive: `catalog_id`.

### 4. Create a Meta app

At https://developers.facebook.com/apps click **Create App**, choose the **Business** use case / app type, and connect it to the portfolio from step 1. No App Review is needed — Standard Access to `catalog_management` is enough to manage a catalogue owned by the same business as the app. You receive: an app the token will be minted against.

### 5. Create a system user

In Business Settings (https://business.facebook.com/settings) go to **Users → System users → Add**. Role **Admin** is simplest (Admin system users can reach all business assets); if you choose **Employee**, you must explicitly grant assets under **Assign assets** — give the app *Manage app* and the catalogue *Manage catalogue*. You receive: a system user.

### 6. Generate the permanent access token

On the system user's row click **Generate new token**: select the app from step 4, set token expiration to **Never**, and tick the scopes **`catalog_management`** and **`business_management`** (`catalog_management` lists `business_management` as a dependency). The token is shown **once** — copy it immediately. You receive: `access_token`.

### 7. Find the Business ID

Business Settings → **Business info** shows the portfolio's ID; it is also the `business_id` parameter in the Business Settings URL. You receive: `business_id`. (The connect form marks it optional — catalogue calls never send it — but it is worth recording as the identity the token belongs to.)

### 8. Create the Facebook Shop and connect the catalogue

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

No Extra config JSON keys are needed for the Meta connectors (`mockOrderSkus` and `mockFailureRate` are mock-mode-only knobs shared by all connectors).

## Verify

Connect the channel in the dashboard, switch it to **Live**, and hit **Test**. The health check does `GET /{catalog_id}` on `graph.facebook.com/v26.0` — a healthy result means the token can see the catalogue. Then publish one product and check it appears in Commerce Manager → catalogue → Items (batch writes are asynchronous; allow a minute).

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
