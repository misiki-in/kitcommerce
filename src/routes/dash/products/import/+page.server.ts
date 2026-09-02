import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { repo } from "$server/app";
import { config } from "$server/config";
import { localSecrets } from "$server/drivers";
import { brandMark } from "$server/connectors/brand";
import { parseCSV, groupSheetRows } from "$server/import_sheet";
import { getConnector } from "$server/connectors";
import {
  buildChannelContext,
  syncProductToChannel,
  discoverChannelResources,
} from "$server/connectors/service";

const secrets = localSecrets(config.secretKey);

export const load: PageServerLoad = async ({ locals, url }) => {
  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) redirect(303, "/onboarding/store");

  const sheetId = url.searchParams.get("id") ?? "";
  let sheetRecord: { id: string; filename: string; rowCount: number; csvText: string } | null = null;

  if (sheetId) {
    const row = repo.getImportSheet(sheetId);
    if (row && row.store_id === store.id) {
      sheetRecord = {
        id: row.id,
        filename: row.filename,
        rowCount: row.row_count,
        csvText: row.csv_text,
      };
    }
  }

  const allChannels = repo.listChannels(store.id);

  // ONLY channels that have credentials stored in the DB
  const configuredChannels = allChannels
    .filter((c) => {
      const cred = repo.db.get<{ id: string }>(
        "SELECT id FROM credentials WHERE channel_id = ? LIMIT 1",
        [c.id],
      );
      return Boolean(cred);
    })
    .map((c) => {
      let parsedConfig: Record<string, any> = {};
      try {
        parsedConfig = JSON.parse(c.config || "{}");
      } catch {}
      return {
        id: c.id,
        name: c.name,
        connector: c.connector,
        config: parsedConfig,
        mark: brandMark(c.connector, 24),
      };
    });

  // Dynamically load initial live discovery options for all configured channels
  const channelLiveOptions: Record<string, any> = {};
  await Promise.all(
    configuredChannels.map(async (ch) => {
      try {
        const opts = await getChannelLiveOptions(ch.id, store);
        if (opts) channelLiveOptions[ch.id] = opts;
      } catch {}
    }),
  );

  return {
    storeName: store.name,
    storeCurrency: store.currency || "USD",
    sheet: sheetRecord,
    configuredChannels,
    channelLiveOptions,
  };
};

async function getChannelLiveOptions(channelId: string, store: any) {
  const chInfo = await buildChannelContext(repo, channelId, store);
  if (!chInfo) return null;

  try {
    const discovery = await discoverChannelResources(repo, channelId);
    if (!discovery.success || !discovery.data) return null;

    const data = discovery.data;
    // Persist discovered shopId back to channel config if not already stored
    if (data.shopId && !chInfo.ctx.config.shop_id) {
      try {
        const prevConfig = chInfo.channel.config ? (typeof chInfo.channel.config === "string" ? JSON.parse(chInfo.channel.config) : chInfo.channel.config) : {};
        repo.updateChannel(chInfo.channel.id, {
          config: { ...prevConfig, shop_id: String(data.shopId), shop_name: data.shopName },
        });
      } catch {}
    }

    return data;
  } catch (err: any) {
    console.error(`[Channel Options SSR Error] ${err.message}`);
    return null;
  }
}

