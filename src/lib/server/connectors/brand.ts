/**
 * Marketplace brand marks.
 *
 * These are brand-COLOURED marks drawn here, not the marketplaces' official
 * logo files. Two reasons: shipping third-party trademarked assets in an
 * open-source repo carries licensing questions we should not hand to every
 * contributor, and hotlinking their CDNs would break the offline guarantee.
 *
 * To use real licensed artwork instead, drop files into `data/logos/`:
 *
 *     data/logos/meesho.svg      data/logos/amazon.png
 *
 * The file name must match the connector name. Anything found there is served
 * from /logos/<name> and used in place of the drawn mark, with no code change.
 *
 * Colours are approximations of each brand's primary palette. If exact brand
 * compliance matters to you, check them against the marketplace's own brand
 * guidelines before shipping.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config";

export interface Brand {
  /** Tile background. */
  bg: string;
  /** Glyph colour on that background. */
  fg: string;
  /** Letterform shown when there is no custom path. */
  glyph: string;
  /** Optional extra SVG drawn over the tile, in brand colours. */
  art?: string;
}

export const BRANDS: Record<string, Brand> = {
  amazon: {
    bg: "#232F3E",
    fg: "#FF9900",
    glyph: "a",
    // The smile arc, the one element that reads as Amazon at 32px.
    art: `<path d="M7 22.5c3.4 2 7.4 3 11.2 2.6 1.6-.2 3.4-.7 4.8-1.6.4-.3.1-.8-.4-.6-2.6 1-5.4 1.4-8 1.2-2.6-.2-5.2-1-7.4-2.2-.3-.2-.5.3-.2.6z" fill="#FF9900"/>`,
  },
  flipkart: { bg: "#2874F0", fg: "#FFE11B", glyph: "F" },
  meesho: { bg: "#F43397", fg: "#FFFFFF", glyph: "m" },
  myntra: { bg: "#FF3F6C", fg: "#FFFFFF", glyph: "M" },
  ajio: { bg: "#2C4152", fg: "#FFFFFF", glyph: "A" },
  jiomart: { bg: "#008ECC", fg: "#FFFFFF", glyph: "J" },
  nykaa: { bg: "#FC2779", fg: "#FFFFFF", glyph: "N" },
  tatacliq: { bg: "#D91E4A", fg: "#FFFFFF", glyph: "T" },
  snapdeal: { bg: "#E40046", fg: "#FFFFFF", glyph: "S" },
  zepto: { bg: "#4C1D95", fg: "#FFFFFF", glyph: "Z" },
  instamart: { bg: "#FC8019", fg: "#FFFFFF", glyph: "S" },
  blinkit: { bg: "#F8CB46", fg: "#1A1A1A", glyph: "b" },
  ebay: {
    bg: "#FFFFFF",
    fg: "#333333",
    glyph: "e",
    // eBay's four-colour wordmark is its whole identity; approximate with dots.
    art: `<g><circle cx="9" cy="24" r="2" fill="#E53238"/><circle cx="15" cy="24" r="2" fill="#0064D2"/><circle cx="21" cy="24" r="2" fill="#F5AF02"/><circle cx="27" cy="24" r="2" fill="#86B817"/></g>`,
  },
  etsy: { bg: "#F1641E", fg: "#FFFFFF", glyph: "E" },
  // Social.
  meta: {
    bg: "#0064E0",
    fg: "#FFFFFF",
    glyph: "M",
    art: `<path d="M10 20.5c-2.2 0-3.8-1.6-3.8-3.5s1.6-3.5 3.8-3.5c2 0 3.5 2 4.2 3 .3.5 1.3.5 1.6 0 .7-1 2.2-3 4.2-3 2.2 0 3.8 1.6 3.8 3.5s-1.6 3.5-3.8 3.5c-2 0-3.5-2-4.2-3-.3-.5-1.3-.5-1.6 0-.7 1-2.2 3-4.2 3z" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  instagram: { bg: "#C13584", fg: "#FFFFFF", glyph: "ig" },
  facebook: { bg: "#1877F2", fg: "#FFFFFF", glyph: "f" },
  tiktok: { bg: "#010101", fg: "#25F4EE", glyph: "t" },
  litekart: { bg: "#0F172A", fg: "#38BDF8", glyph: "L" },
};

const FALLBACK: Brand = { bg: "#E3E6EA", fg: "#16191D", glyph: "?" };

/**
 * Connector names with a licensed asset in data/logos/. Read once at startup:
 * a filesystem check per tile per render would be silly for a set that only
 * changes when someone adds a file.
 */
const overrides = new Map<string, string>();
try {
  const dir = join(config.dataDir, "logos");
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      const dot = file.lastIndexOf(".");
      if (dot <= 0) continue;
      const name = file.slice(0, dot).toLowerCase();
      if (/\.(svg|png|jpg|jpeg|webp|avif|ico)$/i.test(file)) overrides.set(name, file);
    }
  }
} catch {
  /* no logo directory is the normal case */
}

const channelLogoOverrides = new Map<string, string>();
try {
  const staticChannelsDir = join(process.cwd(), "static", "channels");
  if (existsSync(staticChannelsDir)) {
    for (const file of readdirSync(staticChannelsDir)) {
      const dot = file.lastIndexOf(".");
      if (dot <= 0) continue;
      const name = file.slice(0, dot).toLowerCase();
      if (/\.(svg|png|jpg|jpeg|webp|avif|ico)$/i.test(file)) {
        channelLogoOverrides.set(name, file);
      }
    }
  }
} catch {
  /* no static channels directory */
}

export function logoOverrideFile(name: string): string | null {
  return overrides.get(name.toLowerCase()) ?? null;
}

export function channelLogoFile(name: string): string | null {
  return channelLogoOverrides.get(name.toLowerCase()) ?? null;
}

export function hasLogoOverride(name: string): boolean {
  return overrides.has(name.toLowerCase()) || channelLogoOverrides.has(name.toLowerCase());
}

/**
 * A square brand tile. Returns an <img> when licensed artwork was dropped in,
 * otherwise an inline SVG so there is no extra request and nothing to 404.
 */
export function brandMark(name: string, size = 34): string {
  const norm = name.toLowerCase();
  const channelFile = channelLogoFile(norm);
  if (channelFile) {
    return `<img class="mk-mark" src="/channels/${encodeURIComponent(channelFile)}" alt="${name}" width="${size}" height="${size}" style="max-height:${size}px;max-width:${Math.round(size * 1.8)}px;object-fit:contain;display:inline-block;vertical-align:middle" loading="lazy">`;
  }

  if (hasLogoOverride(name)) {
    return `<img class="mk-mark" src="/logos/${encodeURIComponent(name)}" alt="" width="${size}" height="${size}" style="max-height:${size}px;max-width:${Math.round(size * 1.8)}px;object-fit:contain;display:inline-block;vertical-align:middle" loading="lazy">`;
  }

  const b = BRANDS[norm] ?? FALLBACK;
  const radius = Math.round(size * 0.28);
  return `<svg class="mk-mark" width="${size}" height="${size}" viewBox="0 0 34 34" role="img" aria-hidden="true">
    <rect width="34" height="34" rx="${radius}" fill="${b.bg}"/>
    <text x="17" y="17" fill="${b.fg}" font-size="19" font-weight="700"
          font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          text-anchor="middle" dominant-baseline="central">${b.glyph}</text>
    ${b.art ?? ""}
  </svg>`;
}
