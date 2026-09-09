import { type CanonicalProduct, type CanonicalVariant, type CanonicalImage } from "./connector";

export interface ParsedSheetRow {
  [key: string]: string;
}

export interface SheetProductGroup {
  groupKey: string;
  primaryRow: ParsedSheetRow;
  rows: ParsedSheetRow[];
  canonical: {
    sku: string;
    title: string;
    description: string;
    brand: string;
    category: string;
    weightG: number;
    dimensions: { lengthCm?: number; widthCm?: number; heightCm?: number };
    variants: CanonicalVariant[];
    images: CanonicalImage[];
    attributes: Record<string, unknown>;
  };
}

/**
 * Robust RFC 4180 CSV parser that properly handles quoted fields, newlines, and commas.
 */
export function parseCSV(csvText: string): ParsedSheetRow[] {
  const cleanText = csvText.replace(/^\uFEFF/, ""); // Strip BOM
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentField += '"';
        i++; // Skip escaped quote
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === "," && !insideQuotes) {
      currentRow.push(currentField);
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++; // Handle CRLF
      }
      currentRow.push(currentField);
      currentField = "";
      if (currentRow.some((f) => f.trim().length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentField += char;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some((f) => f.trim().length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length < 2) return [];

  const rawHeaders = rows[0]!.map((h) => h.trim());
  const parsedRows: ParsedSheetRow[] = [];

  for (let r = 1; r < rows.length; r++) {
    const rowValues = rows[r]!;
    const obj: ParsedSheetRow = {};
    for (let c = 0; c < rawHeaders.length; c++) {
      const h = rawHeaders[c]!;
      const val = (rowValues[c] ?? "").trim();
      obj[h] = val;
      // Also register lowercased and stripped key for robust lookups
      const normalizedKey = h.toLowerCase().replace(/[\s_\-()]+/g, "");
      if (!obj[normalizedKey]) {
        obj[normalizedKey] = val;
      }
    }
    // Check if row has any identifier (SKU, Title, Handle, Name, etc.)
    const hasIdentifier =
      obj["SKU"] ||
      obj["Title"] ||
      obj["Grouped SKU"] ||
      obj["sku"] ||
      obj["title"] ||
      obj["name"] ||
      obj["handle"] ||
      Object.values(obj).some((v) => v.length > 0);

    if (hasIdentifier) {
      parsedRows.push(obj);
    }
  }

  return parsedRows;
}

function clean(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  const s = String(val).trim();
  if (s === "" || s === "-" || s.toLowerCase() === "nan" || s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
  return s;
}

function toFloat(val: unknown, defaultVal = 0): number {
  const c = clean(val);
  if (!c) return defaultVal;
  const n = parseFloat(c);
  return isNaN(n) ? defaultVal : n;
}

function toInt(val: unknown, defaultVal = 0): number {
  const c = clean(val);
  if (!c) return defaultVal;
  const n = parseInt(c, 10);
  return isNaN(n) ? defaultVal : n;
}

export function collectAttributePairs(row: ParsedSheetRow): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const prefixes = ["Attribute", "Filterable Attribute", "Grouped Attribute"];

  for (const prefix of prefixes) {
    let n = 1;
    while (n <= 30) {
      const nameKey = `${prefix} Name ${n}`;
      const valKey = `${prefix} Value ${n}`;
      if (!(nameKey in row)) break;
      const name = clean(row[nameKey]);
      const val = clean(row[valKey]);
      if (name && val) {
        pairs.push([name, val]);
      }
      n++;
    }
  }
  return pairs;
}

export function buildExtraDetailsBlock(row: ParsedSheetRow, attributePairs: Array<[string, string]>): string {
  const fields: Record<string, string | null> = {
    "SKU": clean(row["SKU"]),
    "Cost Per Item": clean(row["Cost Per Item"]),
    "GTIN/UPC/EAN/HSN": clean(row["GTIN, UPC, EAN, ISBN or HSN"] || row["HSN"]),
    "Style Code": clean(row["Style Code"]),
    "Country of Origin": clean(row["Country Of Origin"] || row["Origin Country"]),
    "Reorder Level": clean(row["Reorder Level"]),
    "Manufacture Date": clean(row["Mfg Date"]),
    "Expiry Date": clean(row["Expiry date"]),
    "Popularity Score": clean(row["Popularity"]),
    "Rank": clean(row["Rank"]),
    "Upsells": clean(row["Upsells"]),
    "Cross-Sells": clean(row["Cross-Sells"]),
    "Return Allowed": clean(row["Return Allowed?"]),
    "Replace Allowed": clean(row["Replace Allowed?"]),
    "Vendor Id": clean(row["Vendor Id"]),
  };

  const lines = Object.entries(fields)
    .filter(([_, v]) => Boolean(v))
    .map(([k, v]) => `${k}: ${v}`);

  if (attributePairs.length > 0) {
    lines.push("Attributes: " + attributePairs.map(([n, v]) => `${n}=${v}`).join("; "));
  }

  if (!lines.length) return "";
  return "\n\n---\nAdditional details:\n" + lines.join("\n");
}

export function buildDescription(row: ParsedSheetRow, attributePairs: Array<[string, string]>): string {
  const bodyHtml = clean(row["Body (HTML)"]);
  const shortDesc = clean(row["Short Description"]);
  const metaDesc = clean(row["Meta Description"]);
  const base = bodyHtml || shortDesc || metaDesc || clean(row["Title"]) || "";
  return base + buildExtraDetailsBlock(row, attributePairs);
}

export function buildTags(row: ParsedSheetRow): string[] {
  const raw: string[] = [];
  for (const col of ["Tags", "Keywords"]) {
    const val = clean(row[col]);
    if (val) {
      raw.push(...val.split(",").map((t) => t.trim()).filter(Boolean));
    }
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const t of raw) {
    const trimmed = t.slice(0, 20);
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      tags.push(trimmed);
    }
    if (tags.length === 13) break;
  }
  return tags;
}

