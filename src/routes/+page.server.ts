import type { PageServerLoad } from "./$types";
import { CONNECTOR_GROUPS, connectors } from "$server/connectors";
import { brandMark } from "$server/connectors/brand";
import { BACKOFF_MS } from "$server/drivers/queue.sqlite";

/**
 * The landing page.
 *
 * Everything shown here is read from the running system rather than retyped
 * into the markup: the channel list is the connector registry, the retry ladder
 * is the queue driver's own BACKOFF_MS. A marketing page that drifts from
 * the product is a bug; this one cannot drift, because adding a connector adds
 * a row and changing the backoff changes the ladder.
 */

/** 5_000 -> "5s", 1_800_000 -> "30m". */
function humanDelay(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

export const load: PageServerLoad = async () => {
  /** The seed catalogue's first SKU, so the page and `bun seed` agree. */
  const sku = "MSK-SAREE-001";

  const group = new Map<string, string>();
  for (const g of CONNECTOR_GROUPS) for (const n of g.names) group.set(n, g.label);

  const channels = Object.values(connectors).map((c) => {
    const m = c.manifest();
    return {
      name: m.name,
      displayName: m.displayName,
      group: group.get(m.name) ?? "Other",
      ready: m.status === "ready",
      regions: m.regions,
      remoteId: m.idPrefix ? `${m.idPrefix}-${sku}` : sku,
      orderImport: m.capabilities.orderImport,
      mark: brandMark(m.name, 26),
    };
  });

  /*
   * Grouped for display, in the registry's own order: India horizontal, then
   * fashion & beauty, then quick commerce, then global. Fourteen marks in one
   * undifferentiated grid is a wall; the four groups are the same taxonomy the
   * connector picker in the dashboard uses, so the landing page and the app
   * describe the catalogue the same way.
   */
  const byGroup = CONNECTOR_GROUPS.map((g) => ({
    label: g.label,
    channels: g.names
      .map((n) => channels.find((c) => c.name === n)!)
      .filter(Boolean)
      /*
       * Ready first inside each group, registry order after.
       *
       * The groups answer "does this cover my market"; the ordering inside them
       * answers "what can I actually use today", which is the question someone
       * is really asking when they scan a connector list. Sorting rather than
       * regrouping keeps the market taxonomy intact — a seller looking for
       * quick commerce still finds all three together, they just find the
       * usable ones at the top of the row.
       *
       * Array.sort is stable, so everything that is not ready keeps the order
       * the registry declared it in.
       */
      .sort((a, b) => Number(b.ready) - Number(a.ready)),
  })).filter((g) => g.channels.length > 0);

  return {
    sku,
    channels,
    byGroup,
    groups: CONNECTOR_GROUPS,
    ladder: BACKOFF_MS.map(humanDelay),
    counts: {
      channels: channels.length,
      ready: channels.filter((c) => c.ready).length,
      /*
       * Counted from the registry's own grouping, not from `regions`. eBay and
       * Etsy both list IN among the markets they reach, so a regions filter
       * returns all fourteen — true, and badly misleading next to a README that
       * files those two under "Global". Twelve is the number a reader means
       * when they ask how much of this is built for India.
       */
      india: channels.filter((c) => c.group.startsWith("India")).length,
    },
  };
};
