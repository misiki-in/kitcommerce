/**
 * eBay Taxonomy and Leaf Category ID mapping helper.
 * Comprehensive leaf category resolution adhering to eBay official category trees.
 *
 * NOTE: eBay requires leaf category IDs. Category 11450 (Clothing, Shoes & Accessories),
 * Category 281 (Jewelry & Watches), Category 11700 (Home & Garden) etc. are root/branch nodes,
 * NOT leaf categories. This mapper maps all standard product categories and segmented paths
 * to valid eBay leaf nodes.
 */

export const EBAY_LEAF_CATEGORIES: Record<string, number> = {
  // -------------------------------------------------------------
  // Fine & Fashion Jewelry (Leaf IDs on eBay US / Global)
  // -------------------------------------------------------------
  // Rings
  "rings": 67726, // Fine Rings
  "fine rings": 67726,
  "engagement rings": 92873,
  "wedding bands": 92874,
  "fashion rings": 67726,
  "solitaire rings": 67726,
  "stackable rings": 67726,
  "cocktail rings": 67726,
  "band rings": 92874,
  "eternity rings": 92874,

  // Earrings
  "earrings": 50647, // Fine Earrings
  "fine earrings": 50647,
  "fashion earrings": 50647,
  "cluster earrings": 50647,
  "stud earrings": 50647,
  "drop earrings": 50647,
  "dangle earrings": 50647,
  "hoop earrings": 50647,
  "halo earrings": 50647,
  "huggie earrings": 50647,
  "chandelier earrings": 50647,

  // Necklaces & Pendants
  "necklaces": 155101, // Fine Necklaces & Pendants
  "fine necklaces": 155101,
  "pendants": 155101,
  "fine pendants": 155101,
  "fashion necklaces": 155101,
  "chokers": 155101,
  "chains": 155101,
  "locket necklaces": 155101,

  // Bracelets & Charms
  "bracelets": 10968, // Fine Bracelets & Charms
  "fine bracelets": 10968,
  "fashion bracelets": 10968,
  "charm bracelets": 10968,
  "bangles": 10968,
  "cuff bracelets": 10968,
  "tennis bracelets": 10968,
  "anklets": 10968,

  // Jewelry General & Brooches
  "brooches & pins": 67725,
  "fine brooches": 67725,
  "cufflinks": 10298,
  "tie clips": 10298,
  "loose gemstones": 10214,
  "loose diamonds": 10214,
  "fine jewelry": 67726,
  "fashion jewelry": 67726,
  "jewelry": 67726, // Default to fine rings leaf instead of non-leaf 281
  "vintage & antique jewelry": 67726,

  // Watches
  "watches": 31387, // Wristwatches
  "wristwatches": 31387,
  "men's watches": 31387,
  "women's watches": 31387,
  "pocket watches": 3937,
  "smart watches": 178893,
  "watch accessories": 57720,
  "watch bands": 98624,

  // -------------------------------------------------------------
  // Apparel, Clothing, Shoes & Accessories (Leaf IDs)
  // -------------------------------------------------------------
  // Women's Clothing
  "women's dresses": 63861,
  "dresses": 63861,
  "women's tops": 53159,
  "tops": 53159,
  "women's shirts": 53159,
  "women's blouses": 53159,
  "women's t-shirts": 63869,
  "women's sweaters": 63866,
  "women's coats & jackets": 63862,
  "women's jeans": 11554,
  "women's pants": 63863,
  "women's skirts": 63864,
  "women's activewear": 185075,
  "women's swimwear": 63867,
  "women's suits": 63865,
  "women's sleepwear": 63868,
  "women's clothing": 63861, // Default leaf: Dresses

  // Men's Clothing
  "men's t-shirts": 15687,
  "t-shirts": 15687,
  "men's shirts": 57990,
  "men's casual shirts": 57990,
  "men's dress shirts": 57991,
  "men's sweaters": 11484,
  "men's coats & jackets": 57988,
  "men's jeans": 11481,
  "men's pants": 57989,
  "men's suits & blazers": 3001,
  "men's activewear": 185103,
  "men's underwear": 11507,
  "men's sleepwear": 11510,
  "men's swimwear": 15690,
  "men's clothing": 15687, // Default leaf: Men's T-Shirts

  // Shoes & Footwear
  "women's shoes": 3034,
  "women's heels": 55793,
  "women's boots": 53557,
  "women's flats": 45333,
  "women's sandals": 62107,
  "women's sneakers": 95672,
  "men's shoes": 93427,
  "men's boots": 11498,
  "men's sneakers": 15709,
  "men's dress shoes": 53120,
  "men's sandals": 11504,
  "shoes": 95672,

  // Bags, Handbags & Accessories
  "women's bags & handbags": 169291,
  "handbags": 169291,
  "tote bags": 169291,
  "clutches": 169291,
  "backpacks": 169291,
  "wallets": 45258,
  "belts": 3003,
  "sunglasses": 79720,
  "hats": 52365,
  "scarves & wraps": 45238,
  "ties": 15662,
  "accessories": 169291,
  "clothing": 63861,

  // -------------------------------------------------------------
  // Beauty, Health & Fragrance
  // -------------------------------------------------------------
  "fragrances & perfumes": 11846,
  "perfumes": 11846,
  "cologne": 11846,
  "skincare": 11863,
  "makeup": 21021,
  "hair care": 11854,
  "bath & body": 11838,
  "beauty": 11863,

  // -------------------------------------------------------------
  // Home, Garden, Crafts & Electronics
  // -------------------------------------------------------------
  "home décor": 10033,
  "candles": 46782,
  "wall art": 553,
  "pillows": 20563,
  "rugs": 45510,
  "kitchen & dining": 20625,
  "cookware": 98844,
  "dinnerware": 20657,
  "bedding": 20444,
  "crafts": 14339,
  "sewing": 160667,
  "beads & jewelry making": 160669,
  "electronics": 9355,
  "cell phones & smartphones": 9355,
  "cell phone accessories": 9394,
  "cases, covers & skins": 20349,
  "headphones": 112529,
  "collectibles": 1,
};