export const actions: Actions = {
  fetchChannelSettings: async ({ request, locals }) => {
    const store = repo.storesForOrg(locals.principal!.organizationId)[0];
    if (!store) return fail(400, { error: "No store found." });

    const form = await request.formData();
    let channelId = String(form.get("channel_id") ?? "").trim();
    let shopId = String(form.get("shop_id") ?? "").trim();

    if (!channelId) {
      return fail(400, { error: "Channel ID is required for discovery." });
    }

    const discovery = await discoverChannelResources(repo, channelId, shopId ? { shop_id: shopId } : {});
    if (!discovery.success || !discovery.data) {
      return fail(400, { error: discovery.error || "Channel discovery failed." });
    }

    const data = discovery.data;
    return {
      success: true,
      shopId: data.shopId ? String(data.shopId) : "",
      shopName: data.shopName,
      shops: data.shops || [],
      shippingProfiles: data.shippingProfiles || [],
      returnPolicies: data.returnPolicies || [],
      taxonomies: data.taxonomies || [],
      discoveryErrors: data.errors ?? [],
    };
  },

  importSheet: async ({ request, locals }) => {
    const store = repo.storesForOrg(locals.principal!.organizationId)[0];
    if (!store) return fail(400, { error: "No store found." });

    const form = await request.formData();
    const sheetId = String(form.get("sheet_id") ?? "").trim();
    let csvText = String(form.get("csv_text") ?? "").trim();

    if (!csvText && sheetId) {
      const sheet = repo.getImportSheet(sheetId);
      if (sheet && sheet.store_id === store.id) {
        csvText = sheet.csv_text;
      }
    }

    if (!csvText) {
      return fail(400, { error: "No CSV content found for this import sheet." });
    }

    const parsedRows = parseCSV(csvText);
    if (!parsedRows.length) {
      return fail(400, { error: "No valid product rows found in CSV." });
    }

    const groups = groupSheetRows(parsedRows, store.currency);
    let importedCount = 0;
    let publishedCount = 0;
    const errors: string[] = [];
    const publishedDetails: Array<{ sku: string; listingId?: string; error?: string }> = [];

    // Dynamically resolve target channels from form inputs (supports target_channel_ids or channel_<id> checkboxes)
    const targetChannelIds: string[] = [];
    const targetChannelIdsParam = form.get("target_channel_ids");
    if (targetChannelIdsParam) {
      targetChannelIds.push(...String(targetChannelIdsParam).split(",").map((s) => s.trim()).filter(Boolean));
    }

    // Also collect any individual channel checkboxes (e.g. channel_chn_xxx=true or publish_to_channel_xxx=true)
    for (const [key, value] of form.entries()) {
      if ((key.startsWith("channel_") || key.startsWith("publish_to_")) && value === "true") {
        const idPart = key.replace(/^(channel_|publish_to_)/, "").trim();
        // Check if idPart is a channel ID
        const matched = repo.getChannel(idPart) || repo.listChannels(store.id).find((c) => c.connector === idPart);
        if (matched && !targetChannelIds.includes(matched.id)) {
          targetChannelIds.push(matched.id);
        }
      }
    }

    // Dynamically update channel config overrides if provided in form (e.g. config_chn_xxx={"shop_id": ...})
    for (const channelId of targetChannelIds) {
      const channel = repo.getChannel(channelId);
      if (!channel) continue;

      const dynamicConfigUpdates: Record<string, any> = {};
      const prefix = `cfg_${channelId}_`;
      const connectorPrefix = `cfg_${channel.connector}_`;
      const legacyPrefix = `${channel.connector}_`;

      for (const [k, v] of form.entries()) {
        const valStr = String(v).trim();
        if (!valStr) continue;

        if (k.startsWith(prefix)) {
          dynamicConfigUpdates[k.slice(prefix.length)] = valStr === "true" ? true : (valStr === "false" ? false : valStr);
        } else if (k.startsWith(connectorPrefix)) {
          dynamicConfigUpdates[k.slice(connectorPrefix.length)] = valStr === "true" ? true : (valStr === "false" ? false : valStr);
        } else if (k.startsWith(legacyPrefix)) {
          dynamicConfigUpdates[k.slice(legacyPrefix.length)] = valStr === "true" ? true : (valStr === "false" ? false : valStr);
        }
      }

      if (Object.keys(dynamicConfigUpdates).length > 0) {
        try {
          const prevConfig = channel.config ? (typeof channel.config === "string" ? JSON.parse(channel.config) : channel.config) : {};
          repo.updateChannel(channel.id, {
            config: { ...prevConfig, ...dynamicConfigUpdates },
          });
        } catch {}
      }
    }

    // Extract channel-specific attribute overrides configured during import
    const channelLevelAttributes: Record<string, any> = {};
    const whoMade = form.get("etsy_who_made");
    if (whoMade) channelLevelAttributes.who_made = String(whoMade).trim();
    const whenMade = form.get("etsy_when_made");
    if (whenMade) channelLevelAttributes.when_made = String(whenMade).trim();
    const shippingProfileId = form.get("etsy_shipping_profile_id");
    if (shippingProfileId) channelLevelAttributes.etsy_shipping_profile_id = String(shippingProfileId).trim();
    const returnPolicyId = form.get("etsy_return_policy_id");
    if (returnPolicyId) channelLevelAttributes.etsy_return_policy_id = String(returnPolicyId).trim();
    const readinessStateId = form.get("etsy_readiness_state_id");
    if (readinessStateId) channelLevelAttributes.etsy_readiness_state_id = String(readinessStateId).trim();
    const taxonomyId = form.get("etsy_taxonomy_id") || form.get("taxonomy_id");
    if (taxonomyId) {
      const taxNum = Number(taxonomyId);
      if (!isNaN(taxNum) && taxNum > 0) {
        channelLevelAttributes.etsy_taxonomy_id = taxNum;
      }
    }

    // Process and save products into DB
    for (const group of groups) {
      try {
        const mergedAttributes: Record<string, any> = {
          ...(group.canonical.attributes || {}),
          ...channelLevelAttributes,
        };

        const saved = await repo.saveProduct({
          orgId: locals.principal!.organizationId,
          storeId: store.id,
          source: "import_sheet",
          sku: group.canonical.sku,
          title: group.canonical.title,
          description: group.canonical.description,
          brand: group.canonical.brand,
          category: group.canonical.category,
          status: "ACTIVE",
          attributes: mergedAttributes,
          weightG: group.canonical.weightG,
          variants: group.canonical.variants,
          images: group.canonical.images,
          emitEvents: false, // Suppress separate background sync events for batch imports
        });

        importedCount++;

        // Dynamically sync to targeted channels via the plugin service
        for (const chId of targetChannelIds) {
          const canonicalProd: any = {
            id: saved.id,
            sku: group.canonical.sku,
            title: group.canonical.title,
            description: group.canonical.description,
            brand: group.canonical.brand,
            category: group.canonical.category,
            weightG: group.canonical.weightG,
            images: group.canonical.images,
            variants: group.canonical.variants,
            attributes: mergedAttributes,
          };

          const syncResult = await syncProductToChannel(repo, chId, canonicalProd, { store });
          if (syncResult.success) {
            publishedCount++;
            publishedDetails.push({ sku: group.canonical.sku, listingId: syncResult.remoteId });
          } else {
            const msg = `Channel sync failed for ${group.canonical.sku}: ${syncResult.error}`;
            errors.push(msg);
            publishedDetails.push({ sku: group.canonical.sku, error: msg });
          }
        }
      } catch (saveErr: any) {
        errors.push(`Catalogue save failed for ${group.canonical.sku}: ${saveErr.message}`);
      }
    }

    // Record sheet import summary in activity timeline
    const sheetRecord = sheetId ? repo.getImportSheet(sheetId) : null;
    const targetChannelObjs = targetChannelIds.map((id) => repo.getChannel(id)).filter(Boolean);
    const targetChannelNames = targetChannelObjs.map((c) => c?.name).filter(Boolean);
    const destName = targetChannelNames.length > 0 ? targetChannelNames.join(", ") : "Store Catalogue";

    // 1. Catalogue import activity log
    repo.audit({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      actorUserId: locals.principal!.id,
      action: "SheetImported",
      entityType: "import_sheet",
      entityId: sheetId || "batch",
      metadata: {
        filename: sheetRecord?.filename || "Import Sheet",
        importedCount,
        publishedCount,
        channel: destName,
        connector: targetChannelObjs[0]?.connector || "",
        status: errors.length === 0 ? "SUCCEEDED" : "PARTIAL",
        meta: `${importedCount} products imported${publishedCount > 0 ? `, ${publishedCount} synced to ${destName}` : ""}`,
      },
    });

    if (sheetId) {
      repo.updateImportSheet(sheetId, {
        status: errors.length === 0 ? "COMPLETED" : "COMPLETED_WITH_ERRORS",
        results: JSON.stringify({ importedCount, publishedCount, errors: errors.slice(0, 10) }),
      });
    }

    return {
      success: true,
      importedCount,
      publishedCount,
      totalGroups: groups.length,
      errors: errors.slice(0, 10),
      publishedDetails: publishedDetails.slice(0, 50),
    };
  },
};
