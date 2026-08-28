# AJIO — going live

> Connector `ajio` · POB User ID + API Password (account-manager-issued) · Last verified against official docs: 2026-08-27

AJIO has two gates and no public API programme at all. First you become a
supplier through Reliance Retail's registration portal (approval can take up
to 25 business days, and a brand trademark is effectively required); then you
create a POB (partner/integration) user in Seller Central and ask your AJIO
account manager to issue its API password. The API spec and host arrive with
those credentials, never publicly.

## Before you start

- GST certificate and PAN card for the business.
- A brand trademark certificate — AJIO is brand-led.
- Bank details; MSME certificate optional.
- Patience: verification and approval take up to 25 business days.

## Steps

### 1. Register as an AJIO seller

Apply on the Reliance Retail supplier registration portal:
<https://supplierregistration.ril.com/>. Enter your PAN, upload the GST
certificate, PAN card, brand trademark certificate, bank details, and
optionally an MSME certificate. You receive Seller Central access once AJIO
approves the application.

### 2. Access AJIO Seller Central

Log in at <https://seller.ajio.com/> with your registered email + password +
OTP. Listings, orders, inventory, payments and reports are managed here.

### 3. Create a POB user

In Seller Central go to **Account > Modify Account Details** and register a
POB user. You receive a **POB User ID** — alphanumeric, starting with `DV`.

### 4. Request the POB API credentials

Follow up with your AJIO account manager or designated POC to have the **API
Password** issued for the POB user; approval takes days. There is no
self-serve API portal — the endpoint spec (including the API host) is shared
along with the credentials.

## What goes where

| Field | Where the value comes from |
| --- | --- |
| POB User ID | Created in Seller Central under Account > Modify Account Details (starts with `DV`) |
| API Password | Issued for the POB user by your AJIO account manager (step 4) |
| Extra config `baseUrl` | The API host from the credential handover — required, since no AJIO API host is public anywhere |
| Extra config `extraHeaders` | Whatever headers AJIO's shared spec demands — the connector's built-in header names are a sketch |

## Verify

In the dashboard, connect the `ajio` channel, switch mode to **Live**, and hit
**Test**. The health check calls `GET {baseUrl}/v1/seller/profile` — a sketch
path; a 404 with correct credentials means the paths in
`src/lib/server/connectors/india.ts` need correcting against the spec AJIO
sent you.

## Notes & limits

- No registration fee is documented, but a brand trademark certificate is
  effectively required to onboard.
- Seller approval alone can take ~25 business days; the API password is a
  separate, account-manager-mediated wait.
- AJIO publishes no API documentation, no rate limits, and no endpoints — the
  connector's entire live transport is a flagged sketch until your credential
  email fills the blanks.
- Fashion catalogue gates mirror the connector's required fields: article
  type, gender, colour family, fabric.
