# Nykaa — going live

> Connector `nykaa` · API Username + API Password + Seller ID (Nykaa-issued) · Last verified against official docs: 2026-08-27

Nykaa is brand-curated with no open signup: you apply as a brand, Nykaa's
category team approves you and creates a vendor login by hand, and only then
do API credentials exist — an API Username and Password plus your Seller ID,
found in the seller panel's API integration settings or handed over by the
Nykaa team. There are no public API docs and no published API host, so the
final endpoint details come from Nykaa's integration team.

## Before you start

- A brand with legal documents in order: GST registration and brand
  documentation.
- A product catalogue Nykaa's beauty/fashion category team will want to
  review.
- Commercial terms (commission) are negotiated during onboarding — there is
  no rate card to self-select.

## Steps

### 1. Apply to sell on Nykaa

Submit your brand profile, catalogue and legal documents through Nykaa's
Sell-on-Nykaa flow — the acknowledgement page is
<https://www.nykaa.com/ackson>. There is no self-serve signup: after
commercial terms are agreed, Nykaa creates a vendor user against your
registered business email and emails an invitation to set a password.

### 2. Log in to the Nykaa Seller Portal

Once provisioned, log in at <https://seller.nykaa.com/login> (business email +
password, OTP where enabled). Modules cover catalogue, purchase orders,
returns, payments and reports.

### 3. Get API credentials

Ask your Nykaa category/account contact for API access, or look in the seller
panel under **API integration settings**. You receive an **API Username**, an
**API Password**, and your **Seller ID** — plus **Child Seller IDs** if you
run sub-accounts.

### 4. Support channel

Vendor issues — expired invites, deactivated users, or landing in the wrong
portal for your model — go through <https://vendorsupport.nykaa.com/>.

## What goes where

| Field | Where the value comes from |
| --- | --- |
| API Username | Seller panel API integration settings, or the Nykaa team (step 3) |
| API Password | Same source as the username |
| Seller ID | Issued at vendor onboarding; visible in the seller panel |
| Child Seller ID (optional) | Only for sub-accounts under a parent seller |
| Extra config `baseUrl` | The API host Nykaa's integration team gives you — required, since no Nykaa API host is public |
| Extra config `extraHeaders` | Whatever headers Nykaa's real spec demands — the connector's header names are a sketch |

## Verify

In the dashboard, connect the `nykaa` channel, switch mode to **Live**, and
hit **Test**. The health check calls `GET {baseUrl}/v1/seller/profile` — a
sketch path; a 404 with correct credentials means the paths in
`src/lib/server/connectors/india.ts` need correcting against what Nykaa
shared.

## Notes & limits

- Nykaa runs distinct **marketplace** and **wholesale/B2B** models —
  credentials are model-specific, so make sure you were onboarded to (and are
  holding credentials for) the marketplace model.
- No public registration fee; commission is agreed during brand onboarding.
- Beauty compliance drives the connector's required fields: declared shelf
  life, full INCI ingredient list, and a cruelty-free declaration — listings
  without them are rejected.
