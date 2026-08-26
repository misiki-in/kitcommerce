import type { Handle } from "@sveltejs/kit";
import { redirect } from "@sveltejs/kit";
import { auth } from "$server/app";

/** Routes reachable without a session. */
const PUBLIC = new Set(["/", "/login", "/signup", "/logout"]);

/**
 * Asset prefixes served without a session.
 *
 * /logos is marketplace artwork — not user data. /uploads is product imagery,
 * which is on its way to public marketplace listings anyway; the filenames are
 * unguessable IDs rather than sequential, so they are not enumerable.
 */
const PUBLIC_PREFIXES = ["/logos/", "/uploads/", "/auth/google"];

/**
 * Resolve the session once per request and hang it on `locals`.
 *
 * Page and API handlers then read `locals.principal` instead of parsing the
 * cookie themselves, and per-resource ownership still goes through the authz
 * chokepoint in $server/auth -- never inline in a route.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const sessionId = event.cookies.get("oc_session") ?? null;
  event.locals.principal = auth.resolveSession(sessionId);

  const path = event.url.pathname;
  const isPublic = PUBLIC.has(path) || PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  if (!isPublic && !event.locals.principal) {
    if (path.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    redirect(303, "/login");
  }

  // Root is the landing page, and it is only for people who are not signed in
  // yet. Anyone with a session is here to work, so send them to the app rather
  // than making them look at a pitch for something they already use.
  if (path === "/" && event.locals.principal) redirect(307, "/dash");

  return resolve(event);
};
