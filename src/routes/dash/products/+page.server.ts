import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { repo } from "$server/app";
import { config } from "$server/config";
import { localSecrets } from "$server/drivers";
import { brandMark } from "$server/connectors/brand";
import { parseCSV, groupSheetRows } from "$server/import_sheet";
import { deleteProductFromChannel } from "$server/connectors/service";

const secrets = localSecrets(config.secretKey);

export const load: PageServerLoad = async ({ locals, url }) => {
  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) redirect(303, "/onboarding/store");

  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  let rows = repo.listProducts(store.id, 500);
  if (q) {
    rows = rows.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q),
    );
  }

  // Connected channels in this store
  const channels = repo.listChannels(store.id);
  const etsyChannel = channels.find((c) => c.connector === "etsy");
  let etsyCredentialsStored = false;
  let etsyConfig: Record<string, any> = {};

  if (etsyChannel) {
    try {
      etsyConfig = JSON.parse(etsyChannel.config || "{}");
    } catch {}
    const credRow = repo.db.get<{ id: string }>(
      "SELECT id FROM credentials WHERE channel_id = ? LIMIT 1",
      [etsyChannel.id],
    );
    etsyCredentialsStored = Boolean(credRow);
  }

  return {
    q,
    storeName: store.name,
    storeCurrency: store.currency || "USD",
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      connector: c.connector,
      status: c.status,
      mark: brandMark(c.connector, 24),
    })),
    etsyChannel: etsyChannel
      ? {
          id: etsyChannel.id,
          name: etsyChannel.name,
          hasCredentials: etsyCredentialsStored,
          config: etsyConfig,
        }
      : null,
    products: rows.map((p) => {
      const variants = repo.variants(p.id);
      const images = repo.images(p.id);
      return {
        id: p.id,
        title: p.title,
        sku: p.sku,
        brand: p.brand,
        status: p.status,
        updatedAt: p.updated_at,
        image: images[0]?.url ?? "",
        variants: variants.length,
        stock: variants.reduce((n, v) => n + v.available, 0),
        priceCents: variants[0]?.price_cents ?? 0,
        currency: variants[0]?.currency ?? store.currency,
        mappings: repo.mappingsForProduct(p.id).map((m) => ({
          channelId: m.channel_id,
          connector: m.connector,
          status: m.status,
          mark: brandMark(m.connector, 20),
        })),
      };
    }),
  };
};

