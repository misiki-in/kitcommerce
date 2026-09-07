/**
 * eBay Taxonomy and Leaf Category ID mapping helper.
 */

export const EBAY_CATEGORY_TAXONOMY_MAP: Record<string, number> = {
  // Jewelry & Watches
  "jewelry": 281,
  "jewelry>rings": 67726,
  "rings": 67726,
  "jewelry>earrings": 50647,
  "earrings": 50647,
  "earrings>shop by style>cluster earrings": 50647,
  "jewelry>necklaces": 155101,
  "necklaces": 155101,
  "necklaces>pendants": 155101,
  "jewelry>bracelets": 10968,
  "bracelets": 10968,
  "fine jewelry": 4196,
  "fine jewelry>fine rings": 67726,
  "fine jewelry>fine earrings": 50647,
  "fine jewelry>fine necklaces & pendants": 155101,

  // Clothing & Fashion
  "clothing, shoes & accessories": 11450,
  "clothing": 11450,
  "women's clothing": 15724,
  "women's dresses": 63861,
  "women's tops": 53159,
  "men's clothing": 1059,
  "men's shirts": 57990,
  "men's t-shirts": 15687,

  // Home & Living / Crafts
  "home & garden": 11700,
  "crafts": 14339,
  "collectibles": 1,
};

export const DEFAULT_EBAY_CATEGORY_ID = 11450; // Clothing, Shoes & Accessories

/**
 * Resolves a leaf eBay category ID for an internal category string.
 */
export function taxonomyIdForEbayCategory(categoryName?: string | null): number {
  if (!categoryName) return DEFAULT_EBAY_CATEGORY_ID;

  const normalized = categoryName.toLowerCase().trim();

  // 1. Direct match
  if (EBAY_CATEGORY_TAXONOMY_MAP[normalized]) {
    return EBAY_CATEGORY_TAXONOMY_MAP[normalized];
  }

  // 2. Contains match
  for (const [key, val] of Object.entries(EBAY_CATEGORY_TAXONOMY_MAP)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return val;
    }
  }

  return DEFAULT_EBAY_CATEGORY_ID;
}
