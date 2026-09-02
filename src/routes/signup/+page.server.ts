import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { auth, config } from "$server/app";
import { AuthError } from "$server/auth";

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.principal) redirect(303, "/dash");
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    if (!name) {
      return fail(400, { name, email, error: "Please enter your name" });
    }

    try {
      const principal = await auth.signup(email, password, name);
      const sid = auth.createSession(principal.user.id);
      cookies.set("oc_session", sid, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });
    } catch (e) {
      return fail(400, {
        name,
        email,
        error: e instanceof AuthError ? e.message : "Sign up failed",
      });
    }
    redirect(303, "/dash");
  },
};