export const actions: Actions = {
  /**
   * Delete selected products from specified channels.
   * If a product has no remaining channel mappings after deletion, also removes it from the local DB.
   */
  deleteProducts: async ({ request, locals }) => {
    const store = repo.storesForOrg(locals.principal!.organizationId)[0];
    if (!store) return fail(400, { error: "No store found." });

    const form = await request.formData();
    // Comma-separated product IDs
    const productIds = String(form.get("product_ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Comma-separated channel IDs to delete from (empty = delete from all + local DB)
    const channelIds = String(form.get("channel_ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const deleteFromAll = form.get("delete_from_all") === "true";

    if (!productIds.length) return fail(400, { error: "No products selected." });

    let deletedFromDB = 0;
    let deletedMappings = 0;

    // Cache connector contexts (e.g. for Etsy) to avoid decrypting credentials repeatedly
    const channelCtxMap = new Map<string, any>();
    async function getChannelCtx(channelId: string) {
      if (channelCtxMap.has(channelId)) return channelCtxMap.get(channelId);
      const ch = repo.getChannel(channelId);
      if (!ch) return null;

      const credRow = repo.db.get<{ ciphertext: Uint8Array }>(
        "SELECT ciphertext FROM credentials WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
        [channelId],
      );
      if (!credRow?.ciphertext) return null;

      try {
        const creds = await secrets.open<Record<string, string>>(new Uint8Array(credRow.ciphertext));
        let configObj: any = {};
        try { configObj = JSON.parse(ch.config || "{}"); } catch {}

        const ctx = {
          config: configObj,
          credentials: {
            keystring: creds.keystring || creds.api_key || "",
            api_key: creds.keystring || creds.api_key || "",
            shared_secret: creds.shared_secret || "",
            refresh_token: creds.refresh_token || "",
            access_token: creds.access_token || "",
          },
          seller: { storeName: store.name, currency: store.currency },
          log: (msg: string) => console.log(`[Delete Listing] ${msg}`),
        };
        channelCtxMap.set(channelId, { channel: ch, ctx });
        return { channel: ch, ctx };
      } catch {
        return null;
      }
    }

    const deleteErrors: string[] = [];

    for (const productId of productIds) {
      const product = repo.getProduct(productId);
      if (!product || product.store_id !== store.id) continue;

      const existingMappings = repo.mappingsForProduct(productId);

      if (deleteFromAll || channelIds.length === 0) {
        // 1. Delete on remote marketplace channels for all mappings
        let allRemoteDeletionsSucceeded = true;

        for (const m of existingMappings) {
          if (m.remote_product_id) {
            const delRes = await deleteProductFromChannel(repo, m.channel_id, productId);
            if (delRes.success) {
              console.log(`[Product Delete] Successfully deleted remote listing ${m.remote_product_id} on channel #${m.channel_id} for SKU ${product.sku}`);
              deletedMappings++;
            } else {
              allRemoteDeletionsSucceeded = false;
              const msg = `Failed to delete marketplace listing ${m.remote_product_id} for SKU ${product.sku}: ${delRes.error}`;
              console.error(`[Product Delete Error] ${msg}`);
              deleteErrors.push(msg);
            }
          }
        }

        // 2. Only delete from local DB if remote marketplace deletions passed (or if there were no remote mappings)
        if (allRemoteDeletionsSucceeded) {
          repo.deleteProduct(productId);
          deletedFromDB++;
        }
      } else {
        // Remove only the specified channel mappings
        for (const channelId of channelIds) {
          const mapping = repo.getMapping(productId, channelId);
          if (mapping) {
            const delRes = await deleteProductFromChannel(repo, channelId, productId);
            if (delRes.success) {
              console.log(`[Product Delete] Successfully unlinked/deleted remote listing on channel #${channelId} for SKU ${product.sku}`);
              deletedMappings++;
            } else {
              const msg = `Failed to delete listing on channel #${channelId} for SKU ${product.sku}: ${delRes.error}`;
              console.error(`[Product Delete Error] ${msg}`);
              deleteErrors.push(msg);
            }
          }
        }

        // If no mappings remain on any channel, delete from local DB too
        const remainingMappings = repo.mappingsForProduct(productId);
        if (remainingMappings.length === 0) {
          repo.deleteProduct(productId);
          deletedFromDB++;
        }
      }
    }

    if (deleteErrors.length > 0 && deletedFromDB === 0 && deletedMappings === 0) {
      return fail(400, {
        error: deleteErrors.slice(0, 3).join("; "),
      });
    }

    // Record deletion event in activity timeline (consolidated as a single batch entry)
    if (deletedFromDB > 0 || deletedMappings > 0) {
      const channelNames = channelIds
        .map((cid) => repo.getChannel(cid)?.name)
        .filter(Boolean);
      const destSummary = deleteFromAll || channelIds.length === 0
        ? "all channels & local catalogue"
        : (channelNames.length > 0 ? channelNames.join(", ") : "selected channels");

      repo.audit({
        orgId: locals.principal!.organizationId,
        storeId: store.id,
        actorUserId: locals.principal!.id,
        action: "ProductsDeleted",
        entityType: "product",
        entityId: productIds[0] || "batch",
        metadata: {
          count: productIds.length,
          deletedFromDB,
          deletedMappings,
          detail: `${productIds.length} product${productIds.length === 1 ? "" : "s"} deleted from ${destSummary}`,
          status: deleteErrors.length === 0 ? "SUCCEEDED" : "PARTIAL",
          meta: `${deletedFromDB} removed from DB, ${deletedMappings} unlisted`,
        },
      });
    }

    return {
      success: true,
      deletedFromDB,
      deletedMappings,
      errors: deleteErrors,
    };
  },

  uploadSheet: async ({ request, locals }) => {
    const store = repo.storesForOrg(locals.principal!.organizationId)[0];
    if (!store) return fail(400, { error: "No store found." });

    const form = await request.formData();
    const sheetFile = form.get("sheet_file");
    let csvText = "";
    let filename = String(form.get("filename") ?? "").trim() || "catalogue.csv";

    if (sheetFile instanceof File && sheetFile.size > 0) {
      csvText = await sheetFile.text();
      filename = sheetFile.name || filename;
    } else {
      csvText = String(form.get("csv_text") ?? "").trim();
    }

    if (!csvText) {
      return fail(400, { error: "Please select or drop a valid CSV file." });
    }

    const lines = csvText.split("\n").filter((l) => l.trim().length > 0);
    const rowCount = Math.max(0, lines.length - 1);

    const sheet = repo.createImportSheet({
      orgId: locals.principal!.organizationId,
      storeId: store.id,
      filename,
      csvText,
      rowCount,
    });

    redirect(303, `/dash/products/import?id=${sheet.id}&step=1`);
  },

  fetchEtsySettings: async ({ request, locals }) => {
    const store = repo.storesForOrg(locals.principal!.organizationId)[0];
    if (!store) return fail(400, { error: "No store found." });

    const form = await request.formData();
    let keystring = String(form.get("keystring") ?? "").trim();
    let sharedSecret = String(form.get("shared_secret") ?? "").trim();
    let refreshToken = String(form.get("refresh_token") ?? "").trim();
    let shopId = String(form.get("shop_id") ?? "").trim();

    // Check if channel has credentials stored
    if (!keystring || !refreshToken) {
      const existingEtsy = repo.listChannels(store.id).find((c) => c.connector === "etsy");
      if (existingEtsy) {
        const credRow = repo.db.get<{ ciphertext: Uint8Array }>(
          "SELECT ciphertext FROM credentials WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
          [existingEtsy.id],
        );
        if (credRow?.ciphertext) {
          try {
            const creds = await secrets.open<Record<string, string>>(new Uint8Array(credRow.ciphertext));
            keystring = keystring || creds.keystring || creds.api_key || "";
            sharedSecret = sharedSecret || creds.shared_secret || "";
            refreshToken = refreshToken || creds.refresh_token || "";
          } catch {}
        }
        if (!shopId && existingEtsy.config) {
          try {
            shopId = String(JSON.parse(existingEtsy.config).shop_id || "");
          } catch {}
        }
      }
    }

    if (!keystring || !refreshToken) {
      return fail(400, { error: "Keystring and Refresh Token are required." });
    }

    const ctx: any = {
      config: { shop_id: shopId },
      credentials: {
        keystring,
        api_key: keystring,
        shared_secret: sharedSecret,
        refresh_token: refreshToken,
      },
      seller: {
        storeName: store.name,
        currency: store.currency,
      },
      log: (msg: string) => console.log(`[Etsy Settings Fetch] ${msg}`),
    };

    try {
      let shops: Array<{ shop_id: number; shop_name: string; title?: string }> = [];
      if (shopId) {
        const details = await getShopDetails(ctx, shopId);
        if (details) {
          shops = [{
            shop_id: Number(details.shop_id),
            shop_name: details.shop_name || String(details.shop_id),
            title: details.title || "",
          }];
        }
      } else {
        shops = await getMeShops(ctx);
      }

      const currentShopId = shopId || (shops[0] ? String(shops[0].shop_id) : "");
      let shippingProfiles: any[] = [];
      let returnPolicies: any[] = [];

      if (currentShopId) {
        ctx.config.shop_id = currentShopId;
        shippingProfiles = await getShippingProfiles(ctx, currentShopId);
        returnPolicies = await getReturnPolicies(ctx, currentShopId);
      }

      return {
        success: true,
        shopId: currentShopId,
        shops,
        shippingProfiles: shippingProfiles.map((p) => ({
          id: p.shipping_profile_id,
          title: p.title,
          originCountry: p.origin_country_iso || "IN",
        })),
        returnPolicies: returnPolicies.map((p) => ({
          id: p.return_policy_id,
          description: p.description || `Policy #${p.return_policy_id}`,
          acceptsReturns: Boolean(p.accepts_returns),
        })),
      };
    } catch (err: any) {
      return fail(400, { error: `Etsy API request failed: ${err.message || String(err)}` });
    }
  },

  importSheet: async ({ request, locals }) => {
    const store = repo.storesForOrg(locals.principal!.organizationId)[0];
    if (!store) return fail(400, { error: "No store found." });

    const form = await request.formData();
    const sheetFile = form.get("sheet_file");
    let csvText = "";

    if (sheetFile instanceof File && sheetFile.size > 0) {
      csvText = await sheetFile.text();
    } else {
      csvText = String(form.get("csv_text") ?? "").trim();
    }

    if (!csvText) {
      return fail(400, { error: "Please select a CSV file or paste CSV content." });
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

    const publishToEtsy = form.get("publish_to_etsy") === "true";

    // Setup Etsy Context if publishing is enabled
    let etsyCtx: any = null;
    let etsyChannelId = "";

    if (publishToEtsy) {
      let keystring = String(form.get("etsy_keystring") ?? "").trim();
      let sharedSecret = String(form.get("etsy_shared_secret") ?? "").trim();
      let refreshToken = String(form.get("etsy_refresh_token") ?? "").trim();
      let shopId = String(form.get("etsy_shop_id") ?? "").trim();

      const existingEtsy = repo.listChannels(store.id).find((c) => c.connector === "etsy");
      if (existingEtsy) {
        etsyChannelId = existingEtsy.id;
        if (!keystring || !refreshToken) {
          const credRow = repo.db.get<{ ciphertext: Uint8Array }>(
            "SELECT ciphertext FROM credentials WHERE channel_id = ? ORDER BY created_at DESC LIMIT 1",
            [existingEtsy.id],
          );
          if (credRow?.ciphertext) {
            try {
              const creds = await secrets.open<Record<string, string>>(new Uint8Array(credRow.ciphertext));
              keystring = keystring || creds.keystring || creds.api_key || "";
              sharedSecret = sharedSecret || creds.shared_secret || "";
              refreshToken = refreshToken || creds.refresh_token || "";
            } catch {}
          }
        }
        if (!shopId && existingEtsy.config) {
          try {
            shopId = String(JSON.parse(existingEtsy.config).shop_id || "");
          } catch {}
        }
      }

      if (!keystring || !refreshToken) {
        return fail(400, { error: "Etsy Keystring and Refresh Token are required for publishing." });
      }
      if (!shopId) {
        return fail(400, { error: "Etsy Shop ID is required for publishing." });
      }

      const shippingProfileId = Number(form.get("etsy_shipping_profile_id")) || undefined;
      const returnPolicyId = Number(form.get("etsy_return_policy_id")) || undefined;
      const readinessStateId = Number(form.get("etsy_readiness_state_id")) || undefined;
      const whoMade = String(form.get("etsy_who_made") || "i_did");
      const whenMade = String(form.get("etsy_when_made") || "made_to_order");
      const publishImmediately = form.get("etsy_publish_immediately") === "true";

      etsyCtx = {
        config: {
          shop_id: shopId,
          default_shipping_profile_id: shippingProfileId,
          default_return_policy_id: returnPolicyId,
          default_readiness_state_id: readinessStateId,
          default_who_made: whoMade,
          default_when_made: whenMade,
          publish_immediately: publishImmediately,
        },
        credentials: {
          keystring,
          api_key: keystring,
          shared_secret: sharedSecret,
          refresh_token: refreshToken,
        },
        seller: {
          storeName: store.name,
          description: store.description,
          logoUrl: store.logo_url,
          legalName: store.legal_name,
          currency: store.currency,
        },
        log: (msg: string) => console.log(`[Etsy Import Engine] ${msg}`),
      };
    }

    // Process each group
    for (const group of groups) {
      try {
        const mergedAttributes: Record<string, any> = {
          ...(group.canonical.attributes || {}),
          ...(publishToEtsy
            ? {
                who_made: whoMade,
                when_made: whenMade,
                etsy_shipping_profile_id: shippingProfileId ? String(shippingProfileId) : undefined,
                etsy_return_policy_id: returnPolicyId ? String(returnPolicyId) : undefined,
                etsy_readiness_state_id: readinessStateId ? String(readinessStateId) : undefined,
              }
            : {}),
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
        });

        importedCount++;

        // Publish to Etsy if requested
        if (publishToEtsy && etsyCtx) {
          try {
            const canonicalProd = {
              sku: group.canonical.sku,
              title: group.canonical.title,
              description: group.canonical.description,
              brand: group.canonical.brand,
              category: group.canonical.category,
              weightG: group.canonical.weightG,
              images: group.canonical.images,
              variants: group.canonical.variants,
              attributes: group.canonical.attributes,
            };

            const remote = await etsy.createProduct(etsyCtx, canonicalProd);
            publishedCount++;
            publishedDetails.push({ sku: group.canonical.sku, listingId: remote.remoteId });

            if (etsyChannelId) {
              repo.upsertMapping({
                productId: saved.id,
                channelId: etsyChannelId,
                status: "ACTIVE",
                remoteProductId: remote.remoteId,
                synced: true,
              });
            }
          } catch (pubErr: any) {
            const msg = `Etsy listing failed for ${group.canonical.sku}: ${pubErr.message || String(pubErr)}`;
            errors.push(msg);
            publishedDetails.push({ sku: group.canonical.sku, error: msg });
          }
        }
      } catch (saveErr: any) {
        errors.push(`Catalogue save failed for ${group.canonical.sku}: ${saveErr.message}`);
      }
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
