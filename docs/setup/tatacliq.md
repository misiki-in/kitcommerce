# Tata CLiQ — going live

> Connector `tatacliq` · Seller ID + slave-account username/password + Slave ID · Last verified against official docs: 2026-08-27

Tata CLiQ is fully curated: onboarding starts with an email inquiry, runs
through document verification (including brand authorisation checked directly
with manufacturers), and takes four to eight weeks. API access is then
switched on per account by your Account Manager — there is no public API
documentation or self-serve key page, and the credential set is unusual: your
numeric Seller ID, a slave account's panel username and password, and a Slave
ID read out of Seller Zone.

## Before you start

- You must be a brand owner, an authorised distributor, or an approved
  seller — Tata CLiQ verifies brand authorisation letters with the
  manufacturer.
- Entity names must match across PAN, GST and bank documents.
- A ₹300 stamp paper for the seller agreement.

## Steps

### 1. Send an inquiry

Email **partnersupport@tatacliq.com** with a business overview, your brand,
product categories, and existing marketplace presence.

### 2. Submit documents

Prepare: the seller agreement on ₹300 stamp paper, PAN, GSTIN certificate,
cancelled cheque or bank statement, business registration proof, trademark
certificate (brand owners) or brand authorisation letter (resellers — Tata
CLiQ verifies it directly with the manufacturer), and MSME certificate if
applicable. Approval takes 4–8 weeks.

### 3. Log in to Seller Zone

Once approved, manage catalogue and orders at
<https://sellerzone.tatacliq.com/> (an ERP variant exists at
sellerzoneerp.tatacliq.com).

### 4. Activate API access

Contact your Tata CLiQ **Account Manager** with your Seller ID and ask them to
activate API access on the account. Collect the slave account's username and
password from your SPOC (category manager). The endpoint spec arrives through
this channel too — nothing is public.

### 5. Read your Slave ID

In Seller Zone: **Slave Onboarding > Seller List View** > search. The value
shows as `SellerId-SlaveID` — the right-hand portion is the Slave ID. A
seller can have several slave IDs; match the one that belongs to the login
you were given.

## What goes where

| Field | Where the value comes from |
| --- | --- |
| Seller ID | Numeric ID provided by the Tata CLiQ team at onboarding |
| Panel username | The slave account's Seller Zone login, from your SPOC (step 4) |
| Panel password | Same handover as the username |
| Slave ID | Seller Zone > Slave Onboarding > Seller List View (step 5) |
| Extra config `baseUrl` | The API host your Account Manager shares at activation — required, since no Tata CLiQ API host is published |
| Extra config `extraHeaders` | Whatever headers the shared spec demands — the connector's header names are a sketch |

## Verify

In the dashboard, connect the `tatacliq` channel, switch mode to **Live**, and
hit **Test**. The health check calls `GET {baseUrl}/v1/seller/profile` — a
sketch path; a 404 with correct credentials means the paths in
`src/lib/server/connectors/india.ts` need correcting against the activation
handover.

## Notes & limits

- Budget 4–8 weeks for approval before any API conversation can start.
- The only documented onboarding cost is the ₹300 stamp paper; category
  commissions apply on sales.
- Brand authorisation is a hard gate — the connector's
  `brand_authorisation` required field exists because listings do not go live
  without it.
- API access is per-account and revocable by the Account Manager; if health
  checks suddenly fail with auth errors, ask your SPOC whether the slave
  account or activation changed.
