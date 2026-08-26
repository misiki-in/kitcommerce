import { redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { authz, queue, repo } from "$server/app";
import { brandMark } from "$server/connectors/brand";

export const load: PageServerLoad = async ({ locals, url }) => {
  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) redirect(303, "/onboarding/store");

  const filter = url.searchParams.get("filter") ?? "";
  const all = repo.activity(store.id, 300);

  const counts = {
    all: all.length,
    sync: all.filter((e) => e.kind === "sync").length,
    order: all.filter((e) => e.kind === "order").length,
    change: all.filter((e) => e.kind === "change").length,
    failed: all.filter((e) => e.status === "DEAD_LETTER" || e.status === "RETRYING").length,
  };

  const entries = all.filter((e) => {
    if (!filter) return true;
    if (filter === "failed") return e.status === "DEAD_LETTER" || e.status === "RETRYING";
    return e.kind === filter;
  });

  return {
    filter,
    counts,
    entries: entries.map((e) => ({
      ...e,
      mark: e.connector ? brandMark(e.connector, 26) : "",
      retryable: e.kind === "sync" && (e.status === "DEAD_LETTER" || e.status === "RETRYING"),
    })),
  };
};

export const actions: Actions = {
  retry: async ({ request, locals }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!id) return { retried: false };
    // Ownership goes through the chokepoint, never an inline comparison.
    if (!authz.canAccessJob(locals.principal!, id)) return { retried: false };
    queue.retry(id);
    return { retried: true };
  },
};
