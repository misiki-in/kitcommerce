import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { repo } from "$server/app";
import { suggestAll } from "$server/suggest";

/**
 * A static route, which SvelteKit matches before /products/[id]. Without this
 * file, "new" was being read as a product ID and 404ing.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) redirect(303, "/dash/settings");

  const suggestions = suggestAll(repo, store.id, {});
  return { currency: store.currency, suggestedSku: suggestions.sku };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const store = repo.storesForOrg(locals.principal!.organizationId)[0];
    if (!store) return fail(400, { error: "no store" });

    const form = await request.formData();
    const str = (k: string) => String(form.get(k) ?? "").trim();
    const num = (k: string) => Number(form.get(k) ?? 0) || 0;

    const sku = str("sku");
    const title = str("title");
    if (!sku || !title) return fail(400, { error: "Title and SKU are required." });

    if (repo.getProductBySku(store.id, sku)) {
      return fail(400, { error: `SKU ${sku} is already used by another product.` });
    }

    const price = Math.round(num("price") * 100);
    const image = str("image_url");

    const result = await repo.saveProduct({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      sku,
      title,
      brand: str("brand"),
      category: str("category"),
      description: str("description"),
      // Draft until the review step publishes it, so an abandoned wizard never
      // fans jobs out to live channels.
      status: "DRAFT",
      variants: [
        {
          sku,
          priceCents: price,
          mrpCents: Math.round(num("mrp") * 100) || price,
          currency: store.currency,
          available: num("stock"),
        },
      ],
      images: image ? [{ url: image }] : [],
    });

    redirect(303, `/dash/products/${result.id}/wizard/pricing`);
  },
};
