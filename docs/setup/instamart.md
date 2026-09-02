# Swiggy Instamart — going live

> Connector `instamart` · Partner ID + optional client credentials (no self-serve issuance) · Last verified against official docs: 2026-08-27

Instamart is a curated, category-manager-run marketplace: you apply via a registration form or by emailing a brand deck, negotiate commercials, get documents and catalogue approved, then dispatch stock to assigned dark stores against purchase orders. Brands typically go live in 15–25 business days. There are no API credentials to collect — Swiggy has no public developer program for Instamart — so OpenCommerce's connector endpoint mapping stays parked until Swiggy's integration team provisions an integration for your brand.

## Before you start

Have ready:

- GST registration certificate
- FSSAI licence (mandatory for food)
- PAN and company incorporation documents
- Cancelled cheque
- Brand trademark certificate, or an authorization letter if you are a distributor
- Product test reports and an MRP/pricing sheet
- Product images at minimum 1000×1000 px and HSN codes for every SKU

Know your portals: https://partner.swiggy.com is Swiggy's **restaurant** partner surface — not for Instamart brands. The Instamart surfaces are https://www.swiggy.com/instamart-partner (registration) and https://partner.instamart.in (the Brand Portal).

## Steps

### 1. Apply as an Instamart brand (days 1–3)

Fill the registration form at https://www.swiggy.com/instamart-partner — business entity name, product categories, monthly volume estimates, contact details — **or** email your brand deck to instamart-brands@swiggy.in. Agency referral is a third route. You receive a response from the category team if there is a fit.

### 2. Category evaluation (days 3–7)

An Instamart category team assesses category demand, brand equity and supply-chain capability. You receive a named Category Manager who stays involved permanently. There is no open self-serve listing — "Instamart does not allow open seller access".

### 3. Commercial terms (days 7–10)

Negotiate commission (typically 15–25%; 8–28% across categories), marketing development fund (MDF) and payment cycles.

### 4. Document verification (7–15 working days)

Submit the document set from "Before you start". You receive an approved brand account.

### 5. Catalogue setup in the Brand Portal (days 10–15)

Upload SKUs with titles, descriptions, HSN codes and images (min 1000×1000 px) in the Instamart Brand Portal at https://partner.instamart.in (partner.swiggy.com/instamart redirects there). You receive live listings pending stock.

### 6. Dark-store integration and soft launch (days 20–25)

Dispatch inventory to your assigned dark stores (550+ nationally) against purchase orders, book inwarding appointments, and keep roughly 3 weeks of buffer stock per location. Soft launch and metric monitoring follow.

### 7. Optional: OMS automation via an enabler

For automated PO and inventory handling, use an integration enabler operating under its own partner agreement with Swiggy: Unicommerce (claims API-level Instamart integration including ASN push at enterprise tier), Vinculum eRetail WMS, Eshopbox, or AtomIQ. There is no self-serve developer API, and Swiggy Minis — the old zero-commission D2C storefront — was shut down on 2025-08-10 and is not a route.

## What goes where

| Field | Where the value comes from |
| --- | --- |
| Partner ID | The vendor/brand code Swiggy assigns during onboarding — visible on purchase orders and in the Brand Portal. Ask your Category Manager; nothing labelled "Partner ID" is self-servable. |
| Client ID *(optional)* | Leave empty. Swiggy has no public OAuth/developer program for Instamart sellers; enabler platforms hold integration credentials under their own Swiggy partnerships. |
| Client Secret *(optional)* | Leave empty — issued together with the Client ID, or not at all. |
| Extra config `locations` | JSON array of your assigned dark-store codes. |
| Extra config `allocation` | `"mirror"` (default — full quantity to every store) or `"split"` (divide evenly, remainder to the first). |

Connect the channel in the dashboard and press **Test** once credentials are provided by Swiggy's integration team.

## Notes & limits

- "Orders" are purchase orders for dark-store replenishment — destination store, SKUs, quantities, delivery windows. Consumer names and phone numbers are never shared with sellers.
- No onboarding or registration fee. Commission typically 15–25% (8–28% by category), inwarding Rs 2–4/unit, storage Rs 0.5–2/unit/day; damage and expiry are borne by the seller. Settlements run weekly or bi-monthly.
- The only self-serve surface Swiggy offers Instamart brands is the Instamart Ads portal — advertising, not listings.
