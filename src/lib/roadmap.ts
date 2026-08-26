/**
 * Sales channels that do NOT have a connector.
 *
 * This is a wanted-list, kept deliberately apart from the connector registry
 * in $server/connectors. Nothing here is integrated, nothing here has a
 * manifest, and nothing here can be connected — it exists so that a seller
 * arriving to ask "is my marketplace in this thing?" gets an answer instead of
 * a shrug, and so that someone deciding what to build next can see what has
 * been asked for.
 *
 * The moment a name here gets a connector, it moves out of this file and into
 * the registry. `bun test` fails if a name is ever in both, because a channel
 * listed as both built and wanted is the exact confusion this file is meant to
 * avoid.
 *
 * Scope is sales channels only — places a catalogue can be published. Couriers,
 * ERPs, POS systems and accounting tools are integrations other platforms list,
 * and they are absent here for the same reason the README lists shipping and
 * accounting under what is deliberately not built: this publishes catalogues.
 */

export interface RoadmapGroup {
  label: string;
  /** Display names, in the order they should read. */
  channels: string[];
}

export const ROADMAP: RoadmapGroup[] = [
  {
    label: "India — horizontal",
    channels: [
      "Amazon Business India",
      "Shopsy",
      "IndiaMART",
      "Udaan",
      "GlowRoad",
      "JioMart Digital",
      "Reliance Digital",
      "Croma",
      "Vijay Sales",
    ],
  },
  {
    label: "India — fashion & beauty",
    channels: [
      "Nykaa Fashion",
      "Tata CLiQ Luxury",
      "Purplle",
      "LimeRoad",
      "Bewakoof",
      "The Souled Store",
      "Westside",
      "Lifestyle",
    ],
  },
  {
    label: "India — grocery & quick commerce",
    channels: [
      "BigBasket",
      "Flipkart Minutes",
      "DMart Ready",
      "Amazon Fresh India",
      "Country Delight",
    ],
  },
  {
    label: "India — pharmacy & wellness",
    channels: ["Tata 1mg", "PharmEasy", "Netmeds", "Apollo 24|7", "Wellness Forever"],
  },
  {
    label: "Global — marketplaces",
    channels: [
      "Amazon US",
      "Amazon UK",
      "Amazon DE",
      "Amazon AE",
      "Walmart Marketplace",
      "Target Plus",
      "Wayfair",
      "Newegg",
      "Overstock",
      "Rakuten",
      "AliExpress",
      "Alibaba",
      "Temu",
      "Shein Marketplace",
      "Lazada",
      "Shopee",
      "Tokopedia",
      "Qoo10",
      "Coupang",
      "Mercado Libre",
      "Americanas",
      "Allegro",
      "Bol.com",
      "Zalando",
      "About You",
      "Otto",
      "Kaufland",
      "Cdiscount",
      "Fnac Darty",
      "La Redoute",
      "Trendyol",
      "Hepsiburada",
      "Noon",
      "Namshi",
      "Jumia",
      "Takealot",
      "Catch",
      "MyDeal",
      "Ozon",
      "Wildberries",
    ],
  },
  {
    label: "Social & content",
    channels: [
      "WhatsApp Catalogue",
      "Pinterest Shopping",
      "YouTube Shopping",
      "Snapchat Shopping",
      "X Shopping",
      "Google Shopping",
      "Google Business Profile",
    ],
  },
  {
    label: "Webstore platforms",
    channels: [
      "WooCommerce",
      "Adobe Commerce",
      "BigCommerce",
      "Wix Stores",
      "Squarespace Commerce",
      "Salesforce Commerce Cloud",
      "PrestaShop",
      "OpenCart",
      "Shopware",
      "Ecwid",
      "Dukaan",
      "Shiprocket Checkout",
      "Zoho Commerce",
    ],
  },
];

/** Flat list, for searching. */
export const ROADMAP_CHANNELS: Array<{ name: string; group: string }> = ROADMAP.flatMap((g) =>
  g.channels.map((name) => ({ name, group: g.label })),
);

export const ROADMAP_COUNT = ROADMAP_CHANNELS.length;
