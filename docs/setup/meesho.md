# Meesho — going live

> Connector `meesho` · merchant/security/timestamp headers (integration-team-issued) · Last verified against official docs: 2026-08-27

Meesho supplier registration is free and self-serve, but API access is not:
credentials are issued by hand by Meesho's integration team, reached by email
— usually with an approved OMS partner alongside — and the API reference
itself arrives in that same reply. Expect the credential round-trip to take
24–48 hours once your supplier account exists. The Supplier Panel login is
OTP-only; there is no password anywhere in this flow.

## Before you start

- A GSTIN and a bank account — both are validated during supplier
  registration.
- Your registered Supplier Panel email address: Meesho's integration team
  only acts on requests sent from it.
- If you sell from multiple locations, a list of your selling-location
  identifiers (`external_identifier` per location) — each gets its own
  activation.

## Steps

### 1. Register on the Supplier Panel

Sign up at <https://supplier.meesho.com/>: mobile OTP verification, business
email, GSTIN validation, bank account details, pickup address, profile
completion. Login stays OTP-based — no password exists.

### 2. Request API credentials

Email **meesholink-integration@meesho.com** from your Meesho-registered email
with: your legal business name, the Supplier Panel email, contact details, a
statement of which system you are integrating (OpenCommerce), and your
selling-location identifier(s). Integrations are usually initiated jointly
with an approved OMS partner (Unicommerce, EasyEcom, Fynd, Vinculum).
Response typically arrives within 24–48 hours.

### 3. Receive credentials

Meesho's reply carries a **Merchant/Client-id**, a **Secret-key**, your
**Supplier Identifier**, and an initial **refresh token per location**
(multi-location suppliers get one per `external_identifier`; tokens are
unique per location and required for activation). The API documentation comes
attached to this reply — it is not published anywhere.

### 4. Point at the right environment

Test against `https://merchant.meeshotest.in`, go live against
`https://merchant.meesho.com`. Auth parameters travel as request headers:
`merchant`, `security`, `timestamp`, and `supplier_identifier` (the last is
compulsory only for aggregators).

## What goes where

| Field | Where the value comes from |
| --- | --- |
| Client ID (`api_key`) | The Client-id in Meesho's onboarding reply (step 3) — sent as the `merchant` header |
| Secret key (`api_secret`) | The Secret-key from the same reply — sent as the `security` header |
| Supplier / Merchant Identifier (`supplier_id`, optional) | The Supplier Identifier from the reply; needed for aggregators / multi-location accounts, sent as `supplier_identifier` |
| Extra config `{"sandbox": true}` | Routes calls to merchant.meeshotest.in — use the credentials Meesho issued for test |

## Verify

In the dashboard, connect the `meesho` channel, switch mode to **Live**, and
hit **Test**. The health check calls `GET
https://merchant.meesho.com/v1/supplier/profile` — a sketch path: Meesho's
real surface is operation-named (e.g. "Get Shipment Order Details"), so
expect to correct paths in `src/lib/server/connectors/meesho.ts` against the
documentation Meesho emailed you.

## Notes & limits

- Supplier registration is free, with a 0% commission model on most
  categories; no API fees are documented.
- Two details stay unverified until your onboarding email settles them:
  whether the `security` header wants the raw secret or a timestamped digest,
  and the timestamp format (the connector sends epoch seconds until told
  otherwise).
- Per-location refresh tokens are not yet modelled by the connector — if you
  activate multiple locations, keep the tokens from step 3 somewhere safe.
- The Supplier Panel is OTP-only: any tool asking for a Meesho password is
  scraping the panel, which is fragile and against Meesho's terms.
