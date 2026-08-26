import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { callbackUrl, newState, oauthProvider, pkcePair } from "$server/oauth";

/**
 * Start of a marketplace OAuth handshake.
 *
 * Behind the session check in hooks, deliberately: this hands a seller off to a
 * marketplace to grant access to *their* shop, and the token comes back bound
 * to whichever organisation started the flow. An unauthenticated start would
 * have nowhere to put the result.
 *
 * The state and PKCE verifier ride back in cookies rather than in the database.
 * They live for ten minutes, belong to one browser mid-redirect, and are
 * meaningless afterwards — a row in a table would outlive its usefulness and
 * need cleaning up.
 */
export const GET: RequestHandler = ({ params, cookies }) => {
  const provider = oauthProvider(params.provider);
  if (!provider) error(404, "unknown marketplace");
  if (!provider.enabled()) {
    error(503, `${provider.label} OAuth is not configured on this installation`);
  }

  const state = newState();
  const redirectUri = callbackUrl(provider.connector);

  // Scoped to this provider's path so two half-finished connects cannot read
  // each other's verifier.
  const scope = { path: `/auth/${provider.connector}`, httpOnly: true, sameSite: "lax" as const, maxAge: 600 };
  cookies.set("oc_oauth_state", state, scope);

  let challenge: string | undefined;
  if (provider.pkce) {
    const pair = pkcePair();
    challenge = pair.challenge;
    cookies.set("oc_oauth_verifier", pair.verifier, scope);
  }

  redirect(302, provider.authorizeUrl({ redirectUri, state, challenge }));
};
