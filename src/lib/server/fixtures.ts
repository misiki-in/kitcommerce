/**
 * A canonical attribute set that satisfies every registered connector's
 * `requiredFields`. Shared by the seeder and the self-test so that adding a
 * connector with a new requirement fails loudly in one place instead of
 * silently producing INCOMPLETE demo data.
 */
export const COMPLETE_ATTRIBUTES: Record<string, string> = {
  // universal / Indian regulatory
  country_of_origin: "IN",
  gst_percentage: "5",
  // canonical condition vocabulary; connectors translate to their own
  condition: "NEW",

  // eBay
  ebay_category_id: "11450",
  ebay_fulfillment_policy_id: "FP-DEMO-1",
  ebay_payment_policy_id: "PP-DEMO-1",
  ebay_return_policy_id: "RP-DEMO-1",
  ebay_merchant_location_key: "BLR-WH-1",

  // Etsy
  etsy_taxonomy_id: "1234",
  etsy_shipping_profile_id: "SP-DEMO-1",
  who_made: "i_did",
  when_made: "made_to_order",

  // Amazon
  amazon_product_type: "HOME",
  amazon_browse_node_id: "1571272031",

  // fashion (Myntra, AJIO)
  article_type: "Sarees",
  gender: "women",
  size_chart_id: "SC-DEMO-1",
  fabric: "Silk",
  wash_care: "Dry clean only",
  colour_family: "Blue",

  // grocery / quick commerce (JioMart, Zepto, Instamart, Blinkit)
  pack_size: "1 piece",
  fulfilment_model: "seller_fulfilled",
  shelf_life_days: "3650",
  mrp_declared: "1599.00",
  fssai_licence: "10012345678901",

  // beauty (Nykaa)
  ingredients: "Not applicable",
  is_cruelty_free: "yes",

  // electronics / general (Tata CLiQ, Snapdeal)
  warranty_months: "0",
  brand_authorisation: "BA-DEMO-1",

  // social (Instagram, Facebook, TikTok Shop)
  //
  // landing_url is the one that matters: outside Meta's native checkout a
  // tagged product has to send the buyer somewhere, and that somewhere is
  // your own site.
  landing_url: "https://example.com/products/mysore-silk-saree",
  instagram_shopping_enabled: "yes",
  tiktok_category_id: "601152",
  tiktok_warehouse_id: "WH-DEMO-1",
  package_weight_g: "800",
};
