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
  // Which marketplaces this installation can hand off to, rather than asking
  // the seller to paste a token they would have to mint themselves.
  const oauthReady = new Set(enabledOAuthConnectors());

  const connected = repo.listChannels(store.id);
  const connectedNames = new Set(connected.map((c) => c.connector));

  return {
    storeName: store.name,
    connected: connected.map((c) => {
      const mapped = repo.mappingsForChannel(c.id);
      return {
        id: c.id,
        name: c.name,
        connector: c.connector,
        status: c.status,
        mode: c.mode,
        lastError: c.last_error,
        lastCheckedAt: c.last_health_at,
        live: mapped.filter((m) => m.remote_product_id).length,
        total: mapped.length,
        mark: brandMark(c.connector, 28),
      };
    }),
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
        /*
         * Ready first, matching the landing page. This is the screen where a
         * seller actually picks something to connect, so the ones that have
         * been run against the live API belong at the top of each row rather
         * than wherever the registry happens to declare them.
         *
         * Stable sort, so the rest keep registry order.
         */
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

    const mode = String(form.get("mode") ?? "mock") === "live" ? "live" : "mock";

    const creds: Record<string, string> = {};
    for (const [k, v] of form.entries()) {
      if (k.startsWith("cred_") && String(v).trim()) creds[k.slice(5)] = String(v).trim();
    }
    // Live with no credentials would just dead-letter the first job; say so now.
    if (mode === "live" && Object.keys(creds).length === 0) {
      return fail(400, { error: "Add credentials, or choose mock mode to explore first." });
    }

    const channel = repo.createChannel({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      connector: connectorName,
      name: String(form.get("name") || `${manifest.displayName} — ${store.name}`),
      mode,
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
      } catch { /* fall through to a failing health check */ }
    }

    const result = await connector.health({
      mode: channel.mode === "live" ? "live" : "mock",
      config: JSON.parse(channel.config || "{}"),
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
    });

    repo.setChannelHealth(channel.id, result.status, result.detail ?? "");
    return { tested: channel.name, status: result.status, detail: result.detail ?? "" };
  },

  remove: async ({ request, locals }) => {
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    if (!authz.canAccessChannel(locals.principal!, id)) return fail(403, { error: "forbidden" });
    repo.deleteChannel(id);
    return { removed: true };
  },
};
