import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { authz, blob, repo } from "$server/app";
import { config } from "$server/config";
import { localSecrets } from "$server/drivers";
import { newId } from "$server/ids";
import { litekart, type LitekartConfig } from "$server/adapters/litekart";

const secrets = localSecrets(config.secretKey);

/**
 * Bank details live in the same sealed `credentials` table as marketplace API
 * keys, under provider "bank_account".
 *
 * Payout details are financial data: same AES-256-GCM sealing, never returned
 * by the REST API (no handler there reads this table), and masked even in the
 * form the owner sees.
 */
interface BankDetails {
  account_name?: string;
  bank_name?: string;
  branch?: string;
  account_number?: string;
  ifsc?: string;
  upi?: string;
}

async function loadBank(storeId: string): Promise<BankDetails> {
  const row = repo.db.get<{ ciphertext: Uint8Array }>(
    "SELECT ciphertext FROM credentials WHERE store_id = ? AND provider = 'bank_account' ORDER BY created_at DESC LIMIT 1",
    [storeId],
  );
  if (!row?.ciphertext) return {};
  try {
    return await secrets.open<BankDetails>(new Uint8Array(row.ciphertext));
  } catch {
    // A rotated key makes old ciphertext unreadable; an empty form beats a 500.
    return {};
  }
}

async function saveBank(orgId: string, storeId: string, next: BankDetails): Promise<void> {
  const sealed = await secrets.seal(next);
  const existing = repo.db.get<{ id: string }>(
    "SELECT id FROM credentials WHERE store_id = ? AND provider = 'bank_account' LIMIT 1",
    [storeId],
  );
  if (existing) {
    repo.db.run("UPDATE credentials SET ciphertext = ?, updated_at = ? WHERE id = ?", [
      sealed,
      Date.now(),
      existing.id,
    ]);
    return;
  }
  repo.db.run(
    `INSERT INTO credentials
       (id, organization_id, store_id, channel_id, provider, auth_type, ciphertext, created_at, updated_at)
     VALUES (?,?,?,'','bank_account','bank',?,?,?)`,
    [newId("cred"), orgId, storeId, sealed, Date.now(), Date.now()],
  );
}

/** Last four only, the way a bank statement does it. */
function maskAccount(value: string): string {
  const digits = value.replace(/\s+/g, "");
  if (digits.length <= 4) return "••••";
  return `•••• •••• ${digits.slice(-4)}`;
}

export const load: PageServerLoad = async ({ locals }) => {
  const principal = locals.principal!;
  let store = repo.storesForOrg(principal.organizationId)[0];
  if (!store) {
    if (!authz.canCreateStore(principal)) redirect(303, "/dash");
    store = repo.createStore(principal.organizationId, "My store");
  }

  const bank = await loadBank(store.id);

  const litekartRow = repo.db.get<{ ciphertext: Uint8Array }>(
    "SELECT ciphertext FROM credentials WHERE store_id = ? AND provider = 'litekart' ORDER BY created_at DESC LIMIT 1",
    [store.id],
  );
  let litekartCfg: LitekartConfig | null = null;
  if (litekartRow?.ciphertext) {
    try {
      litekartCfg = await secrets.open<LitekartConfig>(new Uint8Array(litekartRow.ciphertext));
    } catch {
      litekartCfg = null;
    }
  }

  return {
    store,
    litekart: {
      connected: Boolean(litekartCfg?.baseUrl),
      baseUrl: litekartCfg?.baseUrl ?? "",
      // Only whether a token is stored ever reaches the browser, never the token.
      hasToken: Boolean(litekartCfg?.apiToken),
      importedCount:
        repo.db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM products WHERE store_id = ? AND source = 'litekart'",
          [store.id],
        )?.n ?? 0,
    },
    bank: {
      account_name: bank.account_name ?? "",
      bank_name: bank.bank_name ?? "",
      branch: bank.branch ?? "",
      ifsc: bank.ifsc ?? "",
      upi: bank.upi ?? "",
      // The number itself never reaches the browser — only its mask.
      accountMask: bank.account_number ? maskAccount(bank.account_number) : "",
    },
    locations: repo.pickupLocations(store.id),
  };
};

