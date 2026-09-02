import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { authz, repo } from "$server/app";
import { config } from "$server/config";
import { localSecrets } from "$server/drivers";
import { newId } from "$server/ids";
import { CONNECTOR_GROUPS, getConnector, listManifests } from "$server/connectors";
import { enabledOAuthConnectors } from "$server/oauth";
import { brandMark } from "$server/connectors/brand";

const secrets = localSecrets(config.secretKey);

export const load: PageServerLoad = async ({ locals }) => {
  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) redirect(303, "/onboarding/store");

  const manifests = new Map(listManifests().map((m) => [m.name, m]));
  const oauthReady = new Set(enabledOAuthConnectors());

  const connected = repo.listChannels(store.id);
  const connectedNames = new Set(connected.map((c) => c.connector));

  const connectedWithDetails = await Promise.all(
    connected.map(async (c) => {
      const mapped = repo.mappingsForChannel(c.id);
      const manifest = manifests.get(c.connector);
      let storedCredKeys: string[] = [];

      const credRow = repo.db.get<{ ciphertext: Uint8Array }>(
        "SELECT ciphertext FROM credentials WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
        [c.id],
      );
      if (credRow?.ciphertext) {
        try {
          const decrypted = await secrets.open<Record<string, string>>(new Uint8Array(credRow.ciphertext));
          storedCredKeys = Object.keys(decrypted).filter((k) => Boolean(decrypted[k]));
        } catch {}
      }

      return {
        id: c.id,
        name: c.name,
        connector: c.connector,
        displayName: manifest?.displayName ?? c.connector,
        status: c.status,
        lastError: c.last_error,
        lastCheckedAt: c.last_health_at,
        config: c.config || "{}",
        hasCredentials: storedCredKeys.length > 0,
        storedCredKeys,
        fields: manifest?.authentication.fields ?? [],
        credentialsNote: manifest?.credentialsNote ?? "",
        docsUrl: manifest?.docsUrl ?? "",
        setupGuide: manifest?.setupGuide ?? "",
        live: mapped.filter((m) => m.remote_product_id).length,
        total: mapped.length,
        mark: brandMark(c.connector, 28),
      };
    }),
  );

  return {
    storeName: store.name,
    connected: connectedWithDetails,
    groups: CONNECTOR_GROUPS.map((g) => ({
      label: g.label,
      connectors: g.names
        .flatMap((n) => {
          const m = manifests.get(n);
          if (!m) return [];
          return [{
            name: m.name,
            displayName: m.displayName,
            regions: m.regions,
            authType: m.authentication.type.replace(/_/g, " "),
            rps: m.rateLimits.requestsPerSecond,
            docsUrl: m.docsUrl,
            setupGuide: m.setupGuide,
            credentialsNote: m.credentialsNote,
            fields: m.authentication.fields,
            already: connectedNames.has(n),
            ready: m.status === "ready",
            oauth: oauthReady.has(n),
            mark: brandMark(n, 38),
          }];
        })
        .sort((a, b) => Number(b.ready) - Number(a.ready)),
    })),
  };
};

