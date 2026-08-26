import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import { repo } from "$server/app";
import { brandMark } from "$server/connectors/brand";

export const load: PageServerLoad = async ({ locals, url }) => {
  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) redirect(303, "/onboarding/store");

  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  let rows = repo.listProducts(store.id, 500);
  if (q) {
    rows = rows.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q),
    );
  }

  return {
    q,
    storeName: store.name,
    products: rows.map((p) => {
      const variants = repo.variants(p.id);
      const images = repo.images(p.id);
      return {
        id: p.id,
        title: p.title,
        sku: p.sku,
        brand: p.brand,
        status: p.status,
        updatedAt: p.updated_at,
        image: images[0]?.url ?? "",
        variants: variants.length,
        stock: variants.reduce((n, v) => n + v.available, 0),
        priceCents: variants[0]?.price_cents ?? 0,
        currency: variants[0]?.currency ?? store.currency,
        mappings: repo.mappingsForProduct(p.id).map((m) => ({
          connector: m.connector,
          status: m.status,
          mark: brandMark(m.connector, 20),
        })),
      };
    }),
  };
};
