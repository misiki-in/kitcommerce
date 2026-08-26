/**
 * Listing suggestions: SKU, categories, keywords and attributes.
 *
 * Deterministic by design — no AI, no network call, no API key. Suggestions
 * come from three sources, in priority order:
 *
 *   1. Your own catalogue. What categories and attributes you already use is a
 *      far better signal than any generic taxonomy.
 *   2. A built-in keyword→category taxonomy for cold start.
 *   3. The connector manifests, which already declare exactly what each
 *      marketplace requires.
 *
 * The same input always produces the same output, which is what lets these run
 * on every keystroke and lets the self-test assert them.
 */
import type { FieldSpec } from "./connector";
import { listManifests } from "./connectors";
import type { Repo } from "./repo";

// ------------------------------------------------------------------ keywords

/** Words carrying no retail signal; dropped from keywords and SKU stems. */
const STOPWORDS = new Set([
  "a", "an", "and", "the", "with", "for", "from", "of", "in", "on", "at", "by",
  "to", "or", "our", "your", "this", "that", "it", "its", "is", "are", "was",
  "new", "best", "buy", "sale", "offer", "free", "premium", "quality", "pack",
  "set", "piece", "pcs", "item", "product", "combo", "genuine", "original",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Keywords ranked by where they appeared: title beats brand beats attributes
 * beats description. Marketplaces weight title terms most heavily, so the
 * ordering here mirrors that.
 */
export function suggestKeywords(input: {
  title?: string;
  brand?: string;
  category?: string;
  description?: string;
  attributes?: Record<string, unknown>;
  limit?: number;
}): string[] {
  const scores = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const w of tokenize(text)) {
      scores.set(w, (scores.get(w) ?? 0) + weight);
    }
  };

  add(input.title ?? "", 10);
  add(input.category ?? "", 6);
  add(input.brand ?? "", 5);
  for (const v of Object.values(input.attributes ?? {})) {
    if (typeof v === "string" || typeof v === "number") add(String(v), 3);
  }
  // Only the opening of the description: later prose is rarely on-topic.
  add((input.description ?? "").slice(0, 300), 1);

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, input.limit ?? 12)
    .map(([w]) => w);
}

// ---------------------------------------------------------------- categories

/**
 * Cold-start taxonomy. Deliberately small: once a merchant has a catalogue,
 * their own categories outrank anything hardcoded here.
 */
const TAXONOMY: Array<{ category: string; terms: string[] }> = [
  { category: "Sarees", terms: ["saree", "sari", "silk", "kanjivaram", "banarasi", "zari"] },
  { category: "Kurtas & Kurtis", terms: ["kurta", "kurti", "anarkali", "tunic"] },
  { category: "Dresses", terms: ["dress", "gown", "frock", "maxi"] },
  { category: "Tops & T-Shirts", terms: ["shirt", "tshirt", "top", "blouse", "tee"] },
  { category: "Trousers & Jeans", terms: ["jeans", "trouser", "pant", "chino", "jogger"] },
  { category: "Stoles & Scarves", terms: ["stole", "scarf", "dupatta", "shawl", "wrap"] },
  { category: "Earrings", terms: ["earring", "jhumka", "stud", "hoop", "danglers"] },
  { category: "Necklaces", terms: ["necklace", "pendant", "chain", "choker", "mangalsutra"] },
  { category: "Rings", terms: ["ring", "band", "solitaire"] },
  { category: "Bangles & Bracelets", terms: ["bangle", "bracelet", "kada", "cuff"] },
  { category: "Footwear", terms: ["shoe", "sandal", "sneaker", "heel", "juti", "loafer"] },
  { category: "Bags & Luggage", terms: ["bag", "backpack", "tote", "clutch", "wallet", "purse"] },
  { category: "Home Furnishing", terms: ["cushion", "curtain", "bedsheet", "throw", "rug", "carpet"] },
  { category: "Kitchen & Dining", terms: ["mug", "plate", "bowl", "cutlery", "cookware", "bottle"] },
  { category: "Skin Care", terms: ["cream", "serum", "moisturiser", "moisturizer", "lotion", "cleanser"] },
  { category: "Hair Care", terms: ["shampoo", "conditioner", "hairoil", "hair"] },
  { category: "Makeup", terms: ["lipstick", "kajal", "foundation", "mascara", "eyeliner"] },
  { category: "Fragrance", terms: ["perfume", "attar", "cologne", "deodorant"] },
  { category: "Grocery & Staples", terms: ["rice", "flour", "atta", "dal", "spice", "masala", "oil", "tea", "coffee"] },
  { category: "Snacks & Packaged Food", terms: ["snack", "biscuit", "namkeen", "chocolate", "chips"] },
  { category: "Stationery", terms: ["notebook", "pen", "diary", "journal", "planner"] },
  { category: "Toys & Games", terms: ["toy", "puzzle", "game", "doll", "blocks"] },
  { category: "Electronics", terms: ["cable", "charger", "headphone", "earbud", "speaker", "adapter"] },
];