export const actions: Actions = {
  connect: async ({ request, locals }) => {
    const store = repo.storesForOrg(locals.principal!.organizationId)[0];
    if (!store) return fail(400, { error: "no store" });

    const form = await request.formData();
    const connectorName = String(form.get("connector") ?? "");
    let manifest;
    try {
      manifest = getConnector(connectorName).manifest();
    } catch {
      return fail(400, { error: "unknown marketplace" });
    }

    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(String(form.get("config") ?? "{}") || "{}");
    } catch {
      return fail(400, { error: "Extra config must be valid JSON." });
    }

    const creds: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (k.startsWith("cred_") && String(v).trim()) creds[k.slice(5)] = String(v).trim();
    }
    if (Object.keys(creds).length === 0) {
      return fail(400, { error: "Please enter credentials before connecting." });
    }

    const channel = repo.createChannel({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      connector: connectorName,
      name: String(form.get("name") || `${manifest.displayName} — ${store.name}`),
      mode: "live",
      config: extra,
    });

    if (Object.keys(creds).length > 0) {
      const sealed = await secrets.seal(creds);
      repo.db.run(
        `INSERT INTO credentials
           (id, organization_id, store_id, channel_id, provider, auth_type, ciphertext, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [newId("cred"), locals.principal!.organizationId, store.id, channel.id,
         connectorName, manifest.authentication.type, sealed, Date.now(), Date.now()],
      );
    }
    return { connected: manifest.displayName };
  },

  update: async ({ request, locals }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!authz.canAccessChannel(locals.principal!, id)) return fail(403, { error: "forbidden" });

    const channel = repo.getChannel(id);
    if (!channel) return fail(404, { error: "Channel not found." });

    const name = String(form.get("name") ?? "").trim() || channel.name;

    let extra: Record<string, unknown> = {};
    try {
      extra = JSON.parse(String(form.get("config") ?? "{}") || "{}");
    } catch {
      return fail(400, { error: "Extra config must be valid JSON." });
    }

    repo.updateChannel(channel.id, { name, config: extra });

    // Handle credential updates (only replace fields that are provided)
    const newCreds: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (k.startsWith("cred_") && String(v).trim()) {
        newCreds[k.slice(5)] = String(v).trim();
      }
    }

    if (Object.keys(newCreds).length > 0) {
      let existingCreds: Record<string, string> = {};
      const credRow = repo.db.get<{ id: string; ciphertext: Uint8Array }>(
        "SELECT id, ciphertext FROM credentials WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
        [channel.id],
      );
      if (credRow?.ciphertext) {
        try {
          existingCreds = await secrets.open<Record<string, string>>(new Uint8Array(credRow.ciphertext));
        } catch {}
      }

      const merged = { ...existingCreds, ...newCreds };
      const sealed = await secrets.seal(merged);

      if (credRow?.id) {
        repo.db.run(
          "UPDATE credentials SET ciphertext = ?, updated_at = ? WHERE id = ?",
          [sealed, Date.now(), credRow.id],
        );
      } else {
        const manifest = getConnector(channel.connector).manifest();
        repo.db.run(
          `INSERT INTO credentials
             (id, organization_id, store_id, channel_id, provider, auth_type, ciphertext, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [newId("cred"), locals.principal!.organizationId, channel.store_id, channel.id,
           channel.connector, manifest.authentication.type, sealed, Date.now(), Date.now()],
        );
      }
    }

    return { updated: name };
  },

  test: async ({ request, locals }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!authz.canAccessChannel(locals.principal!, id)) return fail(403, { error: "forbidden" });

    const channel = repo.getChannel(id)!;
    const store = repo.getStore(channel.store_id)!;
    const connector = getConnector(channel.connector);

    let creds: Record<string, string> = {};
    const row = repo.db.get<{ ciphertext: Uint8Array }>(
      "SELECT ciphertext FROM credentials WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
      [channel.id],
    );
    if (row?.ciphertext) {
      try {
        creds = await secrets.open<Record<string, string>>(new Uint8Array(row.ciphertext));
      } catch {}
    }

    const cfg = JSON.parse(channel.config || "{}");
    const ctx = {
      config: cfg,
      credentials: creds,
      seller: {
        storeName: store.name, description: store.description, logoUrl: store.logo_url,
        legalName: store.legal_name, businessType: store.business_type, taxId: store.tax_id,
        registrationNo: store.registration_no, supportEmail: store.support_email,
        supportPhone: store.support_phone, website: store.website,
        address: {
          line1: store.address_line1, line2: store.address_line2, city: store.city,
          state: store.state, postalCode: store.postal_code, country: store.country,
        },
        currency: store.currency,
      },
      log: () => {},
    };

    const result = await connector.health(ctx);

    // If health discovered a shop_id that wasn't previously in channel config, persist it
    if (ctx.config.shop_id && !cfg.shop_id) {
      repo.updateChannel(channel.id, { config: ctx.config });
    }

    repo.setChannelHealth(channel.id, result.status, result.detail ?? "");
    return { tested: channel.name, status: result.status, detail: result.detail ?? "" };
  },

  refreshSettings: async ({ request, locals }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!authz.canAccessChannel(locals.principal!, id)) return fail(403, { error: "forbidden" });

    const channel = repo.getChannel(id);
    if (!channel) return fail(404, { error: "Channel not found." });

    const store = repo.getStore(channel.store_id)!;

    let creds: Record<string, string> = {};
    const credRow = repo.db.get<{ ciphertext: Uint8Array }>(
      "SELECT ciphertext FROM credentials WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
      [channel.id],
    );
    if (credRow?.ciphertext) {
      try {
        creds = await secrets.open<Record<string, string>>(new Uint8Array(credRow.ciphertext));
      } catch {
        return fail(400, { error: "Could not decrypt channel credentials." });
      }
    }

    const prevConfig = channel.config ? JSON.parse(channel.config) : {};

    if (channel.connector === "etsy") {
      const { discoverAllEtsyResources } = await import("$server/connectors/etsy");
      const ctx = {
        config: prevConfig,
        credentials: {
          keystring: creds.keystring || creds.api_key || "",
          api_key: creds.keystring || creds.api_key || "",
          shared_secret: creds.shared_secret || "",
          refresh_token: creds.refresh_token || "",
          access_token: creds.access_token || "",
        },
        seller: { storeName: store.name, currency: store.currency },
        log: (msg: string) => console.log(`[Channel Refresh] ${msg}`),
      };

      try {
        const discovery = await discoverAllEtsyResources(ctx as any);
        const newShopId = discovery.shopId ? String(discovery.shopId) : prevConfig.shop_id;
        const newShopName = discovery.shopName || prevConfig.shop_name || "";

        const updatedConfig = {
          ...prevConfig,
          shop_id: newShopId,
          shop_name: newShopName,
          discovered_shops: discovery.shops,
          default_shipping_profile_id: prevConfig.default_shipping_profile_id || discovery.shippingProfiles?.[0]?.id,
          default_return_policy_id: prevConfig.default_return_policy_id || discovery.returnPolicies?.[0]?.id,
        };

        repo.updateChannel(channel.id, { config: updatedConfig });
        repo.setChannelHealth(channel.id, "HEALTHY", "");

        return {
          refreshed: true,
          shopId: newShopId,
          shopName: newShopName,
          shopsCount: discovery.shops?.length || 0,
        };
      } catch (err: any) {
        repo.setChannelHealth(channel.id, "API_FAILURE", err.message);
        return fail(400, { error: `Etsy API discovery error: ${err.message}` });
      }
    }

    return { refreshed: true };
  },

  remove: async ({ request, locals }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!authz.canAccessChannel(locals.principal!, id)) return fail(403, { error: "forbidden" });
    repo.deleteChannel(id);
    return { removed: true };
  },

  generateEtsyAuthUrl: async ({ request }) => {
    const form = await request.formData();
    const keystring = String(form.get("keystring") ?? "").trim();
    const redirectUri = String(form.get("redirect_uri") ?? "https://localhost").trim() || "https://localhost";
    const scopes = String(form.get("scopes") ?? "listings_r listings_w listings_d shops_r shops_w profile_r transactions_r").trim();

    if (!keystring) {
      return fail(400, { error: "Keystring (API Key) is required to generate Etsy authorization URL." });
    }

    const { pkcePair, newState } = await import("$server/oauth");
    const pair = pkcePair();
    const state = newState();

    const q = new URLSearchParams({
      response_type: "code",
      client_id: keystring,
      redirect_uri: redirectUri,
      scope: scopes,
      state,
      code_challenge: pair.challenge,
      code_challenge_method: "S256",
    });

    const url = `https://www.etsy.com/oauth/connect?${q.toString()}`;
    return {
      success: true,
      authUrl: url,
      verifier: pair.verifier,
      state,
      redirectUri,
    };
  },

  exchangeEtsyCode: async ({ request }) => {
    const form = await request.formData();
    const keystring = String(form.get("keystring") ?? "").trim();
    const sharedSecret = String(form.get("shared_secret") ?? "").trim();
    let codeInput = String(form.get("code") ?? "").trim();
    const verifier = String(form.get("verifier") ?? "").trim();
    const redirectUri = String(form.get("redirect_uri") ?? "https://localhost").trim() || "https://localhost";

    if (!keystring) return fail(400, { error: "Keystring is required." });
    if (!codeInput) return fail(400, { error: "Authorization code or redirected URL is required." });
    if (!verifier) return fail(400, { error: "PKCE code verifier is missing. Please regenerate the authorization link." });

    // If user pasted full callback URL (e.g. https://localhost/?code=xxx&state=yyy), extract code
    let code = codeInput;
    if (codeInput.includes("code=")) {
      try {
        const u = new URL(codeInput.startsWith("http") ? codeInput : `https://${codeInput}`);
        code = u.searchParams.get("code") || codeInput;
      } catch {}
    }

    const apiKeyHeader = sharedSecret ? `${keystring}:${sharedSecret}` : keystring;

    try {
      const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-api-key": apiKeyHeader,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: keystring,
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier,
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.access_token) {
        return fail(400, {
          error: body.error_description || body.error || `Etsy token exchange failed (HTTP ${res.status}).`,
        });
      }

      return {
        success: true,
        accessToken: String(body.access_token),
        refreshToken: String(body.refresh_token || ""),
        expiresIn: Number(body.expires_in || 3600),
      };
    } catch (err: any) {
      return fail(400, { error: `Network error during token exchange: ${err.message || String(err)}` });
    }
  },

  refreshEtsyToken: async ({ request }) => {
    const form = await request.formData();
    const keystring = String(form.get("keystring") ?? "").trim();
    const sharedSecret = String(form.get("shared_secret") ?? "").trim();
    const refreshToken = String(form.get("refresh_token") ?? "").trim();

    if (!keystring) return fail(400, { error: "Keystring is required." });
    if (!refreshToken) return fail(400, { error: "Refresh token is required to refresh." });

    const apiKeyHeader = sharedSecret ? `${keystring}:${sharedSecret}` : keystring;

    try {
      const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "x-api-key": apiKeyHeader,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: keystring,
          refresh_token: refreshToken,
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.access_token) {
        return fail(400, {
          error: body.error_description || body.error || `Etsy token refresh failed (HTTP ${res.status}).`,
        });
      }

      return {
        success: true,
        accessToken: String(body.access_token),
        refreshToken: String(body.refresh_token || refreshToken),
        expiresIn: Number(body.expires_in || 3600),
      };
    } catch (err: any) {
      return fail(400, { error: `Network error during token refresh: ${err.message || String(err)}` });
    }
  },
};

