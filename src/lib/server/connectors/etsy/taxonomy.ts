/**
 * Etsy Seller Taxonomy ID mappings and helper functions.
 */

export const DEFAULT_TAXONOMY_ID = 1; // General last-resort fallback

export const CATEGORY_TAXONOMY_MAP: Record<string, number> = {
  "circle earrings": 1206,
  "cluster earrings": 1206,
  "earrings": 1203,
  "halo earrings": 1212,
  "drop earrings": 1208,
  "hoop earrings": 1212,
  "stud earrings": 1218,
  "rings": 1243,
  "solitaire rings": 1251,
  "stackable rings": 1252,
  "engagement rings": 1247,
  "wedding bands": 1254,
  "necklaces": 1227,
  "pendants": 1234,
  "chokers": 1229,
  "bracelets": 1195,
  "charm bracelets": 1198,
  "cuff bracelets": 1199,
  "bangles": 1196,
  "jewelry": 1194,
};

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
 * Resolves the Etsy taxonomy ID by matching leaf and top-level segments.
 */
export function taxonomyIdForCategory(categoriesStr: string): number {
  const paths = parseCategoryPaths(categoriesStr);
  if (!paths.length) return DEFAULT_TAXONOMY_ID;

  // 1st pass: try the leaf segment
  for (const segments of paths) {
    const leaf = segments[segments.length - 1]?.toLowerCase();
    if (leaf && CATEGORY_TAXONOMY_MAP[leaf]) {
      return CATEGORY_TAXONOMY_MAP[leaf]!;
    }
  }

  // 2nd pass: try top-level segment
  for (const segments of paths) {
    const top = segments[0]?.toLowerCase();
    if (top && CATEGORY_TAXONOMY_MAP[top]) {
      return CATEGORY_TAXONOMY_MAP[top]!;
    }
  }

  return DEFAULT_TAXONOMY_ID;
}
