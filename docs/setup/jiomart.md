# JioMart — going live

> Connector `jiomart` · Credentials issued by your category manager · Last verified against official docs: 2026-08-27

JioMart seller registration is free and takes roughly one to two weeks
end-to-end, but API access is entirely category-manager mediated: there is no
developer portal, no public docs, and no self-serve keys. Expect your manager
to route you through an approved integrator, and expect every endpoint detail
(host, headers, field names) to come from JioMart's integration team rather
than from anything public.

## Before you start

- GST certificate and GSTIN, PAN, and business registration documents.
- Bank account with a cancelled cheque, plus address proof.
- A product catalogue ready to upload.
- A decision brewing on fulfilment: seller-fulfilled vs Jio fulfilment.

## Steps

### 1. Register as a JioMart seller

Sign up on the JioMart seller portal — the login is
<https://identity.seller.jiomart.com/>. Submit GST certificate & GSTIN, PAN,
business registration documents, bank account with cancelled cheque, address
proof, and your product catalogue. Typical timeline: verification 2–5 days,
approval 3–7 days, activation 1–2 days.

### 2. Know the contact points

Not yet registered: **seller.onboarding@jiomart.com**. Registered sellers:
**Seller.Support@jiomart.com**, writing from the registered email ID.

### 3. Request integration credentials

Reach out to your assigned JioMart **category manager** and ask for
API/connector credentials — the same ones OMS connectors (Unicommerce,
Vinculum) use. JioMart supports order sync, facility-wise inventory sync and
catalog sync through these credentials. The exact field names JioMart uses
are not publicly documented; take what the credential handover calls them.

### 4. Choose your fulfilment model

Decide seller-fulfilled vs Jio fulfilment during onboarding — the connector's
`fulfilment_model` required attribute mirrors this choice.

## What goes where

| Field | Where the value comes from |
| --- | --- |
| Seller ID | Visible in the JioMart seller portal after approval |
| API Key | Issued by your JioMart category manager (step 3) — match whatever the credential email calls it |
| Extra config `baseUrl` | The API host JioMart's integration team names — required, since nothing about JioMart's API transport is public |
| Extra config `extraHeaders` | Whatever headers the shared spec demands — the connector's built-in header names are a guess |

## Verify

In the dashboard, connect the `jiomart` channel, switch mode to **Live**, and
hit **Test**. The health check calls `GET {baseUrl}/v1/seller/profile` — a
sketch path; a 404 with correct credentials means the paths in
`src/lib/server/connectors/india.ts` need correcting against the spec you
were sent.

## Notes & limits

- Zero registration/onboarding fee; commission runs 1–15% by category, plus
  fixed and shipping fees per order.
- API access has no public program: everything flows through the category
  manager, who may insist on an approved integrator in the middle.
- Inventory is facility-wise — the connector's pack size, fulfilment model
  and shelf-life required fields mirror JioMart's grocery-centric listing
  gates.
