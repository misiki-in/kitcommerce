# Zepto — going live

> Connector `zepto` · Seller ID + optional API key (no self-serve issuance) · Last verified against official docs: 2026-08-27

Zepto has no public seller API and no self-serve onboarding. Brands apply through an interest form, are curated by category managers, and then supply stock against automatically generated purchase orders. Expect roughly 4–6 weeks from application to first live SKU. OpenCommerce's connector endpoint mapping stays parked until Zepto's integration team provisions an integration for your brand.

## Before you start

Have ready:

- GST certificate (mandatory) and PAN card
- FSSAI licence for food / beverage / dairy / grocery products
- Business registration certificate
- Active bank account plus a cancelled cheque, and the authorized signatory's signature
- Trademark certificate (brand owners), or a brand-authorisation letter / NOC on the brand owner's letterhead (distributors)
- Warehouse address proof
- For the catalogue: images, MRP, HSN codes, shelf life, and GS1-standard barcodes for every SKU

## Steps

### 1. Submit the brand interest form

Go to https://brands.zepto.co.in/ ("Zepto - Partners") and fill the interest form: contact person, phone, official email, Manufacturer vs Distributor, brand name, product category, entity type, turnover range. This form is Zepto's first filter; the parallel route is direct outreach to Zepto's category buying team. You receive nothing immediately — a category-team callback comes only if you are shortlisted.

### 2. Category evaluation and commercial negotiation

Zepto's category team assesses category demand, supply capability and brand fit, then negotiates commission and terms. Review takes about 15–30 business days (~15 if shortlisted). You receive a named category manager — your permanent point of contact for everything that follows.

### 3. Document verification

Submit the document set from "Before you start". You receive an onboarded brand account.

### 4. Choose your supply model

- **Zepto-Fulfilled** — bulk inventory into Zepto's warehouse; they pick, pack and deliver (storage fees apply).
- **Seller-Supplied Replenishment** — you hold stock and fulfil Zepto's dark stores against demand-driven purchase orders.

### 5. Catalogue setup and SKU approval

Upload the catalogue with images, MRP, HSN and shelf life; GS1-standard barcodes are expected. SKU approval runs 3–10 business days per SKU. You receive live SKUs and access to the brand dashboard.

### 6. Operate — and connect an enabler if you want automation

Track sales and stock per dark store, pricing, promotions and settlements in the brand dashboard; purchase orders arrive via portal and email. For OMS automation connect an enabler — Unicommerce, EasyEcom or Vinculum. The Unicommerce route works by auto-forwarding Zepto's PO emails to partner-int@unicommerce.com once their team approves the forwarding; there is no live API underneath any of these.

## What goes where

| Field | Where the value comes from |
| --- | --- |
| Seller ID | The vendor/brand code Zepto assigns during onboarding — it appears on purchase orders and in the brand dashboard. Ask your category manager; no self-serve page shows it. |
| API Key *(optional)* | Leave empty. Zepto has no public seller API or developer portal; fill this only if Zepto's integration team has provisioned a key for you (done under NDA, by hand). |
| Extra config `locations` | JSON array of the dark-store codes Zepto assigned you, e.g. `["BLR-KOR-01", "BLR-IND-02"]`. |
| Extra config `allocation` | `"mirror"` (default — every store sees the full quantity; correct when stores draw on one shared warehouse) or `"split"` (divide evenly across stores, remainder to the first). |

Connect the channel in the dashboard and press **Test** once credentials are provided by Zepto's integration team.

## Notes & limits

- "Orders" from Zepto are B2B purchase orders replenishing dark stores — SKU codes, quantities, delivery dates and destination stores. You never receive end-customer names or phone numbers.
- Registration and application are free. Commissions are negotiated per category (no public rate card; guides commonly cite low-teens to mid-twenties percent all-in). Storage fees apply for Zepto-fulfilled inventory.
- Declared MRP must match the MRP printed on the pack, per Legal Metrology rules.
- Onboarding is fully curated: the interest form is a lead filter, and category managers gate selection, commercials and SKU approval. There is no developer program and no sandbox.
- Do not confuse this with the "Zepto API" at github.com/zeptofs — that is Zepto Payments, an Australian payments company with no relation to Zepto quick commerce India.