export interface CategorySuggestion {
  category: string;
  /** "catalogue" ranks above "taxonomy" — the merchant's own usage wins. */
  source: "catalogue" | "taxonomy";
  score: number;
}

export function suggestCategories(
  input: { title?: string; description?: string; brand?: string },
  existing: Array<{ category: string; count: number }> = [],
  limit = 5,
): CategorySuggestion[] {
  const words = new Set([
    ...tokenize(input.title ?? ""),
    ...tokenize((input.description ?? "").slice(0, 200)),
  ]);

  const out: CategorySuggestion[] = [];

  // 1. the merchant's own categories, matched on shared words
  for (const e of existing) {
    const catWords = tokenize(e.category);
    const overlap = catWords.filter((w) => words.has(w)).length;
    // Singular/plural: "saree" in the title should match a "Sarees" category.
    const fuzzy = catWords.some((cw) =>
      [...words].some((w) => cw.startsWith(w) || w.startsWith(cw)),
    );
    if (overlap > 0 || fuzzy) {
      out.push({ category: e.category, source: "catalogue", score: 100 + overlap * 10 + e.count });
    }
  }

  // 2. built-in taxonomy
  for (const t of TAXONOMY) {
    const hits = t.terms.filter((term) =>
      [...words].some((w) => w === term || w.startsWith(term) || term.startsWith(w)),
    ).length;
    if (hits > 0 && !out.some((o) => o.category === t.category)) {
      out.push({ category: t.category, source: "taxonomy", score: hits * 10 });
    }
  }

  // 3. nothing matched: offer the merchant's most-used categories
  if (out.length === 0) {
    for (const e of existing.slice(0, limit)) {
      out.push({ category: e.category, source: "catalogue", score: e.count });
    }
  }

  return out.sort((a, b) => b.score - a.score || a.category.localeCompare(b.category)).slice(0, limit);
}

// ----------------------------------------------------------------------- SKU

/**
 * Strip to A-Z0-9 and clamp, for one SKU segment.
 *
 * `dropFiller` removes retail noise ("premium", "new") from a *title* stem. It
 * must stay off for variant option values: those are deliberate merchant input,
 * and words like "Free" (as in Free Size) are meaningful there, not filler.
 */
function segment(text: string, max: number, dropFiller = true): string {
  const words = text
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const kept = dropFiller ? words.filter((w) => !STOPWORDS.has(w.toLowerCase())) : words;
  // If filtering removed everything, the original words were all we had.
  return (kept.length ? kept : words).join("").slice(0, max);
}

/**
 * Build a readable, collision-free SKU:  MSK-SILKSAREE-001
 *
 * Readability matters more than compactness here — this string appears in
 * marketplace dashboards, courier manifests and support calls, where a human
 * has to read it aloud.
 */
