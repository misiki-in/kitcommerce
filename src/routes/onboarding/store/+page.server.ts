import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { authz, repo } from "$server/app";

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.principal) redirect(303, "/login");

  const existing = repo.storesForOrg(locals.principal.organizationId)[0];
  if (existing) {
    redirect(303, "/dash");
  }

  return {
    userName: locals.principal.user.name,
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.principal) redirect(303, "/login");

    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const currency = String(form.get("currency") ?? "INR").trim();
    const country = String(form.get("country") ?? "IN").trim();
    const description = String(form.get("description") ?? "").trim();
    const businessType = String(form.get("business_type") ?? "").trim();

    if (!name) {
      return fail(400, { name, error: "Store name is required." });
    }

    if (!authz.canCreateStore(locals.principal)) {
      return fail(403, { error: "Store creation limit reached for this organization." });
    }

    const store = repo.createStore(locals.principal.organizationId, name);
    repo.updateStore(store.id, {
      currency,
      country,
      description,
      business_type: businessType,
    });

    redirect(303, "/dash");
  },
};
