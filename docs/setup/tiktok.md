# TikTok Shop — going live

> Connector `tiktok` · HMAC-signed requests + OAuth shop authorization · Last verified against official docs: 2026-08-27

Going live needs three things: a verified TikTok Shop **seller account** in a market where TikTok Shop operates, a **Partner Center developer app** (which gives you the App Key and App Secret), and a one-time **shop authorization** in which the seller approves your app and you exchange the resulting code for tokens. All of it is self-serve and free, but each stage has a wait: seller verification takes a few days, and app review (for public apps) takes roughly 2–3 business days. One hard gate up front: **TikTok is banned in India** (since June 2020, still enforced), TikTok Shop has no India market, and India is not an eligible cross-border origin — a seller with only an Indian entity cannot complete step 1 at all.

## Before you start

- A legal entity (or personal registration, where allowed) in an operating market. As of mid-2026 TikTok Shop runs in: **US, UK, Ireland, Spain, France, Germany, Italy, Mexico, Brazil, Japan, Indonesia, Malaysia, Thailand, Vietnam, Philippines, Singapore**, with Netherlands/Belgium/Poland announced for H2 2026. Each market needs its own shop registration and generally a local entity, unless you qualify for a cross-border program (e.g. US→Mexico, Australia→US/UK, China/HK→several markets).
- Verification documents: business licence or personal ID, and a bank account — the name must match across ID, business documents, and bank account. US sellers additionally need an EIN or SSN, a US bank account, and a US address/phone.
- Know that the Partner Center **business region is chosen once at signup and cannot be changed**. The US market has a separate partner portal; if you serve both the US and other markets you need accounts on both.

## Steps

### 1. Create the seller account

Register in your market's Seller Center: US at https://seller-us.tiktok.com, UK at https://seller-uk.tiktok.com, Southeast Asia and cross-border at https://seller.tiktokglobalshop.com. Upload the documents listed above. **You receive:** a verified seller account, typically after a few days.

### 2. Register as a developer on Partner Center

Sign up at https://partner.tiktokshop.com/account/sign-up (global markets) or https://partner.us.tiktokshop.com (US market). Pick your business region carefully — it is one-time. Choose the **App Developer** role, not Service Provider (that role is for agencies managing other sellers' shops). **You receive:** a Partner Center developer account.

### 3. Create the app and mint App Key / App Secret

In Partner Center open **App & Service** in the left menu and create an app. Choose **Custom App** if it will only ever connect your own shop(s) — it avoids App Store review and can be converted to Public later — or **Public App** to list on the TikTok Shop App Store (review ~2–3 business days). Enable API access, set your OAuth redirect URL (any URL you control; you only need to read the `code` query parameter off it once), and enable at minimum these API scopes via the search bar: **Shop Authorized Information**, **Product Basic**, **Order Information**. Partner Center also offers Development (sandbox) Shops if you want to exercise the API before touching the live shop. **You receive:** App Key, App Secret, and Service ID on the app's detail page.

### 4. Authorize the shop

Generate the authorization link: for App Store (public) apps it is `https://services.tiktokshop.com/open/authorize?service_id={your Service ID}` (US-market variant: `https://services.us.tiktokshop.com/open/authorize?service_id=...`); for Custom apps, Partner Center shows a link of the form `https://auth.tiktok-shops.com/oauth/authorize?app_key=...&state=...`. Open it, log in with the **seller** account, and approve the requested scopes. TikTok redirects to your redirect URL with an auth code. **You receive:** an auth code that is **single-use and expires in 30 minutes** — do step 5 immediately.

### 5. Exchange the code for tokens

```
GET https://auth.tiktok-shops.com/api/v2/token/get?app_key={app_key}&app_secret={app_secret}&auth_code={code}&grant_type=authorized_code
```

**You receive:** `data.access_token` and `data.refresh_token` with their expiry times. The access token expires on the order of days; paste the refresh token into OpenCommerce as well and the connector renews the access token automatically at `https://auth.tiktok-shops.com/api/v2/token/refresh`.

