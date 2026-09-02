import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { callbackUrl, newState, oauthProvider, pkcePair } from "$server/oauth";

/**
 * Start of a marketplace OAuth handshake.
 *
 * Saves PKCE verifier, client_id, and shared_secret in cookies and redirects
 * the seller directly to the marketplace consent screen.
 */
export const GET: RequestHandler = ({ params, url, cookies }) => {
  const provider = oauthProvider(params.provider);
  if (!provider) error(404, "unknown marketplace");
  if (!provider.enabled()) {
    error(503, `${provider.label} OAuth is not configured on this installation`);
  }

  const clientId = (url.searchParams.get("client_id") || url.searchParams.get("keystring") || "").trim();
  const sharedSecret = (url.searchParams.get("shared_secret") || "").trim();
  const customRedirect = url.searchParams.get("redirect_uri")?.trim();

  const state = newState();
  const redirectUri = customRedirect || `${url.origin}/auth/${provider.connector}/callback`;

  // Scoped to this provider's path so two half-finished connects cannot read
  // each other's verifier.
  const scope = { path: `/auth/${provider.connector}`, httpOnly: true, sameSite: "lax" as const, maxAge: 600 };
  cookies.set("oc_oauth_state", state, scope);

  if (clientId) cookies.set("oc_oauth_client_id", clientId, scope);
  if (sharedSecret) cookies.set("oc_oauth_shared_secret", sharedSecret, scope);
  if (customRedirect) cookies.set("oc_oauth_redirect_uri", customRedirect, scope);

  let challenge: string | undefined;
  if (provider.pkce) {
    const pair = pkcePair();
    challenge = pair.challenge;
    cookies.set("oc_oauth_verifier", pair.verifier, scope);
  }

  redirect(302, provider.authorizeUrl({ redirectUri, state, challenge, clientId }));
};
