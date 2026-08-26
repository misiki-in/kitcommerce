/**
 * Demo data: one account, a filled-in seller profile, four connected channels
 * (all four marketplaces, in mock mode) and a small catalogue with variants,
 * images and the attributes each marketplace requires.
 *
 *   bun seed        then sign in as demo@opencommerce.dev / demo1234
 */
import { config } from "./lib/server/config";
import { createAuth } from "./lib/server/auth";
import { outboxEvents } from "./lib/server/drivers";
import { sqliteDb } from "./lib/server/drivers/db.sqlite";
import { sqliteQueue } from "./lib/server/drivers/queue.sqlite";
import { createRepo } from "./lib/server/repo";
import { createPlanner } from "./lib/server/sync";

const db = sqliteDb(config.dbPath);

const schema = await Bun.file(new URL("./lib/server/db/schema.sql", import.meta.url)).text();
db.exec(schema);

const bus = outboxEvents(db);
const queue = sqliteQueue(db);
const repo = createRepo(db, bus);
const auth = createAuth(db);
const planner = createPlanner(repo, queue);
planner.register(bus);

const { email: EMAIL, password: PASSWORD } = config.demo;

const existing = db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", [EMAIL]);
if (existing) {
  console.log(`Demo account already exists (${EMAIL}). Delete data/opencommerce.db to reseed.`);
  process.exit(0);
}

const principal = await auth.signup(EMAIL, PASSWORD, "Demo Merchant");
const store = repo.createStore(principal.organizationId, "Misiki Handloom");

repo.updateStore(store.id, {
  description: "Handwoven textiles and silver jewellery, made in Karnataka since 1998.",
  website: "https://example.com",
  support_email: "support@example.com",
  support_phone: "+91-9800000000",
  legal_name: "Misiki Handloom Private Limited",
  business_type: "private_limited",
  tax_id: "29AABCM1234R1ZX",
  registration_no: "U17291KA1998PTC024512",
  address_line1: "42 Chickpet Main Road",
  address_line2: "Near Silver Junction",
  city: "Bengaluru",
  state: "Karnataka",
  postal_code: "560053",
  country: "IN",
  currency: "INR",
});

// Four channels, all in mock mode so the pipeline runs with no credentials.
const channels = [
  { connector: "flipkart", name: "Flipkart — Misiki Seller", config: {} },
  { connector: "meesho", name: "Meesho — Misiki Supplier", config: {} },
  {
    connector: "ebay",
    name: "eBay — Misiki Global",
    // A channel price rule: +8% on eBay, applied at publish time. The canonical
    // price is never modified.
    config: { marketplace_id: "EBAY_US", priceRule: { type: "percent", value: 8 } },
  },
  { connector: "etsy", name: "Etsy — Misiki Craft", config: { shop_id: "12345678" } },
];

for (const c of channels) {
  repo.createChannel({
    orgId: principal.organizationId,
    storeId: store.id,
    connector: c.connector,
    name: c.name,
    mode: "mock",
    config: c.config,
  });
}

// Attributes cover every connector's required fields, so these products
// validate cleanly against all four manifests.
const common = {
  country_of_origin: "IN",
  gst_percentage: "5",
  condition: "NEW",
  ebay_category_id: "11450",
  ebay_fulfillment_policy_id: "FP-DEMO-1",
  ebay_payment_policy_id: "PP-DEMO-1",
  ebay_return_policy_id: "RP-DEMO-1",
  ebay_merchant_location_key: "BLR-WH-1",
  etsy_taxonomy_id: "1234",
  etsy_shipping_profile_id: "SP-DEMO-1",
  who_made: "i_did",
  when_made: "made_to_order",
};

