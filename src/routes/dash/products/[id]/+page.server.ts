import { error, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { authz, planner, repo } from "$server/app";
import { getConnector } from "$server/connectors";
import { brandMark } from "$server/connectors/brand";
import { missingRequiredFields } from "$server/connector";
import { deleteProductFromChannel } from "$server/connectors/service";

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!authz.canAccessProduct(locals.principal!, params.id)) error(404, "Product not found");

  const product = repo.getProduct(params.id);
  const canonical = repo.canonical(params.id);
  if (!product || !canonical) error(404, "Product not found");

  const store = repo.getStore(product.store_id)!;
  const mappingsByChannel = new Map(
    repo.mappingsForProduct(product.id).map((m) => [m.channel_id, m]),
  );

  // Per channel: can it accept this product, and if not, exactly what is missing?
  const channels = repo.listChannels(product.store_id).map((c) => {
    const manifest = getConnector(c.connector).manifest();
    const missing = missingRequiredFields(manifest, canonical);
    const mapping = mappingsByChannel.get(c.id);
    return {
      id: c.id,
      name: c.name,
      connector: c.connector,
      displayName: manifest.displayName,
      mark: brandMark(c.connector, 26),
      status: mapping?.status ?? "PENDING",
      remoteId: mapping?.remote_product_id ?? "",
      lastSyncedAt: mapping?.last_synced_at ?? null,
      lastError: mapping?.last_error ?? "",
      missing: missing.map((f) => ({ label: f.label, path: f.path, help: f.help ?? "" })),
      ready: missing.length === 0,
    };
  });

  return {
    product: {
      id: product.id,
      title: product.title,
      sku: product.sku,
      description: product.description,
      brand: product.brand,
      category: product.category,
      status: product.status,
      hsnCode: product.hsn_code,
      taxRatePct: product.tax_rate_bp / 100,
      weightG: product.weight_g,
      lengthMm: product.length_mm,
      widthMm: product.width_mm,
      heightMm: product.height_mm,
      version: product.version,
      updatedAt: product.updated_at,
      currency: store.currency,
    },
    images: repo.images(product.id).map((i) => ({ id: i.id, url: i.url, alt: i.alt })),
    variants: repo.variants(product.id).map((v) => ({
      id: v.id,
      sku: v.sku,
      barcode: v.barcode,
      options: JSON.parse(v.options || "{}") as Record<string, string>,
      priceCents: v.price_cents,
      mrpCents: v.mrp_cents,
      currency: v.currency,
      available: v.available,
    })),
    attributes: Object.entries(JSON.parse(product.attributes || "{}") as Record<string, unknown>)
      .map(([key, value]) => ({ key, value: String(value) }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    channels,
    readyCount: channels.filter((c) => c.ready).length,
  };
};

export const actions: Actions = {
  publish: async ({ locals, params }) => {
    if (!authz.canAccessProduct(locals.principal!, params.id)) error(403, "forbidden");
    const product = repo.getProduct(params.id)!;
    const queued = planner.planProduct(
      locals.principal!.organizationId,
      product.store_id,
      product.id,
      "PRODUCT_UPDATE",
    );
    return { queued };
  },

  delete: async ({ locals, params }) => {
    if (!authz.canAccessProduct(locals.principal!, params.id)) error(403, "forbidden");
    const product = repo.getProduct(params.id)!;
    const mappings = repo.mappingsForProduct(product.id);
    for (const m of mappings) {
      if (m.remote_product_id) {
        try {
          await deleteProductFromChannel(repo, m.channel_id, product.id);
        } catch (delErr: any) {
          console.error(`[Product Detail Delete] Remote delete failed for channel ${m.channel_id}:`, delErr.message);
        }
      }
    }
    repo.deleteProduct(product.id);
    redirect(303, "/dash/products");
  },
};
