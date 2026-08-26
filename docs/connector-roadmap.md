# Connector Roadmap

The integration surface OpenCommerce is aiming at, benchmarked against
the categories Unicommerce covers as an omnichannel OMS.

> **Verify before quoting.** This list is compiled as a *target scope* for our
> own connector planning. It is not a verified snapshot of Unicommerce's current
> catalogue — their supported list changes and is authoritative only on
> [unicommerce.com](https://unicommerce.com/integrations/). Check there before
> repeating any specific entry as a claim about what Unicommerce supports.

**Status legend**

| Status | Meaning |
| --- | --- |
| ✅ Shipped | Connector exists in `src/connectors/`, mock + live paths |
| 🔜 Next | Committed for the release after the current one |
| 📋 Planned | On the roadmap, no owner yet |
| 🧭 Later plane | Out of core scope (see [Scope boundaries](#scope-boundaries)) |

---

## Marketplaces — India

| Marketplace | Status | Notes |
| --- | --- | --- |
| Flipkart | ✅ Shipped | Seller API v3 |
| Meesho | ✅ Shipped | Supplier API, partner-gated |
| Amazon India | 🔜 Next | SP-API; shares the SP-API client with Amazon global |
| Myntra | 🔜 Next | PPMP partner portal |
| Ajio | 📋 Planned | Reliance seller portal |
| Nykaa | 📋 Planned | Beauty vertical; strict attribute schema |
| Nykaa Fashion | 📋 Planned | Separate catalogue from Nykaa beauty |
| Tata CLiQ | 📋 Planned | |
| JioMart | 📋 Planned | |
| Snapdeal | 📋 Planned | |
| Shopclues | 📋 Planned | |
| Limeroad | 📋 Planned | |
| Firstcry | 📋 Planned | Kids/baby vertical |
| Pepperfry | 📋 Planned | Furniture; heavy logistics coupling |
| Udaan | 📋 Planned | B2B wholesale |
| IndiaMART | 📋 Planned | B2B lead-driven, not classic cart |
| Purplle | 📋 Planned | |
| Croma | 📋 Planned | |
| Reliance Digital | 📋 Planned | |
| Vijay Sales | 📋 Planned | |
| Amazon Business (IN) | 📋 Planned | B2B pricing tiers |
| Flipkart Wholesale | 📋 Planned | B2B |

## Quick commerce

| Platform | Status | Notes |
| --- | --- | --- |
| Blinkit | 📋 Planned | Dark-store inventory model; per-store stock, not per-warehouse |
| Zepto | 📋 Planned | Same model as Blinkit |
| Swiggy Instamart | 📋 Planned | |
| BigBasket | 📋 Planned | |
| DMart Ready | 📋 Planned | |

> Q-commerce breaks the single-inventory-pool assumption in [`docs/`](./)'s
> inventory model — each dark store is its own stock location. This is the main
> reason multi-warehouse lands before this group does.

## Marketplaces — Global

| Marketplace | Status | Notes |
| --- | --- | --- |
| eBay | ✅ Shipped | Sell Inventory + Fulfillment API |
| Etsy | ✅ Shipped | Open API v3 |
| Amazon (global) | 🔜 Next | SP-API, multi-region |
| Walmart Marketplace | 📋 Planned | US |
| Noon | 📋 Planned | UAE / KSA |
| Namshi | 📋 Planned | MENA fashion |
| Trendyol | 📋 Planned | TR |
| Zalando | 📋 Planned | EU fashion |
| Allegro | 📋 Planned | PL |
| bol.com | 📋 Planned | NL / BE |
| OTTO | 📋 Planned | DE |
| Kaufland | 📋 Planned | DE |
| Cdiscount | 📋 Planned | FR |
| Fnac / Darty | 📋 Planned | FR |
| ManoMano | 📋 Planned | EU DIY |
| Shopee | 📋 Planned | SEA |
| Lazada | 📋 Planned | SEA |
| Tokopedia | 📋 Planned | ID |
| Bukalapak | 📋 Planned | ID |
| Qoo10 | 📋 Planned | SG / JP |
| Rakuten | 📋 Planned | JP |
| Coupang | 📋 Planned | KR |
| Mercado Libre | 📋 Planned | LATAM |
| AliExpress | 📋 Planned | Global |
| Jumia | 📋 Planned | Africa |
| Wayfair | 📋 Planned | US home |
| Newegg | 📋 Planned | US electronics |
| Target Plus | 📋 Planned | US, invite-only |
| Best Buy Marketplace | 📋 Planned | US / CA |

## Storefront platforms — *adapters, not connectors*

These are sources of truth that feed the canonical model, the same plane
Litekart occupies. They implement `PlatformAdapter`, not `MarketplaceConnector`.

| Platform | Status | Notes |
| --- | --- | --- |
| Litekart | ✅ Shipped | First adapter |
| Native catalogue | ✅ Shipped | Built-in; products created in OpenCommerce itself |
| WooCommerce | 🔜 Next | REST API v3 |
| Shopify | 🔜 Next | Admin GraphQL |
| Medusa | 📋 Planned | |
| Vendure | 📋 Planned | |
| Saleor | 📋 Planned | |
| Magento / Adobe Commerce | 📋 Planned | |
| BigCommerce | 📋 Planned | |
| PrestaShop | 📋 Planned | |
| OpenCart | 📋 Planned | |
| Shopware | 📋 Planned | |
| Wix | 📋 Planned | |
| Squarespace Commerce | 📋 Planned | |
| Ecwid | 📋 Planned | |
| Zoho Commerce | 📋 Planned | |
| StoreHippo | 📋 Planned | |
| Dukaan | 📋 Planned | |
| Salesforce Commerce Cloud | 📋 Planned | Enterprise |
| SAP Commerce (Hybris) | 📋 Planned | Enterprise |
| Custom ERP / CSV | 📋 Planned | Generic adapter + column mapping |

---

## Scope boundaries

Unicommerce is a full OMS. OpenCommerce is deliberately narrower: it is
the **catalogue, pricing, inventory and order integration layer**, and nothing
below is in the core.

Spec §3 excludes shipping aggregation, accounting, returns automation, ads and
warehouse management from the MVP. They are listed here only so the eventual
shape is legible — each would arrive as its own **plugin plane** with its own
port, exactly like infrastructure drivers did, never as core code.

### 🧭 Logistics / shipping — later plane

Delhivery · Blue Dart · Ecom Express · XpressBees · DTDC · Shadowfax · Ekart ·
Shiprocket · Pickrr · ClickPost · Gati · Safexpress · India Post · Amazon
Shipping · FedEx · DHL · UPS

### 🧭 ERP / accounting — later plane

SAP · Oracle NetSuite · Microsoft Dynamics 365 · Odoo · Ginesys · Tally ·
Busy · Marg · Zoho Books · QuickBooks

### 🧭 POS / retail — later plane

Ginesys POS · Zoho POS · Shopify POS · Lightspeed · Vend

---

## Adding a connector

A new marketplace touches exactly two files:

1. `src/connectors/<name>.ts` — the connector itself
2. `src/connectors/index.ts` — one line in the registry

Nothing in the sync engine, the API, or the dashboard knows a connector's name.
That property is what this roadmap is betting on: the list above should be able
to grow to a hundred rows without the core changing shape.

See [`connector-development.md`](./connector-development.md) for the contract.