const storeOf = (orgId: string) => repo.storesForOrg(orgId)[0];

export const actions: Actions = {
  storefront: async ({ request, locals }) => {
    const store = storeOf(locals.principal!.organizationId);
    if (!store) return fail(400, { error: "no store" });

    const form = await request.formData();
    const fields: Record<string, string> = {};
    for (const k of ["name", "description", "support_email", "support_phone", "website"]) {
      fields[k] = String(form.get(k) ?? "").trim();
    }

    const logo = form.get("logo_file");
    if (logo instanceof File && logo.size > 0) {
      const ext = (logo.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
      fields.logo_url = await blob.put(`${newId("logo")}.${ext}`, await logo.arrayBuffer(), logo.type);
    }

    repo.updateStore(store.id, fields);
    return { saved: "storefront" };
  },

  company: async ({ request, locals }) => {
    const store = storeOf(locals.principal!.organizationId);
    if (!store) return fail(400, { error: "no store" });

    const form = await request.formData();
    const str = (k: string) => String(form.get(k) ?? "").trim();

    const fields: Record<string, string> = {};
    for (const k of [
      "legal_name", "business_type", "tax_id", "registration_no", "currency",
      "address_line1", "address_line2", "city", "state", "postal_code", "country",
    ]) {
      fields[k] = str(k);
    }
    repo.updateStore(store.id, fields);

    // An empty account-number field means "keep what is stored", not "erase":
    // the form only ever shows a mask, so a blank submit is the normal case.
    const current = await loadBank(store.id);
    const typed = str("bank_account_number");
    await saveBank(locals.principal!.organizationId, store.id, {
      account_name: str("bank_account_name"),
      bank_name: str("bank_name"),
      branch: str("bank_branch"),
      account_number: typed || current.account_number,
      ifsc: str("bank_ifsc"),
      upi: str("bank_upi"),
    });

    repo.audit({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      actorUserId: locals.principal!.user.id,
      action: "CompanyDetailsUpdated",
      entityType: "store",
      entityId: store.id,
    });
    return { saved: "company" };
  },

  location: async ({ request, locals }) => {
    const store = storeOf(locals.principal!.organizationId);
    if (!store) return fail(400, { error: "no store" });

    const form = await request.formData();
    const str = (k: string) => String(form.get(k) ?? "").trim();
    const id = str("id");

    repo.savePickupLocation({
      id: id || undefined,
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      label: str("label") || "Pickup location",
      contactName: str("contact_name"),
      contactPhone: str("contact_phone"),
      line1: str("address_line1"),
      line2: str("address_line2"),
      city: str("city"),
      state: str("state"),
      postalCode: str("postal_code"),
      country: str("country") || "IN",
      isDefault: form.get("is_default") === "1",
    });
    return { saved: "location" };
  },

  /** Save the Litekart base URL + API token, sealed like any other credential. */
  connectLitekart: async ({ request, locals }) => {
    const store = storeOf(locals.principal!.organizationId);
    if (!store) return fail(400, { error: "no store" });

    const form = await request.formData();
    const baseUrl = String(form.get("base_url") ?? "").trim().replace(/\/+$/, "");
    const apiToken = String(form.get("api_token") ?? "").trim();

    if (!baseUrl) return fail(400, { error: "Store URL is required." });
    if (!/^https?:\/\//.test(baseUrl)) {
      return fail(400, { error: "Store URL must start with http:// or https://" });
    }

    // Keep the stored token when the field is left blank on a re-save.
    let token = apiToken;
    if (!token) {
      const row = repo.db.get<{ ciphertext: Uint8Array }>(
        "SELECT ciphertext FROM credentials WHERE store_id = ? AND provider = 'litekart' LIMIT 1",
        [store.id],
      );
      if (row?.ciphertext) {
        try {
          token = (await secrets.open<LitekartConfig>(new Uint8Array(row.ciphertext))).apiToken;
        } catch {
          /* fall through to the empty check below */
        }
      }
    }
    if (!token) return fail(400, { error: "API key is required." });

    // Verify before storing: a wrong URL or key should fail here, not silently
    // at the first import.
    const health = await litekart.health({ baseUrl, apiToken: token });
    if (health.status !== "HEALTHY") {
      return fail(400, { error: `Could not reach Litekart: ${health.detail ?? health.status}` });
    }

    const sealed = await secrets.seal({ baseUrl, apiToken: token } satisfies LitekartConfig);
    const existing = repo.db.get<{ id: string }>(
      "SELECT id FROM credentials WHERE store_id = ? AND provider = 'litekart' LIMIT 1",
      [store.id],
    );
    if (existing) {
      repo.db.run("UPDATE credentials SET ciphertext = ?, updated_at = ? WHERE id = ?", [
        sealed,
        Date.now(),
        existing.id,
      ]);
    } else {
      repo.db.run(
        `INSERT INTO credentials
           (id, organization_id, store_id, channel_id, provider, auth_type, ciphertext, created_at, updated_at)
         VALUES (?,?,?,'','litekart','api_key',?,?,?)`,
        [newId("cred"), locals.principal!.organizationId, store.id, sealed, Date.now(), Date.now()],
      );
    }

    repo.updateStore(store.id, { platform: "litekart" });
    repo.audit({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      actorUserId: locals.principal!.user.id,
      action: "LitekartConnected",
      entityType: "store",
      entityId: store.id,
    });
    return { saved: "litekart", connected: true };
  },

  /** Pull the Litekart catalogue in, normalised through the adapter. */
  importLitekart: async ({ locals }) => {
    const store = storeOf(locals.principal!.organizationId);
    if (!store) return fail(400, { error: "no store" });

    const row = repo.db.get<{ ciphertext: Uint8Array }>(
      "SELECT ciphertext FROM credentials WHERE store_id = ? AND provider = 'litekart' LIMIT 1",
      [store.id],
    );
    if (!row?.ciphertext) return fail(400, { error: "Connect Litekart first." });

    let cfg: LitekartConfig;
    try {
      cfg = await secrets.open<LitekartConfig>(new Uint8Array(row.ciphertext));
    } catch {
      return fail(400, { error: "Stored Litekart credentials could not be read." });
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    try {
      // Paged, so a large catalogue never arrives in one response and a failure
      // part-way still leaves the earlier pages imported.
      for (let page = 1; page <= 50; page++) {
        const batch = await litekart.listProducts(cfg, page, 50);
        if (batch.length === 0) break;

        for (const item of batch) {
          const result = await repo.saveProduct({
            orgId: locals.principal!.organizationId,
            storeId: store.id,
            externalId: item.externalId,
            source: "litekart",
            sku: item.sku,
            title: item.title,
            description: item.description,
            brand: item.brand,
            category: item.category,
            status: "DRAFT",
            attributes: item.attributes as Record<string, unknown>,
            taxRateBp: item.taxRateBp,
            hsnCode: item.hsnCode,
            weightG: item.weightG,
            variants: item.variants,
            images: item.images,
          });
          if (result.created) created++;
          else if (result.changed) updated++;
          else unchanged++;
        }
        if (batch.length < 50) break;
      }
    } catch (e) {
      return fail(400, { error: `Import failed: ${(e as Error).message}` });
    }

    repo.audit({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      actorUserId: locals.principal!.user.id,
      action: "LitekartImported",
      entityType: "store",
      entityId: store.id,
      metadata: { created, updated, unchanged },
    });
    return { saved: "litekart", imported: { created, updated, unchanged } };
  },

  disconnectLitekart: async ({ locals }) => {
    const store = storeOf(locals.principal!.organizationId);
    if (!store) return fail(400, { error: "no store" });
    // Imported products stay; only the connection goes.
    repo.db.run("DELETE FROM credentials WHERE store_id = ? AND provider = 'litekart'", [store.id]);
    repo.updateStore(store.id, { platform: "native" });
    return { saved: "litekart", connected: false };
  },

  deleteLocation: async ({ request, locals }) => {
    const store = storeOf(locals.principal!.organizationId);
    const form = await request.formData();
    const id = String(form.get("id") ?? "");
    const loc = repo.getPickupLocation(id);
    if (store && loc && loc.store_id === store.id) repo.deletePickupLocation(loc.id);
    return { saved: "location" };
  },
};