export function suggestSku(
  input: { brand?: string; title?: string; category?: string },
  isTaken: (sku: string) => boolean,
): string {
  const brand = segment(input.brand ?? "", 4) || "OC";
  const stem =
    segment(input.title ?? "", 10) || segment(input.category ?? "", 10) || "ITEM";

  const base = `${brand}-${stem}`;
  for (let n = 1; n < 1000; n++) {
    const candidate = `${base}-${String(n).padStart(3, "0")}`;
    if (!isTaken(candidate)) return candidate;
  }
  // Practically unreachable; keeps the function total rather than throwing.
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

/** Variant SKUs hang off the parent so they sort together in every dashboard. */
export function suggestVariantSku(parentSku: string, options: Record<string, string>): string {
  const suffix = Object.values(options)
    .map((v) => segment(v, 4, false))
    .filter(Boolean)
    .join("-");
  return suffix ? `${parentSku}-${suffix}` : parentSku;
}

// ---------------------------------------------------------------- attributes

export interface AttributeSuggestion {
  key: string;
  /** Values already used in this catalogue for the same key. */
  values: string[];
  /** Connectors that require this attribute. */
  requiredBy: string[];
  help?: string;
  enum?: string[];
}

/**
 * Which attributes to prompt for, drawn from the connector manifests (so the
 * list is always in sync with what is actually required) and enriched with the
 * values this merchant has used before.
 */
export function suggestAttributes(
  catalogueAttributes: Record<string, string[]>,
  connectorNames?: string[],
): AttributeSuggestion[] {
  const byKey = new Map<string, AttributeSuggestion>();

  for (const m of listManifests()) {
    if (connectorNames && !connectorNames.includes(m.name)) continue;
    for (const f of m.requiredFields) {
      if (!f.path.startsWith("attributes.")) continue;
      const key = f.path.slice("attributes.".length);
      const existing = byKey.get(key);
      if (existing) {
        existing.requiredBy.push(m.displayName);
        existing.help ??= f.help;
        existing.enum ??= f.enum;
      } else {
        byKey.set(key, {
          key,
          values: catalogueAttributes[key] ?? [],
          requiredBy: [m.displayName],
          help: f.help,
          enum: f.enum,
        });
      }
    }
  }

  // Attributes the merchant uses that no connector demands still deserve a
  // prompt — they are how listings get richer over time.
  for (const [key, values] of Object.entries(catalogueAttributes)) {
    if (!byKey.has(key)) byKey.set(key, { key, values, requiredBy: [] });
  }

  return [...byKey.values()].sort(
    (a, b) => b.requiredBy.length - a.requiredBy.length || a.key.localeCompare(b.key),
  );
}

// ------------------------------------------------------------------ assembly

export interface Suggestions {
  sku: string;
  categories: CategorySuggestion[];
  keywords: string[];
  attributes: AttributeSuggestion[];
  missingByConnector: Array<{ connector: string; displayName: string; missing: FieldSpec[] }>;
}

/** Everything the product form needs, in one call. */
export function suggestAll(
  repo: Repo,
  storeId: string,
  input: {
    title?: string;
    brand?: string;
    category?: string;
    description?: string;
    attributes?: Record<string, unknown>;
    sku?: string;
  },
): Suggestions {
  const products = repo.listProducts(storeId, 500);

  const categoryCounts = new Map<string, number>();
  const attributeValues: Record<string, Set<string>> = {};
  for (const p of products) {
    if (p.category) categoryCounts.set(p.category, (categoryCounts.get(p.category) ?? 0) + 1);
    try {
      for (const [k, v] of Object.entries(JSON.parse(p.attributes || "{}"))) {
        if (typeof v !== "string" && typeof v !== "number") continue;
        (attributeValues[k] ??= new Set()).add(String(v));
      }
    } catch {
      /* malformed attributes on one row must not break suggestions */
    }
  }

  const existing = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);

  const catalogueAttributes = Object.fromEntries(
    Object.entries(attributeValues).map(([k, set]) => [k, [...set].sort().slice(0, 12)]),
  );

  const taken = new Set(products.map((p) => p.sku));

  return {
    sku: input.sku?.trim()
      ? input.sku.trim()
      : suggestSku(input, (candidate) => taken.has(candidate)),
    categories: suggestCategories(input, existing),
    keywords: suggestKeywords(input),
    attributes: suggestAttributes(catalogueAttributes),
    missingByConnector: [],
  };
}
