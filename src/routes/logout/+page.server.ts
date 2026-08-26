import { redirect } from "@sveltejs/kit";
import type { Actions } from "./$types";
import { auth } from "$server/app";

export const actions: Actions = {
  default: async ({ cookies }) => {
    const sid = cookies.get("oc_session");
    if (sid) auth.destroySession(sid);
    cookies.delete("oc_session", { path: "/" });
    redirect(303, "/login");
  },
};

/** A GET here is always a stale link; send it somewhere useful. */
export const load = () => redirect(303, "/login");