export function buildMaterials(attributePairs: Array<[string, string]>): string[] {
  const materials: string[] = [];
  for (const [name, val] of attributePairs) {
    if (/material|metal|fabric|purity|silver|gold|stone|gemstone|diamond|moissanite/i.test(name)) {
      materials.push(val.slice(0, 45));
    }
  }
  return materials.slice(0, 13);
}

/**
 * Transforms parsed CSV rows into grouped product records.
 */
export function groupSheetRows(rows: ParsedSheetRow[], storeCurrency = "USD"): SheetProductGroup[] {
  // Filter out inactive rows if marked explicitly
  const activeRows = rows.filter((r) => (r["Status"] || "").toLowerCase() !== "inactive");
  const groupsMap = new Map<string, ParsedSheetRow[]>();

  for (const r of activeRows) {
    const styleCode = clean(r["Style Code"] || r["stylecode"] || r["Style code"] || r["StyleCode"]);
    const groupedSku = clean(r["Grouped SKU"] || r["groupedsku"] || r["Group SKU"]);
    const parentSku = clean(r["Parent SKU"] || r["parentsku"] || r["Parent"]);
    const sku = clean(r["SKU"] || r["sku"] || r["Item Code"] || r["itemcode"] || r["Handle"] || r["handle"]) || "UNNAMED";
    const groupKey = styleCode || groupedSku || parentSku || sku;

    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, []);
    }
    groupsMap.get(groupKey)!.push(r);
  }

  const result: SheetProductGroup[] = [];

  for (const [groupKey, groupRows] of groupsMap.entries()) {
    const primary = groupRows[0]!;
    const attributePairs = collectAttributePairs(primary);
    const title = clean(primary["Title"] || primary["title"] || primary["Name"] || primary["name"]) || groupKey;
    const description = buildDescription(primary, attributePairs);
    const categoriesStr = clean(primary["Categories"] || primary["categories"] || primary["Category"] || primary["category"]) || "";
    const tags = buildTags(primary);
    const materials = buildMaterials(attributePairs);

    const weightG = toFloat(primary["Variant Grams"] || primary["Weight (g)"] || primary["Weight"] || primary["weight"], 0);
    const lengthCm = toFloat(primary["Length (cm)"] || primary["Length"] || primary["length"]);
    const widthCm = toFloat(primary["Width (cm)"] || primary["Width"] || primary["width"]);
    const heightCm = toFloat(primary["Height (cm)"] || primary["Height"] || primary["height"]);

    // Collect deduplicated images
    const imageUrls: string[] = [];
    for (const r of groupRows) {
      for (const col of ["Image Src", "Thumbnail", "Image URL", "Images"]) {
        const u = clean(r[col]);
        if (u && !imageUrls.includes(u)) {
          imageUrls.push(u);
        }
      }
    }
    const images: CanonicalImage[] = imageUrls.map((url, i) => ({
      url,
      position: i + 1,
      alt: title,
    }));

    // Build variants
    const variants: CanonicalVariant[] = groupRows.map((r, i) => {
      const variantSku = clean(r["SKU"]) || `${groupKey}-${i + 1}`;
      const priceDollars = toFloat(r["Variant Price"] || r["Price"], 0);
      const compareDollars = toFloat(r["Variant Compare At Price"] || r["Compare At Price"], priceDollars);
      const stock = Math.max(1, toInt(r["Stock"] || r["Quantity"], 1));
      const currency = clean(r["Currency"]) || storeCurrency;

      const variantOptions: Record<string, string> = {};
      const rowAttrs = collectAttributePairs(r);
      for (const [n, v] of rowAttrs) {
        if (/size|color|metal|purity|variant|option|style/i.test(n)) {
          variantOptions[n] = v;
        }
      }

      return {
        sku: variantSku,
        priceCents: Math.round(priceDollars * 100),
        mrpCents: Math.round(compareDollars * 100),
        currency,
        available: stock,
        options: variantOptions,
      };
    });

    const isCustomizable = String(clean(primary["Is Customizable?"])).toUpperCase() === "TRUE";

    const customAttrs: Record<string, string> = {};
    for (const [name, val] of attributePairs) {
      customAttrs[name] = val;
    }

    const styleCodeVal = clean(primary["Style Code"] || primary["stylecode"] || primary["Style code"] || primary["StyleCode"]);
    const slugVal = clean(
      primary["Slug"] ||
      primary["slug"] ||
      primary["Handle"] ||
      primary["handle"] ||
      primary["URL Handle"] ||
      primary["Url Handle"] ||
      primary["url_handle"] ||
      primary["Product URL"] ||
      primary["URL"] ||
      primary["url"]
    );

    result.push({
      groupKey,
      primaryRow: primary,
      rows: groupRows,
      canonical: {
        sku: groupKey,
        title,
        description,
        brand: clean(primary["Vendor Id"] || primary["Brand"]) || "",
        category: categoriesStr,
        weightG,
        dimensions: {
          lengthCm: lengthCm || undefined,
          widthCm: widthCm || undefined,
          heightCm: heightCm || undefined,
        },
        variants,
        images,
        attributes: {
          ...customAttrs,
          slug: slugVal || undefined,
          style_code: styleCodeVal || undefined,
          tags,
          materials,
          is_customizable: isCustomizable,
          item_weight: weightG > 0 ? weightG : undefined,
          item_length: lengthCm || undefined,
          item_width: widthCm || undefined,
          item_height: heightCm || undefined,
        },
      },
    });
  }

  return result;
}
