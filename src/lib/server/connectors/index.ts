/**
 * Connector registry.
 *
 * This map is the ONLY core file a new marketplace touches. Adding a connector
 * is: write one file, add one line here. Nothing in the sync engine, the API or
 * the dashboard knows a connector's name.
 */
import type { MarketplaceConnector } from "../connector";
import { amazon } from "./amazon";
import { ebay } from "./ebay";
import { etsy } from "./etsy";
import { shopify } from "./shopify";
import { flipkart } from "./flipkart";
import { meesho } from "./meesho";
import { ajio, jiomart, myntra, nykaa, snapdeal, tatacliq } from "./india";
import { blinkit, instamart, zepto } from "./quickcommerce";
import { facebook, instagram } from "./social";
import { tiktok } from "./tiktok";

export const connectors: Record<string, MarketplaceConnector> = {
  // India — horizontal
  amazon,
  flipkart,
  meesho,
  jiomart,
  snapdeal,
  tatacliq,
  // India — fashion & beauty
  myntra,
  ajio,
  nykaa,
  // India — quick commerce (per-dark-store inventory)
  zepto,
  instamart,
  blinkit,
  // Social — a catalogue browsed in-feed, not a marketplace. Meta's two
  // surfaces share one catalogue; TikTok Shop is absent from India entirely.
  instagram,
  facebook,
  tiktok,
  // Global
  ebay,
  etsy,
  // Webstore platforms
  shopify,
};

/**
 * Grouping used by the dashboard's connector picker and the landing page.
 *
 * Derived from the manifests rather than written out, so it cannot fall out of
 * step with the map above. Group order follows first appearance in the
 * registry, which is why that map is ordered by market rather than
 * alphabetically.
 */
export const CONNECTOR_GROUPS: Array<{ label: string; names: string[] }> = (() => {
  const order: string[] = [];
  const byGroup = new Map<string, string[]>();

  for (const connector of Object.values(connectors)) {
    const { group, name } = connector.manifest();
    if (!byGroup.has(group)) {
      byGroup.set(group, []);
      order.push(group);
    }
    byGroup.get(group)!.push(name);
  }

  return order.map((label) => ({ label, names: byGroup.get(label)! }));
})();

/** The connectors a seller can point a real catalogue at today. */
export function readyConnectors(): string[] {
  return Object.values(connectors)
    .filter((c) => c.manifest().status === "ready")
    .map((c) => c.manifest().name);
}

export function getConnector(name: string): MarketplaceConnector {
  const c = connectors[name];
  if (!c) throw new Error(`unknown connector: ${name}`);
  return c;
}

export function listManifests() {
  return Object.values(connectors).map((c) => c.manifest());
}
