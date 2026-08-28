# Myntra — going live

> Connector `myntra` · Merchant ID + Secret Key headers (partner-issued) · Last verified against official docs: 2026-08-27

Myntra is a curated fashion marketplace: becoming a seller is free but gated on
category/brand approval, and API access is switched on by your Myntra account
manager (or via a Developer Centre registration request) rather than minted in
a portal. The PPMP API surface is publicly documented at
mmip.myntrainfo.com, but the API host itself is only revealed after developer
registration — budget days-to-weeks for seller approval plus another round-trip
for API enablement.

## Before you start

- A registered business entity and an active GSTIN.
- Products in a category Myntra accepts: apparel, footwear, accessories,
  beauty, jewellery, bags, home decor. Nothing else gets in.
- Brand documentation — Myntra is brand-led and curates who may sell what.
- There is **no onboarding fee**. Myntra explicitly warns that anyone asking
  for one is a scam.

## Steps

### 1. Register as a seller/brand

Go to <https://partners.myntrainfo.com/> and click **Register Now** — verify
your mobile via OTP, then add your organisation email. Myntra's category team
reviews the application. You receive a seller account once approved.

### 2. Operate from the Partner Portal

The seller panel is <https://partnerportal.myntra.com/> — catalogue, orders and
**Operational Reports** live here. Your **Warehouse ID** appears under
Operational Reports; note it down for the connect form.

### 3. Request API enablement

Contact your Myntra account manager and ask for PPMP APIs to be enabled on
your seller account, or submit the registration request at
<https://mmip.myntrainfo.com/registration>. Myntra then issues a
**Merchant ID** and **Secret Key** (OMS migration tickets sometimes deliver
them as Store Code / Merchant ID / Client Secret). The reply also carries the
concrete API host — the public docs never disclose it.

### 4. Read the API reference

The PPMP API V4 and Listing Management docs are public on the Developer
Centre: <https://mmip.myntrainfo.com/documentation/myntra-ppmp-api-v4> (the
endpoint details are on linked Postman documenter pages; the partner dashboard
is securemmip.myntrainfo.com).

## What goes where

| Field | Where the value comes from |
| --- | --- |
| Merchant ID | Issued when Myntra enables PPMP APIs (step 3) |
| Secret Key | Same reply/ticket as the Merchant ID |
| Warehouse ID | Partner Portal > Operational Reports (step 2) |
| Extra config `baseUrl` | The API host named in Myntra's API-enablement reply / Postman collection — required, since the public docs never publish it |
| Extra config `extraHeaders` | Any additional header the emailed spec demands (the connector already sends `x-partner-store: myntra`) |

## Verify

In the dashboard, connect the `myntra` channel, switch mode to **Live**, and
hit **Test**. The health check calls `GET {baseUrl}/v1/seller/profile` — a
sketch path, so a 404 with correct credentials means the path (not your setup)
needs correcting in `src/lib/server/connectors/india.ts` against the Postman
reference.

## Notes & limits

- **Rate limit**: inventory pushes are documented at batches of 10 with a
  ceiling of 100 requests/minute; the connector holds itself to 1.5 rps.
- **Orders are push-shaped**: PPMP v4 has Myntra calling the partner's
  Create/Update Order endpoint (integrators register a webhook token with
  Myntra), and integrator docs state there is no SKU-pull API. The connector's
  polling order import is a flagged sketch — expect to wire an inbound
  receiver instead.
- No onboarding fee or deposit; category commissions apply on sales.
- Apparel and footwear cannot go live without a mapped size chart — the
  connector's required fields (article type, gender, size chart ID, fabric,
  wash care) mirror Myntra's listing gates.
