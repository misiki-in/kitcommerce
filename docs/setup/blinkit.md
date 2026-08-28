# Blinkit — going live

> Connector `blinkit` · Vendor ID + optional key/secret (Blinkit issues no seller API keys) · Last verified against official docs: 2026-08-27

Blinkit is the closest of the quick-commerce three to self-serve: you register on the Seller Hub, pass a 7–21 day verification, get assigned dark stores, then ship stock into Blinkit's network against auto-generated purchase orders — typically 30–60 days from registration to first PO. There is still no API credential to mint: integrations happen by Blinkit whitelisting your Vendor ID for a named enabler platform, so OpenCommerce's live mode stays parked until Blinkit provisions one (the connector's sketched endpoints returned 404 when probed on 2026-08-27). Mock mode is fully functional today.

## Before you start

Have ready:

- GSTIN (mandatory) and PAN card
- Bank account plus a cancelled cheque
- FSSAI licence (food and beverage categories)
- Brand authorization letter or trademark certificate
- Business registration (CIN/Udyam) and trade licence where applicable
- GS1-standard UPC/EAN/GTIN barcodes for every SKU — non-standard barcodes cause inwarding failures and return-to-vendor charges

One warning before you click anything: https://blinkit.com/partner and partners.blinkit.com are Blinkit's dark-store **franchise** program — a Rs 7–10 lakh investment to operate a micro-warehouse. That is a different business relationship entirely. Sellers belong at the Seller Hub below.

## Steps

### 1. Register on the Blinkit Seller Hub

Go to https://seller.blinkit.com/, click "Sell on Blinkit" / "Get Started", verify your email via OTP, then fill business details: selling category, platforms you currently sell on, your name, designation and mobile number. Registration is free. You receive a Seller Hub account pending verification.

### 2. Upload documents

Submit the document set from "Before you start" in the Seller Hub.

### 3. Wait out verification

Verification takes 7–21 days (some categories 20–45). The full journey from registration to first PO dispatch is typically 30–60 days self-managed. You receive an approved seller account and a Blinkit-assigned vendor code.

### 4. Dark-store assignment and APOB

Post-approval, Blinkit assigns dark stores based on your city selection and category. Register APOB (Additional Place of Business) on your GST for the zones where stock will be held — Blinkit only generates POs and allows inwarding in approved APOB zones.

### 5. Catalogue and barcodes

Create listings in the Seller Hub. Blinkit's official Seller Hub Guide PDF covers listing, cataloguing, shipments, LP updation and inventory recall: https://cdn.grofers.com/da/seller-hub-assets/web-assets/doc/Seller_Hub_Guide.pdf. Use GS1-standard barcodes throughout.

### 6. Ship against purchase orders

Blinkit auto-generates POs; dispatch to the assigned warehouse within the inwarding window, book the appointment slot, and pass packaging, quantity, barcode and shelf-life checks. Approved stock is distributed across dark stores. An Android app exists for on-the-go order and inventory management.

### 7. Optional: OMS integration via Vendor-ID whitelisting

To automate POs into an OMS (Base, Unicommerce, EasyEcom, Vinculum), ask your Blinkit point of contact to whitelist your Vendor ID(s) for that named platform. Blinkit performs the technical enablement internally — in Base's words, "No API keys, secrets, or tokens are required". The Unicommerce alternative parses auto-forwarded PO emails instead. Either way, you never hold API credentials yourself.

## What goes where

| Field | Where the value comes from |
| --- | --- |
| Vendor ID | Assigned by Blinkit at onboarding (your vendor code); visible in the Seller Hub and printed on POs. For enabler integrations, supply the exact whitelisted Vendor ID — one per region/category/dispatch-location if you have several. |
| API Key *(optional)* | Leave empty. Blinkit issues no API keys to sellers; enablement is done Blinkit-side by whitelisting your Vendor ID for a named platform. |
| API Secret *(optional)* | Leave empty — same story as the API Key. |
| Extra config `locations` | JSON array of the dark-store codes Blinkit assigned you. |
| Extra config `allocation` | `"mirror"` (default — full quantity to every store) or `"split"` (divide evenly, remainder to the first). |

## Verify

Connect the channel in the dashboard and leave it in **Mock** mode — health reports HEALTHY with your configured dark-store count. If you switch to **Live** and press **Test**, the health check calls `GET https://api.blinkit.com/seller/v1/seller/profile`, which returned 404 on 2026-08-27: expect API_FAILURE. Live mode stays parked until Blinkit whitelists an integration for your Vendor ID.

## Notes & limits

- "Orders" are purchase orders with SKU-level line items, delivery schedules, appointment windows and PO expiry timelines — never end-customer orders, and never consumer PII. PO generation is additionally gated per-zone on APOB approval.
- Registration is free. Commission runs ~8–15% per order (some sources say 8–20%) by category, plus inwarding fees, storage fees and RTV (return-to-vendor) charges.
- Approval is gated on brand/category fit even though registration is open.
- The dark-store franchise program at blinkit.com/partner costs Rs 7–10 lakh and is unrelated to selling stock — do not confuse the two.
