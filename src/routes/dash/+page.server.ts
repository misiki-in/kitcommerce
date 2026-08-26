import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { repo } from "$server/app";
import { brandMark } from "$server/connectors/brand";

/**
 * The dashboard, ordered by what a merchant actually needs: anything broken
 * first, then the numbers, then the channels, then the day's trade.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const principal = locals.principal!;
  const store = repo.storesForOrg(principal.organizationId)[0];
  if (!store) redirect(303, "/onboarding/store");

  const products = repo.listProducts(store.id, 1000);
  const channels = repo.listChannels(store.id);
  const stats = repo.jobStats(store.id);
  const orders = repo.listOrders(store.id, 1000);

  let variantCount = 0;
  let stockCount = 0;

  /**
   * Out of stock is the one catalogue number a merchant acts on the same day:
   * a zero-stock variant is still listed on every channel and still taking
   * orders it cannot fill. Low stock is included as the early warning.
   */
  const LOW_STOCK = 5;
  const outOfStock: Array<{
    id: string; title: string; sku: string; image: string;
    variantSku: string; options: string; available: number; channels: number;
  }> = [];

  for (const p of products) {
    const images = repo.images(p.id);
    const mapped = repo.mappingsForProduct(p.id).filter((m) => m.remote_product_id).length;
    for (const v of repo.variants(p.id)) {
      variantCount++;
      stockCount += v.available;
      if (v.available <= LOW_STOCK) {
        const options = Object.entries(JSON.parse(v.options || "{}") as Record<string, string>)
          .map(([k, val]) => `${k}: ${val}`)
          .join(" · ");
        outOfStock.push({
          id: p.id,
          title: p.title,
          sku: p.sku,
          image: images[0]?.url ?? "",
          variantSku: v.sku,
          options,
          available: v.available,
          channels: mapped,
        });
      }
    }
  }
  // Emptiest first — those are the ones already failing orders.
  outOfStock.sort((a, b) => a.available - b.available);

  let liveListings = 0;
  let incomplete = 0;
  const channelCards = channels.map((c) => {
    const mapped = repo.mappingsForChannel(c.id);
    const live = mapped.filter((m) => m.remote_product_id).length;
    liveListings += live;
    incomplete += mapped.filter((m) => m.status === "INCOMPLETE").length;
    // Channels carry no sync timestamp of their own, so the freshest listing
    // push on the channel is what "last synced" means here.
    const lastSyncedAt =
      mapped.reduce((n, m) => Math.max(n, m.last_synced_at ?? 0), 0) || null;

    return {
      id: c.id,
      name: c.name,
      connector: c.connector,
      status: c.status,
      mode: c.mode,
      live,
      total: mapped.length,
      lastSyncedAt,
      mark: brandMark(c.connector, 34),
    };
  });

  const profileGaps = (
    [
      ["legal_name", "legal name"],
      ["tax_id", "tax ID"],
      ["address_line1", "address"],
      ["city", "city"],
      ["postal_code", "postal code"],
      ["support_email", "support email"],
    ] as Array<[keyof typeof store, string]>
  )
    .filter(([k]) => !String(store[k] ?? "").trim())
    .map(([, label]) => label);

  return {
    store: {
      name: store.name,
      logoUrl: store.logo_url,
      currency: store.currency,
    },
    lowStockThreshold: LOW_STOCK,
    outOfStock: outOfStock.slice(0, 8),
    outOfStockTotal: outOfStock.length,
    counts: {
      products: products.length,
      outOfStock: outOfStock.filter((v) => v.available === 0).length,
      variants: variantCount,
      stock: stockCount,
      channels: channels.length,
      liveListings,
      incomplete,
      orders: orders.length,
      revenue: orders.reduce((n, o) => n + o.total_cents, 0),
    },
    stats,
    profileGaps,
    unhealthy: channels
      .filter((c) => c.status !== "HEALTHY" && c.status !== "UNKNOWN")
      .map((c) => ({ name: c.name, status: c.status })),
    channels: channelCards,
    orders: orders.slice(0, 6).map((o) => ({
      id: o.id,
      externalId: o.external_id,
      source: o.source,
      customer: (JSON.parse(o.customer || "{}") as { name?: string }).name ?? "",
      totalCents: o.total_cents,
      currency: o.currency,
      createdAt: o.created_at,
      mark: brandMark(o.source, 26),
    })),
  };
};
