/**
 * Etsy Seller Taxonomy ID mappings and helper functions.
 * Automatically loads and resolves against etsy_taxonomy_flat.csv (3000+ categories).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_TAXONOMY_ID = 1; // General last-resort fallback

interface TaxonomyNode {
  id: number;
  name: string;
  fullPath: string;
  parentId?: number;
}

let loadedTaxonomies: Map<string, number> | null = null;
let allNodes: TaxonomyNode[] = [];

function loadTaxonomies(): Map<string, number> {
  if (loadedTaxonomies) return loadedTaxonomies;
  loadedTaxonomies = new Map<string, number>();

  try {
    const csvPath = join(process.cwd(), "src/lib/server/connectors/etsy/etsy_taxonomy_flat.csv");
    const content = readFileSync(csvPath, "utf-8");
    const lines = content.split(/\r?\n/);
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      
      // Format: id,name,full_path,parent_id
      const parts = line.split(",");
      if (parts.length >= 3) {
        const id = Number(parts[0]);
        const name = parts[1]?.trim();
        const fullPath = parts[2]?.trim();
        const parentId = parts[3] ? Number(parts[3]) : undefined;

        if (!isNaN(id) && name) {
          allNodes.push({ id, name, fullPath, parentId });
          
          // Index by exact name (lowercase)
          loadedTaxonomies.set(name.toLowerCase(), id);
          
          // Index by full path (lowercase)
          if (fullPath) {
            loadedTaxonomies.set(fullPath.toLowerCase(), id);
            // Replace " > " with ">" for format matching
            loadedTaxonomies.set(fullPath.toLowerCase().replace(/\s*>\s*/g, ">"), id);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Etsy Taxonomy] Could not load taxonomy CSV: ${err.message}`);
  }

  // Common fallbacks
  loadedTaxonomies.set("circle earrings", 1206);
  loadedTaxonomies.set("cluster earrings", 1206);
  loadedTaxonomies.set("earrings", 1203);
  loadedTaxonomies.set("halo earrings", 1212);
  loadedTaxonomies.set("drop earrings", 1208);
  loadedTaxonomies.set("hoop earrings", 1212);
  loadedTaxonomies.set("stud earrings", 1218);
  loadedTaxonomies.set("rings", 1243);
  loadedTaxonomies.set("solitaire rings", 1251);
  loadedTaxonomies.set("stackable rings", 1252);
  loadedTaxonomies.set("engagement rings", 1247);
  loadedTaxonomies.set("wedding bands", 1254);
  loadedTaxonomies.set("necklaces", 1227);
  loadedTaxonomies.set("pendants", 1234);
  loadedTaxonomies.set("chokers", 1229);
  loadedTaxonomies.set("bracelets", 1195);
  loadedTaxonomies.set("charm bracelets", 1198);
  loadedTaxonomies.set("cuff bracelets", 1199);
  loadedTaxonomies.set("bangles", 1196);
  loadedTaxonomies.set("jewelry", 1194);

  return loadedTaxonomies;
}

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
 * Resolves the Etsy taxonomy ID by matching against all categories in etsy_taxonomy_flat.csv.
 */
export function taxonomyIdForCategory(categoriesStr: string): number {
  if (!categoriesStr) return DEFAULT_TAXONOMY_ID;
  const map = loadTaxonomies();

  const rawClean = categoriesStr.trim().toLowerCase();
  if (map.has(rawClean)) return map.get(rawClean)!;
  const rawNoSpaces = rawClean.replace(/\s*>\s*/g, ">");
  if (map.has(rawNoSpaces)) return map.get(rawNoSpaces)!;

  const paths = parseCategoryPaths(categoriesStr);
  if (!paths.length) return DEFAULT_TAXONOMY_ID;

  // 1st pass: exact full path match (e.g. "Jewelry > Rings" or "Accessories > Hair Accessories")
  for (const segments of paths) {
    const full = segments.join(" > ").toLowerCase();
    if (map.has(full)) return map.get(full)!;
    const fullNoSpaces = segments.join(">").toLowerCase();
    if (map.has(fullNoSpaces)) return map.get(fullNoSpaces)!;
  }

  // 2nd pass: exact match on leaf segment (e.g. "Cluster Earrings", "Solitaire Rings")
  for (const segments of paths) {
    const leaf = segments[segments.length - 1]?.trim().toLowerCase();
    if (leaf && map.has(leaf)) {
      return map.get(leaf)!;
    }
  }

  // 3rd pass: top-level match
  for (const segments of paths) {
    const top = segments[0]?.trim().toLowerCase();
    if (top && map.has(top)) {
      return map.get(top)!;
    }
  }

  return DEFAULT_TAXONOMY_ID;
}

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

