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
 * Exchanges code for tokens, saves sealed credentials, auto-detects shop details,
 * and lands the seller back on the channels page with success indicator.
 */
export const GET: RequestHandler = async ({ params, url, cookies, locals }) => {
  const provider = oauthProvider(params.provider);
  if (!provider) error(404, "unknown marketplace");

  const back = (query: string) => redirect(303, `/dash/channels?${query}`);

  // The seller pressed "cancel" on the consent screen, or the marketplace
  // rejected the request outright.
  const denied = url.searchParams.get("error");
  if (denied) return back(`oauth_error=${encodeURIComponent(denied)}`);

  const query = Object.fromEntries(url.searchParams);
  const code = query[provider.codeParam ?? "code"];
  const state = url.searchParams.get("state");
  const expectedState = cookies.get("oc_oauth_state");
  const verifier = cookies.get("oc_oauth_verifier");
  const customClientId = cookies.get("oc_oauth_client_id");
  const customSharedSecret = cookies.get("oc_oauth_shared_secret");
  const customRedirectUri = cookies.get("oc_oauth_redirect_uri");

  const scope = { path: `/auth/${provider.connector}` };
  cookies.delete("oc_oauth_state", scope);
  cookies.delete("oc_oauth_verifier", scope);
  cookies.delete("oc_oauth_client_id", scope);
  cookies.delete("oc_oauth_shared_secret", scope);
  cookies.delete("oc_oauth_redirect_uri", scope);

  if (!code) return back("oauth_error=no+code+returned");

  if (!state || !expectedState || state !== expectedState) {
    return back("oauth_error=the+link+expired,+please+try+again");
  }
  if (provider.pkce && !verifier) {
    return back("oauth_error=the+link+expired,+please+try+again");
  }

  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) return back("oauth_error=no+store");

  let result;
  try {
    result = await provider.exchange({
      code: code!,
      redirectUri: customRedirectUri || `${url.origin}/auth/${provider.connector}/callback`,
      verifier,
      clientId: customClientId,
      sharedSecret: customSharedSecret,
      params: query,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message.slice(0, 200) : "token exchange failed";
    return back(`oauth_error=${encodeURIComponent(detail)}`);
  }

  const connector = getConnector(provider.connector);
  const manifest = connector.manifest();

  const existing = repo.listChannels(store.id).find((c) => c.connector === provider.connector);

  let initialConfig: Record<string, any> = { ...(result!.channelConfig ?? {}) };

  // Dynamic Plug-and-Play Discovery: If connector implements discover(), run it automatically
  if (typeof connector.discover === "function") {
    try {
      const { normalizeDiscoveredConfig } = await import("$server/connectors/service");
      const ctx = {
        config: initialConfig,
        credentials: result!.credentials,
        seller: {
          storeName: store.name,
          description: store.description,
          logoUrl: store.logo_url,
          legalName: store.legal_name,
          businessType: store.business_type,
          taxId: store.tax_id,
          registrationNo: store.registration_no,
          supportEmail: store.support_email,
          supportPhone: store.support_phone,
          website: store.website,
          currency: store.currency,
          address: {
            line1: store.address_line1,
            line2: store.address_line2,
            city: store.city,
            state: store.state,
            postalCode: store.postal_code,
            country: store.country,
          },
        },
        log: () => {},
      };

      const discoveredData = await connector.discover(ctx);
      if (discoveredData && typeof discoveredData === "object") {
        const normalized = normalizeDiscoveredConfig(provider.connector, discoveredData);
        initialConfig = { ...initialConfig, ...normalized };
      }
    } catch (discErr) {
      console.warn(`[OAuth Callback Discovery Note] ${provider.connector}:`, discErr);
    }
  }

  const channel =
    existing ??
    repo.createChannel({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      connector: provider.connector,
      name: `${manifest.displayName} — ${store.name}`,
      mode: "live",
      config: initialConfig,
    });

  if (existing && Object.keys(initialConfig).length > 0) {
    let existingCfg: Record<string, unknown> = {};
    try {
      existingCfg = typeof existing.config === "string" ? JSON.parse(existing.config || "{}") : (existing.config || {});
    } catch {}
    const mergedCfg = { ...existingCfg, ...initialConfig };
    repo.updateChannel(channel.id, { config: mergedCfg });
  }

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
        channel.connector,
        manifest.authentication.type,
        sealed,
        now,
        now,
      ],
    );
  }

  repo.setChannelHealth(channel.id, "OK", "Connected via OAuth");

  repo.audit({
    orgId: locals.principal!.organizationId,
    storeId: store.id,
    actorUserId: locals.principal!.user.id,
    action: "channel.connected",
    entityType: "channel",
    entityId: channel.id,
    metadata: { connector: provider.connector, via: "oauth" },
  });

  return back(`connected=${encodeURIComponent(channel.name)}`);
};
