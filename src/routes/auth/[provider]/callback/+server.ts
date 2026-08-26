import { error, redirect } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { repo } from "$server/app";
import { config } from "$server/config";
import { localSecrets } from "$server/drivers";
import { newId } from "$server/ids";
import { getConnector } from "$server/connectors";
import { callbackUrl, oauthProvider } from "$server/oauth";

const secrets = localSecrets(config.secretKey);

/**
 * Return leg of a marketplace OAuth handshake.
 *
 * Everything that can go wrong here lands the seller back on the channels page
 * with a message rather than on a stack trace: a denied consent screen is a
 * normal outcome, not an exception, and so is coming back to a tab whose
 * ten-minute cookie has expired.
 */
export const GET: RequestHandler = async ({ params, url, cookies, locals }) => {
  const provider = oauthProvider(params.provider);
  if (!provider) error(404, "unknown marketplace");

  const back = (query: string) => redirect(303, `/dash/channels?${query}`);

  // The seller pressed "cancel" on the consent screen, or the marketplace
  // rejected the request outright.
  const denied = url.searchParams.get("error");
  if (denied) back(`oauth_error=${encodeURIComponent(denied)}`);

  const query = Object.fromEntries(url.searchParams);
  const code = query[provider.codeParam ?? "code"];
  const state = url.searchParams.get("state");
  const expectedState = cookies.get("oc_oauth_state");
  const verifier = cookies.get("oc_oauth_verifier");

  const scope = { path: `/auth/${provider.connector}` };
  cookies.delete("oc_oauth_state", scope);
  cookies.delete("oc_oauth_verifier", scope);

  if (!code) back("oauth_error=no+code+returned");

  /*
   * State has to match the cookie this browser was given at the start. Without
   * it, anyone could hand a signed-in seller a crafted callback URL and attach
   * their own marketplace account to that seller's store — the tokens would be
   * real, the shop behind them would not be theirs.
   */
  if (!state || !expectedState || state !== expectedState) {
    back("oauth_error=the+link+expired,+please+try+again");
  }
  if (provider.pkce && !verifier) {
    back("oauth_error=the+link+expired,+please+try+again");
  }

  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) back("oauth_error=no+store");

  let result;
  try {
    result = await provider.exchange({
      code: code!,
      redirectUri: callbackUrl(provider.connector),
      verifier,
      params: query,
    });
  } catch (e) {
    // The provider's own words, truncated. Its message is the only thing that
    // distinguishes a stale code from a mismatched redirect URI.
    const detail = e instanceof Error ? e.message.slice(0, 200) : "token exchange failed";
    back(`oauth_error=${encodeURIComponent(detail)}`);
  }

  const manifest = getConnector(provider.connector).manifest();

  /*
   * Reconnecting replaces the credentials on the existing channel rather than
   * adding a second one. A seller re-running this because a token expired means
   * "fix this connection", and two rows for one shop would double every sync.
   */
  const existing = repo.listChannels(store.id).find((c) => c.connector === provider.connector);

  const channel =
    existing ??
    repo.createChannel({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      connector: provider.connector,
      name: `${manifest.displayName} — ${store.name}`,
      // A token that reaches a real shop is not something to run in mock.
      mode: "live",
      config: result!.channelConfig ?? {},
    });

  const sealed = await secrets.seal(result!.credentials);
  const now = Date.now();

  const prior = repo.db.get<{ id: string }>(
    "SELECT id FROM credentials WHERE channel_id = ?",
    [channel.id],
  );

  if (prior) {
    repo.db.run("UPDATE credentials SET ciphertext = ?, updated_at = ? WHERE id = ?", [
      sealed,
      now,
      prior.id,
    ]);
  } else {
    repo.db.run(
      `INSERT INTO credentials
         (id, organization_id, store_id, channel_id, provider, auth_type, ciphertext, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        newId("cred"),
        locals.principal!.organizationId,
        store.id,
        channel.id,
        provider.connector,
        manifest.authentication.type,
        sealed,
        now,
        now,
      ],
    );
  }

  back(`connected=${encodeURIComponent(manifest.displayName)}`);
};