const catalogue = [
  {
    sku: "MSK-SAREE-001",
    title: "Handwoven Mysore Silk Saree — Peacock Blue",
    description:
      "Pure mulberry silk woven on a traditional pit loom, with a hand-drawn zari border. Each piece takes nine days to weave.",
    brand: "Misiki",
    category: "Sarees",
    hsnCode: "5007",
    taxRateBp: 500,
    weightG: 620,
    lengthMm: 320, widthMm: 240, heightMm: 60,
    attributes: { ...common, material: "Mulberry Silk", weave: "Handloom", occasion: "Festive" },
    images: [
      { url: "https://images.unsplash.com/photo-1610030469983-98e550d6193c?w=800&q=80" },
      { url: "https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=800&q=80" },
    ],
    variants: [
      { sku: "MSK-SAREE-001-BLU", options: { Colour: "Peacock Blue" }, priceCents: 1249900, mrpCents: 1599900, available: 12 },
      { sku: "MSK-SAREE-001-GRN", options: { Colour: "Emerald Green" }, priceCents: 1249900, mrpCents: 1599900, available: 7 },
    ],
  },
  {
    sku: "MSK-STOLE-002",
    title: "Kota Doria Cotton Stole — Natural Dye",
    description: "Feather-light Kota Doria cotton, dyed with madder root and indigo. Unisex.",
    brand: "Misiki",
    category: "Stoles & Scarves",
    hsnCode: "6214",
    taxRateBp: 500,
    weightG: 140,
    lengthMm: 260, widthMm: 180, heightMm: 40,
    attributes: { ...common, material: "Cotton", weave: "Kota Doria", dye: "Natural" },
    images: [{ url: "https://images.unsplash.com/photo-1601924994987-69e26d50dc26?w=800&q=80" }],
    variants: [
      { sku: "MSK-STOLE-002-IND", options: { Colour: "Indigo" }, priceCents: 189900, mrpCents: 249900, available: 34 },
      { sku: "MSK-STOLE-002-MAD", options: { Colour: "Madder Red" }, priceCents: 189900, mrpCents: 249900, available: 28 },
      { sku: "MSK-STOLE-002-NAT", options: { Colour: "Undyed" }, priceCents: 169900, mrpCents: 219900, available: 41 },
    ],
  },
  {
    sku: "MSK-JHUM-003",
    title: "Oxidised Silver Jhumka Earrings",
    description: "925 sterling silver jhumkas with granulation detail, oxidised by hand.",
    brand: "Misiki",
    category: "Earrings",
    hsnCode: "7113",
    taxRateBp: 300,
    weightG: 24,
    lengthMm: 90, widthMm: 90, heightMm: 40,
    attributes: { ...common, gst_percentage: "3", material: "Sterling Silver", purity: "925", finish: "Oxidised" },
    images: [{ url: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=800&q=80" }],
    variants: [
      { sku: "MSK-JHUM-003-S", options: { Size: "Small" }, priceCents: 249900, mrpCents: 299900, available: 18 },
      { sku: "MSK-JHUM-003-L", options: { Size: "Large" }, priceCents: 329900, mrpCents: 399900, available: 9 },
    ],
  },
  {
    // Deliberately incomplete: no HSN, no country of origin, no image. This
    // product shows up as INCOMPLETE against every connector instead of
    // dead-lettering five jobs -- validation happens before queueing.
    sku: "MSK-DRAFT-004",
    title: "Ikat Cushion Cover (draft — missing required fields)",
    description: "Placeholder listing used to demonstrate mapping validation.",
    brand: "",
    category: "Home",
    hsnCode: "",
    taxRateBp: 0,
    weightG: 0,
    lengthMm: 0, widthMm: 0, heightMm: 0,
    attributes: {},
    images: [],
    variants: [{ sku: "MSK-DRAFT-004-A", options: {}, priceCents: 79900, mrpCents: 99900, available: 5 }],
  },
];

for (const p of catalogue) {
  await repo.saveProduct({
    orgId: principal.organizationId,
    storeId: store.id,
    sku: p.sku,
    title: p.title,
    description: p.description,
    brand: p.brand,
    category: p.category,
    status: "ACTIVE",
    attributes: p.attributes,
    taxRateBp: p.taxRateBp,
    hsnCode: p.hsnCode,
    weightG: p.weightG,
    lengthMm: p.lengthMm,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    variants: p.variants.map((v) => ({ ...v, currency: "INR" })),
    images: p.images,
  });
}

// Drain the outbox so the planner turns those product.created events into jobs.
const published = await bus.drain(500);
const stats = repo.jobStats(store.id);

console.log(`
  Seeded.

  sign in    ${EMAIL} / ${PASSWORD}
  store      ${store.name}
  channels   ${channels.length} (all mock mode)
  products   ${catalogue.length}
  events     ${published} published
  jobs       ${Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(" ")}

  Now run:  bun dev
`);

db.close();
