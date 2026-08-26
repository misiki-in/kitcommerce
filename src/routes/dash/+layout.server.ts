import type { LayoutServerLoad } from "./$types";
import { repo } from "$server/app";

/**
 * Everything the chrome needs: who is signed in and which store they own.
 *
 * Every path under /dash sits behind the session check in hooks.server.ts, so
 * the principal is guaranteed by the time this runs — the chrome no longer has
 * a signed-out case to render.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
  const principal = locals.principal!;
  const store = repo.storesForOrg(principal.organizationId)[0] ?? null;

  return {
    user: principal.user,
    store: store ? { id: store.id, name: store.name, logoUrl: store.logo_url } : null,
  };
};
