import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { auth, config, repo } from "$server/app";
import { AuthError } from "$server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.principal) redirect(303, "/dash");

  /**
   * Prefill the seeded demo credentials so `bun seed && bun dev` is a
   * one-click sign-in. Gated twice: the demo account must exist in this
   * database, and NODE_ENV must not be production.
   */
  const demoExists =
    config.env !== "production" &&
    repo.db.get("SELECT id FROM users WHERE email = ?", [config.demo.email]) != null;

  return { demo: demoExists ? config.demo : null };
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    try {
      const principal = await auth.login(email, password);
      const sid = auth.createSession(principal.user.id);
      cookies.set("oc_session", sid, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });
    } catch (e) {
      return fail(401, {
        email,
        error: e instanceof AuthError ? e.message : "sign in failed",
      });
    }
    redirect(303, "/dash");
  },
};