### 6. (Optional) Shop cipher and shop ID

Shop-scoped API calls carry a per-shop `shop_cipher`. The connector fetches it automatically on first use via a signed `GET https://open-api.tiktokglobalshop.com/authorization/202309/shops` and caches it, so you can leave both fields blank. Fill in **Shop ID** only if your app is authorized for more than one shop (the values are in that same response: `data.shops[].id` and `data.shops[].cipher`, and the ID is also visible in Seller Center).

## What goes where

| Field (connect form) | Where it comes from |
| --- | --- |
| App Key | Partner Center → App & Service → your app's detail page |
| App Secret | Same app detail page |
| Access Token | `data.access_token` from the token exchange in step 5 |
| Refresh Token (optional, recommended) | `data.refresh_token` from the same response — without it the connector cannot renew the access token when it expires |
| Shop Cipher (optional) | Leave blank to auto-discover; otherwise `data.shops[].cipher` from Get Authorized Shops |
| Shop ID (optional) | Only for multi-shop apps: `data.shops[].id`, or Seller Center |

| Extra config JSON key | Meaning |
| --- | --- |
| `currency` | Currency code for prices sent to TikTok. Must match the shop's market (USD for a US shop, IDR for Indonesia, …). When unset, each variant's own currency is used. |
| `tiktok_warehouse_id` | Default warehouse stock is booked against at publish; a product can override it via the `tiktok_warehouse_id` attribute. Inventory syncs follow the warehouse the product's stock is actually booked in on TikTok, falling back to this config value. When neither is set, TikTok's default warehouse is used. |

Per-product requirements (surfaced in the product form's "Channel requirements" panel): `tiktok_category_id` (a leaf from TikTok's own taxonomy — free-text categories are rejected) and `package_weight_g`.

## Verify

Connect the channel in the dashboard, switch it to **Live**, and hit **Test**. The health check makes a signed `GET https://open-api.tiktokglobalshop.com/authorization/202309/shops` — the same call that exercises the signature, the access token, and the shop grant at once. `HEALTHY` means requests are signing correctly and the authorization is intact; `AUTH_FAILURE` means the token is expired/revoked or the App Secret is wrong.

## Notes & limits

- **India:** banned since June 2020 and still enforced in 2026. No India market, no India-origin cross-border program; the only path is a genuine legal entity in an operating market.
- **Images:** TikTok only accepts images it hosts itself. The connector re-uploads every product image (capped at 9) to TikTok's Upload Product Image endpoint at publish time, so source image URLs must be publicly reachable from the OpenCommerce server. A single broken image is skipped; a product with zero uploadable images fails validation.
- **Brand:** the connector does not send a brand. TikTok's 202309 API takes only a `brand_id` resolved through its Brands API (no free-text brand name), so listings publish without brand attribution for now.
- **Tokens:** the auth code from step 4 is single-use with a 30-minute life; access tokens expire on the order of days. Supply the refresh token or expect to re-paste tokens by hand.
- **Rate limits:** roughly 50 requests/second per shop per app; the connector paces itself well below that (10 rps declared).
- **Order data:** order search filters use unix seconds (`create_time_ge`); the connector converts and paginates (up to 10 pages of 50 per sync). Recipient name, address, and phone come back on orders — that is buyer PII, subject to TikTok's data-protection terms; buyer contact details are masked by TikTok.
- **Fees:** seller registration, Partner Center, and API access are free. TikTok takes a per-market, per-category commission on each sale (single-digit percent), and one 2026 guide reports that from July 2026 sellers must allocate 1.5–5% of sales revenue to GMV Max advertising campaigns.
- **Docs caveat:** the official Partner Center reference (https://partner.tiktokshop.com/docv2) is JS-rendered; the connector's request shapes were verified against a working signed example and maintained open-source clients on 2026-08-27.