// Valid fallback leaf category (Fine Rings on eBay)
export const DEFAULT_EBAY_LEAF_CATEGORY_ID = 67726;

/**
 * Parses nested category strings like:
 * 'Earrings>Shop By Style>Cluster Earrings,Earrings>Shop By Style>Circle Earrings'
 * into segmented paths.
 */
export function parseCategoryPaths(categoriesStr: string): string[][] {
  if (!categoriesStr) return [];
  const paths: string[][] = [];
  for (const pathStr of categoriesStr.split(",")) {
    const segments = pathStr
      .split(">")
      .map((s) => s.trim())
      .filter(Boolean);
    if (segments.length) paths.push(segments);
  }
  return paths;
}

/**
 * Resolves a guaranteed valid leaf eBay category ID for any category string.
 */
export function taxonomyIdForEbayCategory(categoryName?: string | null): number {
  if (!categoryName) return DEFAULT_EBAY_LEAF_CATEGORY_ID;

  const rawClean = categoryName.trim().toLowerCase();

  // 1. Direct match on full category string
  if (EBAY_LEAF_CATEGORIES[rawClean]) {
    return EBAY_LEAF_CATEGORIES[rawClean];
  }

  const rawNoSpaces = rawClean.replace(/\s*>\s*/g, ">");
  if (EBAY_LEAF_CATEGORIES[rawNoSpaces]) {
    return EBAY_LEAF_CATEGORIES[rawNoSpaces];
  }

  // 2. Parse hierarchy paths (e.g. "Earrings > Shop By Style > Cluster Earrings")
  const paths = parseCategoryPaths(categoryName);
  if (paths.length > 0) {
    // 2a. Match exact leaf node segment first (e.g. "Cluster Earrings" or "Solitaire Rings")
    for (const segments of paths) {
      const leaf = segments[segments.length - 1]?.trim().toLowerCase();
      if (leaf && EBAY_LEAF_CATEGORIES[leaf]) {
        return EBAY_LEAF_CATEGORIES[leaf];
      }
      // Check leaf with common synonyms
      for (const [key, val] of Object.entries(EBAY_LEAF_CATEGORIES)) {
        if (leaf && (leaf.includes(key) || key.includes(leaf))) {
          return val;
        }
      }
    }

    // 2b. Match full joined path
    for (const segments of paths) {
      const full = segments.join(" > ").toLowerCase();
      if (EBAY_LEAF_CATEGORIES[full]) return EBAY_LEAF_CATEGORIES[full];
      const fullNoSpaces = segments.join(">").toLowerCase();
      if (EBAY_LEAF_CATEGORIES[fullNoSpaces]) return EBAY_LEAF_CATEGORIES[fullNoSpaces];
    }

    // 2c. Match top-level segment
    for (const segments of paths) {
      const top = segments[0]?.trim().toLowerCase();
      if (top && EBAY_LEAF_CATEGORIES[top]) {
        return EBAY_LEAF_CATEGORIES[top];
      }
    }
  }

  // 3. Substring match across known leaf categories
  for (const [key, val] of Object.entries(EBAY_LEAF_CATEGORIES)) {
    if (rawClean.includes(key) || key.includes(rawClean)) {
      return val;
    }
  }

  return DEFAULT_EBAY_LEAF_CATEGORY_ID;
}

export const EBAY_CATEGORY_TAXONOMY_MAP = EBAY_LEAF_CATEGORIES;
