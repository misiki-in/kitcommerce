<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { goto } from "$app/navigation";
  import { deserialize, enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Label } from "$lib/components/ui/label";
  import UploadCloud from "@lucide/svelte/icons/upload-cloud";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Check from "@lucide/svelte/icons/check";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import Store from "@lucide/svelte/icons/store";
  import PackageCheck from "@lucide/svelte/icons/package-check";
  import FileText from "@lucide/svelte/icons/file-text";
  import Sliders from "@lucide/svelte/icons/sliders";
  import Database from "@lucide/svelte/icons/database";
  import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
  import Layers from "@lucide/svelte/icons/layers";
  import type { PageServerData } from "./$types";

  let { data }: { data: PageServerData } = $props();

  // Wizard Step State
  // Step 1: Save into Store Catalogue confirmation & overview
  // Step 2: Destination channels selection (only configured channels)
  // Step 3: Channel Configuration with sub-steps for each selected channel + final review
  let currentStep = $state(1);
  let activeSubStepIndex = $state(0);

  // Selected Channels (always includes catalogue)
  let selectedChannels = $state<string[]>(["catalogue", ...data.configuredChannels.map((c) => c.connector)]);

  // Derive configured channel objects matching selected channel connectors
  const selectedConfiguredChannels = $derived(
    data.configuredChannels.filter((c) => selectedChannels.includes(c.connector))
  );

  const activeChannel = $derived(selectedConfiguredChannels[activeSubStepIndex] ?? null);

  // Etsy Channel derivation
  const etsyChannel = $derived(data.configuredChannels.find((c) => c.connector === "etsy") ?? null);

  // Etsy Configuration Form State
  let etsyShopId = $state(
    (etsyChannel ? data.channelLiveOptions?.[etsyChannel.id]?.shopId : "") ||
    (etsyChannel?.config?.shop_id ? String(etsyChannel.config.shop_id) : "")
  );
  let shippingProfileId = $state<number | string>(
    (etsyChannel ? data.channelLiveOptions?.[etsyChannel.id]?.shippingProfiles?.[0]?.id : "") ||
    etsyChannel?.config?.default_shipping_profile_id ||
    ""
  );
  let returnPolicyId = $state<number | string>(
    (etsyChannel ? data.channelLiveOptions?.[etsyChannel.id]?.returnPolicies?.[0]?.id : "") ||
    etsyChannel?.config?.default_return_policy_id ||
    ""
  );
  let readinessStateId = $state<number | string>(etsyChannel?.config?.default_readiness_state_id || "1508964299419");
  let taxonomyId = $state<number | string>(
    (etsyChannel ? data.channelLiveOptions?.[etsyChannel.id]?.taxonomies?.[0]?.id : 1206) || 1206
  );
  let whoMade = $state("i_did");
  let whenMade = $state("made_to_order");
  let publishImmediately = $state(false);

  // Dynamic discovery states for Etsy
  let isFetchingEtsy = $state(false);
  let etsyFetchError = $state("");
  let fetchedShops = $state<Array<{ shop_id: number; shop_name: string; title?: string }>>(
    (etsyChannel ? data.channelLiveOptions?.[etsyChannel.id]?.shops : []) || []
  );
  let fetchedShippingProfiles = $state<Array<{ id: number; title: string; originCountry?: string }>>(
    (etsyChannel ? data.channelLiveOptions?.[etsyChannel.id]?.shippingProfiles : []) || []
  );
  let fetchedReturnPolicies = $state<Array<{ id: number; description: string; acceptsReturns: boolean }>>(
    (etsyChannel ? data.channelLiveOptions?.[etsyChannel.id]?.returnPolicies : []) || []
  );
  let fetchedTaxonomies = $state<Array<{ id: number; name: string }>>(
    (etsyChannel ? data.channelLiveOptions?.[etsyChannel.id]?.taxonomies : [
      { id: 1203, name: "Jewelry > Earrings" },
      { id: 1206, name: "Jewelry > Earrings > Cluster Earrings" },
      { id: 1212, name: "Jewelry > Earrings > Hoop & Halo Earrings" },
      { id: 1218, name: "Jewelry > Earrings > Stud Earrings" },
      { id: 1208, name: "Jewelry > Earrings > Drop Earrings" },
      { id: 1243, name: "Jewelry > Rings" },
      { id: 1247, name: "Jewelry > Rings > Engagement Rings" },
      { id: 1251, name: "Jewelry > Rings > Solitaire Rings" },
      { id: 1252, name: "Jewelry > Rings > Stackable Rings" },
      { id: 1254, name: "Jewelry > Rings > Wedding Bands" },
      { id: 1227, name: "Jewelry > Necklaces" },
      { id: 1234, name: "Jewelry > Necklaces > Pendants" },
      { id: 1229, name: "Jewelry > Necklaces > Chokers" },
      { id: 1195, name: "Jewelry > Bracelets" },
      { id: 1198, name: "Jewelry > Bracelets > Charm Bracelets" },
      { id: 1199, name: "Jewelry > Bracelets > Cuff Bracelets" },
      { id: 1196, name: "Jewelry > Bracelets > Bangles" },
      { id: 1194, name: "Jewelry (General)" },
    ]) || []
  );
  let isConfigLoaded = $state(Boolean(etsyChannel && data.channelLiveOptions?.[etsyChannel.id]?.shippingProfiles?.length));

  // Generic dynamic configuration store for other channels
  let genericChannelConfigs = $state<Record<string, Record<string, string>>>({});

  // Submission & Progress State
  let submitting = $state(false);
  let importResults = $state<any>(null);
  let progressPercent = $state(0);
  let progressStage = $state("Reading CSV file & grouping variants…");
  let processedItems = $state(0);
  let totalItems = $state(data.sheet?.rowCount || 1);
  let progressTimer: any = null;

  function startProgressTracking() {
    submitting = true;
    progressPercent = 5;
    processedItems = 0;
    totalItems = data.sheet?.rowCount || 1;
    progressStage = "Parsing CSV and grouping variants…";

    if (progressTimer) clearInterval(progressTimer);

    const hasMarketplaces = selectedChannels.some((c) => c !== "catalogue");
    const estTimeMs = Math.max(3000, totalItems * (hasMarketplaces ? 1100 : 80));
    const stepInterval = 250;
    const increment = (90 / (estTimeMs / stepInterval));

    progressTimer = setInterval(() => {
      progressPercent = Math.min(92, progressPercent + increment);
      const approxDone = Math.min(totalItems, Math.floor((progressPercent / 90) * totalItems));
      processedItems = approxDone;

      if (progressPercent < 25) {
        progressStage = `Validating ${totalItems} product records & canonical variants…`;
      } else if (progressPercent < 55) {
        progressStage = hasMarketplaces
          ? `Saving to Store Catalogue & preparing channel payloads (${processedItems}/${totalItems})…`
          : `Writing products and variants to Store Catalogue (${processedItems}/${totalItems})…`;
      } else if (progressPercent < 85) {
        progressStage = hasMarketplaces
          ? `Publishing listings to connected channels & uploading images (${processedItems}/${totalItems})…`
          : `Indexing and committing product records (${processedItems}/${totalItems})…`;
      } else {
        progressStage = hasMarketplaces
          ? `Finalizing channel mappings and publishing verification…`
          : `Finalizing product catalogue import…`;
      }
    }, stepInterval);
  }

  function finishProgressTracking(dataResult: any) {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    progressPercent = 100;
    processedItems = dataResult?.importedCount || totalItems;
    progressStage = "Import and synchronization complete!";
    setTimeout(() => {
      submitting = false;
      importResults = dataResult;
    }, 400);
  }

  const WHO_MADE_OPTIONS = [
    { value: "i_did", label: "I did (Handmade by you)" },
    { value: "collective", label: "A member of my shop (Collective)" },
    { value: "someone_else", label: "Another company or person" },
  ];

  const WHEN_MADE_OPTIONS = [
    { value: "made_to_order", label: "Made to order" },
    { value: "2020_2026", label: "2020 – 2026" },
    { value: "2010_2019", label: "2010 – 2019" },
    { value: "2000_2009", label: "2000 – 2009" },
    { value: "1990s", label: "1990s (Vintage)" },
    { value: "1980s", label: "1980s (Vintage)" },
    { value: "before_1980", label: "Before 1980 (Vintage)" },
  ];

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  onMount(() => {
    const urlStep = Number($page.url.searchParams.get("step"));
    if (urlStep >= 1 && urlStep <= 3) {
      currentStep = urlStep;
    }

    if (etsyChannel && !isConfigLoaded) {
      fetchEtsySettings();
    }
  });

  // Watch URL query param changes for step synchronization
  $effect(() => {
    const urlStep = Number($page.url.searchParams.get("step"));
    if (urlStep >= 1 && urlStep <= 3 && urlStep !== currentStep) {
      currentStep = urlStep;
    }
  });

  function setStep(step: number) {
    currentStep = step;
    if (step === 3) {
      activeSubStepIndex = 0;
    }
    const sheetId = data.sheet?.id || $page.url.searchParams.get("id") || "";
    const params = new URLSearchParams();
    if (sheetId) params.set("id", sheetId);
    params.set("step", String(step));
    goto(`?${params.toString()}`, { replaceState: true, noScroll: true, keepFocus: true });
  }

  function toggleChannel(ch: string) {
    if (ch === "catalogue") return;
    if (selectedChannels.includes(ch)) {
      selectedChannels = selectedChannels.filter((c) => c !== ch);
    } else {
      selectedChannels = [...selectedChannels, ch];
    }
  }

  async function fetchEtsySettings() {
    if (!etsyChannel) return;
    isFetchingEtsy = true;
    etsyFetchError = "";
    try {
      const form = new FormData();
      form.append("channel_id", etsyChannel.id);
      if (etsyShopId) form.append("shop_id", String(etsyShopId).trim());

      const res = await fetch("?/fetchChannelSettings", {
        method: "POST",
        body: form,
      });

      const raw = await res.text();
      let resData: any = null;

      try {
        const result = deserialize(raw);
        if (result.type === "success" && (result as any).data) {
          resData = (result as any).data;
        } else if (result.type === "failure" && (result as any).data) {
          throw new Error((result as any).data?.error || "Failed to fetch Etsy settings.");
        }
      } catch (err: any) {
        if (err.message && !err.message.includes("deserialize")) throw err;
        try {
          resData = JSON.parse(raw);
          if (resData.data) resData = resData.data;
        } catch {}
      }

      if (!resData) {
        throw new Error("Could not parse Etsy settings response.");
      }

      if (resData.error) {
        throw new Error(resData.error);
      }

      if (resData.shops?.length) {
        fetchedShops = resData.shops;
      }

      if (resData.shopId) {
        etsyShopId = String(resData.shopId);
      } else if (resData.shops?.[0]) {
        etsyShopId = String(resData.shops[0].shop_id);
      }

      if (resData.shippingProfiles?.length) {
        fetchedShippingProfiles = resData.shippingProfiles;
        shippingProfileId = resData.shippingProfiles[0].id;
      }

      if (resData.returnPolicies?.length) {
        fetchedReturnPolicies = resData.returnPolicies;
        returnPolicyId = resData.returnPolicies[0].id;
      }

      // Populate taxonomies
      if (resData.taxonomies?.length) {
        fetchedTaxonomies = resData.taxonomies;
        if (!taxonomyId) taxonomyId = resData.taxonomies[0].id;
      }

      isConfigLoaded = true;

      if (resData.discoveryErrors?.length) {
        const warnings = resData.discoveryErrors.filter((e: string) => !e.toLowerCase().includes("return") && !e.toLowerCase().includes("0 results"));
        if (warnings.length > 0 && !resData.shippingProfiles?.length) {
          etsyFetchError = "Some API calls failed: " + warnings.slice(0, 2).join("; ");
        }
      }
    } catch (err: any) {
      etsyFetchError = err.message || "Failed to connect to Etsy API.";
    } finally {
      isFetchingEtsy = false;
    }
  }

  function handleStep3Next() {
    if (activeSubStepIndex < selectedConfiguredChannels.length) {
      activeSubStepIndex++;
    }
  }

  function handleStep3Back() {
    if (activeSubStepIndex > 0) {
      activeSubStepIndex--;
    } else {
      setStep(2);
    }
  }
</script>

<svelte:head><title>Import Sheet · Step {currentStep} · OpenCommerce</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6">
  <!-- Page Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="board text-[1.6rem]">Import Products Wizard</h1>
      <p class="text-sm text-muted-foreground">
        Import sheet
        {#if data.sheet}
          <span class="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 font-mono text-xs font-semibold text-foreground">
            <FileText class="size-3.5 text-primary" /> {data.sheet.filename}
          </span>
          <span class="text-xs text-muted-foreground">({data.sheet.rowCount} rows · Store: {data.storeName})</span>
        {:else}
          <span class="text-xs text-muted-foreground">Session</span>
        {/if}
      </p>
    </div>
    <Button href="/dash/products" variant="outline" size="sm">
      Cancel
    </Button>
  </div>

  {#if !data.sheet}
    <Card>
      <CardContent class="py-12 text-center space-y-3">
        <AlertCircle class="mx-auto size-10 text-muted-foreground/60" />
        <p class="text-sm font-semibold">No import sheet found with this ID</p>
        <p class="text-xs text-muted-foreground">Please upload a CSV sheet from the products dashboard.</p>
        <Button href="/dash/products" class="mt-2">Back to Products</Button>
      </CardContent>
    </Card>
  {:else}
    <!-- Stepper Navigation Header -->
    {#if !importResults}
      <div class="flex items-center justify-between rounded-xl border bg-card p-3.5 text-xs shadow-sm">
        <!-- Step 1 Indicator -->
        <button
          type="button"
          onclick={() => setStep(1)}
          class="flex items-center gap-2 transition-colors {currentStep === 1 ? 'font-bold text-primary' : 'text-muted-foreground hover:text-foreground'}"
        >
          <span class="grid size-6 place-items-center rounded-full text-xs {currentStep === 1 ? 'bg-primary text-primary-foreground font-bold' : (currentStep > 1 ? 'bg-success text-success-foreground' : 'bg-muted')}">
            {#if currentStep > 1}✓{:else}1{/if}
          </span>
          <span>1. Save to System</span>
        </button>

        <span class="text-muted-foreground/40">──────</span>

        <!-- Step 2 Indicator -->
        <button
          type="button"
          onclick={() => setStep(2)}
          class="flex items-center gap-2 transition-colors {currentStep === 2 ? 'font-bold text-primary' : 'text-muted-foreground hover:text-foreground'}"
        >
          <span class="grid size-6 place-items-center rounded-full text-xs {currentStep === 2 ? 'bg-primary text-primary-foreground font-bold' : (currentStep > 2 ? 'bg-success text-success-foreground' : 'bg-muted')}">
            {#if currentStep > 2}✓{:else}2{/if}
          </span>
          <span>2. Channel Selection</span>
        </button>

        <span class="text-muted-foreground/40">──────</span>

        <!-- Step 3 Indicator -->
        <button
          type="button"
          onclick={() => setStep(3)}
          class="flex items-center gap-2 transition-colors {currentStep === 3 ? 'font-bold text-primary' : 'text-muted-foreground hover:text-foreground'}"
        >
          <span class="grid size-6 place-items-center rounded-full text-xs {currentStep === 3 ? 'bg-primary text-primary-foreground font-bold' : 'bg-muted'}">
            3
          </span>
          <span>3. Channel Configuration</span>
        </button>
      </div>
    {/if}

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- RESULT VIEW AFTER IMPORT -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    {#if importResults}
      <Card class="shadow-md">
        <CardHeader>
          <div class="flex items-center gap-3">
            <div class="grid size-10 place-items-center rounded-full bg-success/15 text-success">
              <PackageCheck class="size-6" />
            </div>
            <div>
              <CardTitle>Import & Sync Completed</CardTitle>
              <CardDescription>
                Catalogue records and marketplace listings have been generated for {data.sheet.filename}.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent class="space-y-4">
          <Alert variant={importResults.publishedCount > 0 || importResults.importedCount > 0 ? "success" : "destructive"}>
            <AlertDescription>
              <div class="text-sm font-semibold">
                ✨ Successfully imported {importResults.importedCount} products into your Store Catalogue!
              </div>
              {#if importResults.publishedCount > 0}
                <div class="mt-1 text-xs">
                  🚀 Successfully synchronized <strong>{importResults.publishedCount}</strong> listings to selected marketplace channels.
                </div>
              {/if}
            </AlertDescription>
          </Alert>

          {#if importResults.errors?.length}
            <div class="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-xs text-destructive">
              <p class="font-semibold">Notices / Skipped items:</p>
              <ul class="mt-2 list-inside list-disc space-y-1">
                {#each importResults.errors as err}
                  <li>{err}</li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if importResults.publishedDetails?.length}
            <div class="max-h-60 overflow-y-auto rounded-lg border bg-muted/30 p-3">
              <span class="board-label text-[0.62rem] text-muted-foreground uppercase tracking-wider">Channel Sync Output</span>
              <div class="mt-2 space-y-1.5 text-xs">
                {#each importResults.publishedDetails as item}
                  <div class="flex items-center justify-between border-b border-border/40 py-1.5 font-mono">
                    <span>{item.sku}</span>
                    {#if item.listingId}
                      <Badge variant="success">Remote ID #{item.listingId}</Badge>
                    {:else}
                      <Badge variant="destructive">Failed: {item.error || "Sync error"}</Badge>
                    {/if}
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <div class="flex justify-end pt-4">
            <Button href="/dash/products">View Products Catalogue</Button>
          </div>
        </CardContent>
      </Card>

    <!-- ═══════════════════════════════════════════════════════════════════ -->
    <!-- STEPPER FORM WIZARD -->
    <!-- ═══════════════════════════════════════════════════════════════════ -->
    {:else}
      <form
        method="POST"
        action="?/importSheet"
        class="space-y-6"
        use:enhance={() => {
          startProgressTracking();
          return async ({ result, update }) => {
            if (result.type === "success" && (result.data as any)?.success) {
              finishProgressTracking(result.data);
            } else {
              if (progressTimer) clearInterval(progressTimer);
              submitting = false;
              await update();
            }
          };
        }}
      >
        <input type="hidden" name="sheet_id" value={data.sheet.id} />
        
        <!-- Target Channel IDs to sync -->
        <input
          type="hidden"
          name="target_channel_ids"
          value={selectedConfiguredChannels.map((c) => c.id).join(",")}
        />

        <!-- Backward compatible flags for Etsy -->
        <input type="hidden" name="publish_to_etsy" value={selectedChannels.includes("etsy") ? "true" : "false"} />
        {#if selectedChannels.includes("etsy")}
          <input type="hidden" name="etsy_shop_id" value={etsyShopId} />
          <input type="hidden" name="etsy_shipping_profile_id" value={shippingProfileId} />
          <input type="hidden" name="etsy_return_policy_id" value={returnPolicyId} />
          <input type="hidden" name="etsy_readiness_state_id" value={readinessStateId} />
          <input type="hidden" name="etsy_taxonomy_id" value={taxonomyId} />
          <input type="hidden" name="etsy_who_made" value={whoMade} />
          <input type="hidden" name="etsy_when_made" value={whenMade} />
          <input type="hidden" name="etsy_publish_immediately" value={publishImmediately ? "true" : "false"} />
        {/if}

        <!-- ═════════════════════════════════════════════════════════════ -->
        <!-- STEP 1: SAVE INTO SYSTEM OVERVIEW                             -->
        <!-- ═════════════════════════════════════════════════════════════ -->
        {#if currentStep === 1}
          <Card class="shadow-sm">
            <CardHeader>
              <div class="flex items-center gap-3">
                <div class="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Database class="size-5" />
                </div>
                <div>
                  <CardTitle class="text-lg">Step 1: Save into System (Store Catalogue)</CardTitle>
                  <CardDescription>
                    All products in this import sheet will be parsed and saved into your primary OpenCommerce database.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent class="space-y-5">
              <div class="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
                <div class="flex items-start gap-3">
                  <CheckCircle2 class="mt-0.5 size-5 text-primary shrink-0" />
                  <div class="space-y-1">
                    <p class="text-sm font-semibold text-foreground">
                      Core Canonical Database Storage
                    </p>
                    <p class="text-xs text-muted-foreground leading-relaxed">
                      Your CSV will be grouped into canonical products with variant dimensions, inventory, prices, and attribute tags. Every record is stored safely in your store catalogue regardless of marketplace channels.
                    </p>
                  </div>
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2">
                  <div class="rounded-lg bg-background/80 p-3 border">
                    <span class="text-[11px] text-muted-foreground block">File Name</span>
                    <span class="font-mono font-semibold text-xs text-foreground truncate block">{data.sheet.filename}</span>
                  </div>
                  <div class="rounded-lg bg-background/80 p-3 border">
                    <span class="text-[11px] text-muted-foreground block">CSV Rows</span>
                    <span class="font-semibold text-sm text-foreground">{data.sheet.rowCount} rows</span>
                  </div>
                  <div class="rounded-lg bg-background/80 p-3 border col-span-2 sm:col-span-1">
                    <span class="text-[11px] text-muted-foreground block">Target Store</span>
                    <span class="font-semibold text-xs text-foreground truncate block">{data.storeName} ({data.storeCurrency})</span>
                  </div>
                </div>
              </div>

              <div class="rounded-xl border bg-card p-4 flex items-center justify-between text-xs text-muted-foreground">
                <span class="flex items-center gap-2">
                  <span class="size-2 rounded-full bg-success"></span>
                  Ready to proceed to sales channel selection
                </span>
                <span>Step 1 of 3</span>
              </div>
            </CardContent>
          </Card>

        <!-- ═════════════════════════════════════════════════════════════ -->
        <!-- STEP 2: CHANNEL SELECTION (ALL CONFIGURED CHANNELS)            -->
        <!-- ═════════════════════════════════════════════════════════════ -->
        {:else if currentStep === 2}
          <Card class="shadow-sm">
            <CardHeader>
              <div class="flex items-center justify-between">
                <div>
                  <CardTitle class="text-lg">Step 2: Destination Channels</CardTitle>
                  <CardDescription>
                    Select which configured sales channels should also receive and sync these products.
                  </CardDescription>
                </div>
                <Badge variant="outline" class="text-xs">
                  {selectedChannels.filter((c) => c !== "catalogue").length} channels selected
                </Badge>
              </div>
            </CardHeader>
            <CardContent class="space-y-4">
              <div class="grid gap-3 sm:grid-cols-2">
                <!-- Always Catalogue -->
                <div class="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
                  <div class="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Store class="size-5" />
                  </div>
                  <div class="min-w-0 flex-1">
                    <span class="text-sm font-semibold">Store Catalogue</span>
                    <span class="block text-xs text-muted-foreground truncate">Save canonical products to database</span>
                  </div>
                  <Badge variant="secondary" class="shrink-0">Included (Step 1)</Badge>
                </div>

                <!-- Only Configured Channels (with credentials in DB) -->
                {#each data.configuredChannels as ch (ch.id)}
                  <label
                    class="flex cursor-pointer items-center gap-3 rounded-xl border p-4 transition-all
                           {selectedChannels.includes(ch.connector)
                             ? 'border-primary bg-primary/5 shadow-sm ring-1 ring-primary/20'
                             : 'bg-card hover:border-foreground/20'}"
                  >
                    <input
                      type="checkbox"
                      checked={selectedChannels.includes(ch.connector)}
                      onchange={() => toggleChannel(ch.connector)}
                      class="size-4.5 rounded border-input text-primary shrink-0"
                    />
                    <span class="shrink-0">{@html ch.mark}</span>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="text-sm font-semibold">{ch.name}</span>
                        <Badge variant="outline" class="text-[0.62rem] uppercase">{ch.connector}</Badge>
                      </div>
                      <span class="block text-xs text-success">✓ Credentials configured</span>
                    </div>
                  </label>
                {/each}
              </div>

              {#if data.configuredChannels.length === 0}
                <div class="rounded-xl border border-dashed bg-muted/20 p-5 text-center">
                  <p class="text-xs text-muted-foreground">
                    No marketplace channels have credentials configured yet. Your products will be safely saved into your Store Catalogue.
                    <a href="/dash/channels" class="font-medium text-primary hover:underline ml-1">Configure channels here</a>.
                  </p>
                </div>
              {/if}
            </CardContent>
          </Card>

        <!-- ═════════════════════════════════════════════════════════════ -->
        <!-- STEP 3: SUB-STEPS FOR EACH SELECTED CHANNEL'S CONFIG          -->
        <!-- ═════════════════════════════════════════════════════════════ -->
        {:else if currentStep === 3}
          <!-- SUB-STEPS TABS (When channels are selected) -->
          {#if selectedConfiguredChannels.length > 0}
            <div class="flex items-center gap-2 overflow-x-auto pb-1 border-b text-xs">
              <span class="font-semibold text-muted-foreground mr-1 shrink-0">Sub-steps:</span>
              {#each selectedConfiguredChannels as ch, idx (ch.id)}
                <button
                  type="button"
                  onclick={() => { activeSubStepIndex = idx; }}
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all shrink-0
                         {activeSubStepIndex === idx
                           ? 'bg-primary text-primary-foreground font-bold shadow-sm'
                           : 'bg-muted hover:bg-muted/80 text-foreground'}"
                >
                  <span>3.{idx + 1}</span>
                  <span>{ch.name}</span>
                  {#if idx < activeSubStepIndex}
                    <Check class="size-3 ml-0.5" />
                  {/if}
                </button>
              {/each}
              
              <!-- Review Final Sub-step Tab -->
              <button
                type="button"
                onclick={() => { activeSubStepIndex = selectedConfiguredChannels.length; }}
                class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all shrink-0
                       {activeSubStepIndex === selectedConfiguredChannels.length
                         ? 'bg-primary text-primary-foreground font-bold shadow-sm'
                         : 'bg-muted hover:bg-muted/80 text-foreground'}"
              >
                <span>3.{selectedConfiguredChannels.length + 1}</span>
                <span>Review & Sync</span>
              </button>
            </div>
          {/if}

          <!-- SUB-STEP CONTENT FOR SPECIFIC CHANNEL -->
          {#if selectedConfiguredChannels.length > 0 && activeSubStepIndex < selectedConfiguredChannels.length}
            {@const currentCh = selectedConfiguredChannels[activeSubStepIndex]}

            <!-- ETSY SUB-STEP -->
            {#if currentCh.connector === "etsy"}
              <Card class="shadow-sm">
                <CardHeader>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2.5">
                      {@html currentCh.mark}
                      <div>
                        <CardTitle class="text-lg">Sub-step 3.{activeSubStepIndex + 1}: {currentCh.name} Configuration</CardTitle>
                        <CardDescription>
                          Configure store profile, shipping profiles, return policy, and listing settings.
                        </CardDescription>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="gap-1.5 text-xs"
                      disabled={isFetchingEtsy}
                      onclick={fetchEtsySettings}
                    >
                      {#if isFetchingEtsy}
                        <LoaderCircle class="size-3.5 animate-spin" />
                      {:else}
                        <RefreshCw class="size-3.5" />
                      {/if}
                      Refresh from Etsy API
                    </Button>
                  </div>
                </CardHeader>
                <CardContent class="space-y-4">
                  {#if etsyFetchError}
                    <Alert variant="destructive" class="text-xs">
                      <AlertCircle class="size-3.5" />
                      <AlertDescription>{etsyFetchError}</AlertDescription>
                    </Alert>
                  {/if}

                  {#if isFetchingEtsy}
                    <div class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
                      <div class="flex items-center gap-2 font-medium">
                        <LoaderCircle class="size-3.5 animate-spin" />
                        Fetching options from Etsy API…
                      </div>
                    </div>
                  {/if}

                  <div class="grid gap-4 sm:grid-cols-2">
                    <!-- ETSY SHOP -->
                    <div class="space-y-1.5">
                      <Label for="etsy_shop_id" class="font-medium">
                        Etsy Shop
                        {#if fetchedShops.length > 0}
                          <span class="ml-1 text-[10px] font-normal text-success">✓ {fetchedShops.length} fetched</span>
                        {/if}
                      </Label>
                      {#if fetchedShops.length > 0}
                        <select
                          id="etsy_shop_id"
                          bind:value={etsyShopId}
                          class={selectClass}
                        >
                          {#each fetchedShops as s (s.shop_id)}
                            <option value={String(s.shop_id)}>
                              {s.shop_name} ({s.shop_id})
                            </option>
                          {/each}
                        </select>
                      {:else}
                        <input
                          id="etsy_shop_id"
                          type="text"
                          bind:value={etsyShopId}
                          placeholder="e.g. 39352707"
                          class={selectClass}
                        />
                      {/if}
                    </div>

                    <!-- SHIPPING PROFILE -->
                    <div class="space-y-1.5">
                      <Label for="etsy_shipping_profile_id" class="font-medium">
                        Shipping Profile
                        {#if fetchedShippingProfiles.length > 0}
                          <span class="ml-1 text-[10px] font-normal text-success">✓ {fetchedShippingProfiles.length} fetched</span>
                        {/if}
                      </Label>
                      {#if fetchedShippingProfiles.length > 0}
                        <select
                          id="etsy_shipping_profile_id"
                          bind:value={shippingProfileId}
                          class={selectClass}
                        >
                          {#each fetchedShippingProfiles as p (p.id)}
                            <option value={p.id}>
                              {p.title} (#{p.id})
                            </option>
                          {/each}
                        </select>
                      {:else}
                        <input
                          id="etsy_shipping_profile_id"
                          type="text"
                          bind:value={shippingProfileId}
                          placeholder="e.g. 313420995088"
                          class={selectClass}
                        />
                      {/if}
                    </div>
                  </div>

                  <div class="grid gap-4 sm:grid-cols-2">
                    <!-- RETURN POLICY -->
                    <div class="space-y-1.5">
                      <Label for="etsy_return_policy_id" class="font-medium">
                        Return Policy
                        {#if fetchedReturnPolicies.length > 0}
                          <span class="ml-1 text-[10px] font-normal text-success">✓ {fetchedReturnPolicies.length} fetched</span>
                        {/if}
                      </Label>
                      {#if fetchedReturnPolicies.length > 0}
                        <select
                          id="etsy_return_policy_id"
                          bind:value={returnPolicyId}
                          class={selectClass}
                        >
                          <option value="">None / Default</option>
                          {#each fetchedReturnPolicies as pol (pol.id)}
                            <option value={pol.id}>
                              {pol.description} ({pol.acceptsReturns ? "Accepts returns" : "No returns"})
                            </option>
                          {/each}
                        </select>
                      {:else}
                        <input
                          id="etsy_return_policy_id"
                          type="text"
                          bind:value={returnPolicyId}
                          placeholder="e.g. 123456"
                          class={selectClass}
                        />
                      {/if}
                    </div>

                    <!-- TAXONOMY / CATEGORY -->
                    <div class="space-y-1.5">
                      <Label for="etsy_taxonomy_id" class="font-medium">
                        Etsy Taxonomy ID / Category
                        {#if fetchedTaxonomies.length > 0}
                          <span class="ml-1 text-[10px] font-normal text-success">✓ {fetchedTaxonomies.length} available</span>
                        {/if}
                      </Label>
                      {#if fetchedTaxonomies.length > 0}
                        <select
                          id="etsy_taxonomy_id"
                          bind:value={taxonomyId}
                          class={selectClass}
                        >
                          {#each fetchedTaxonomies as t (t.id)}
                            <option value={t.id}>
                              {t.name} (#{t.id})
                            </option>
                          {/each}
                        </select>
                      {:else}
                        <input
                          id="etsy_taxonomy_id"
                          type="text"
                          bind:value={taxonomyId}
                          placeholder="e.g. 1206"
                          class={selectClass}
                        />
                      {/if}
                    </div>
                  </div>

                  <div class="grid gap-4 sm:grid-cols-2">
                    <!-- READINESS STATE -->
                    <div class="space-y-1.5">
                      <Label for="etsy_readiness_state_id" class="font-medium">Readiness State ID</Label>
                      <input
                        id="etsy_readiness_state_id"
                        type="text"
                        bind:value={readinessStateId}
                        placeholder="e.g. 1508964299419"
                        class={selectClass}
                      />
                    </div>

                    <div>
                      <Label for="etsy_who_made" class="mb-1.5 block font-medium">Who Made It?</Label>
                      <select id="etsy_who_made" bind:value={whoMade} class={selectClass}>
                        {#each WHO_MADE_OPTIONS as opt (opt.value)}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    </div>
                  </div>

                  <div class="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label for="etsy_when_made" class="mb-1.5 block font-medium">When Was It Made?</Label>
                      <select id="etsy_when_made" bind:value={whenMade} class={selectClass}>
                        {#each WHEN_MADE_OPTIONS as opt (opt.value)}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    </div>

                    <div class="flex items-center gap-2 pt-6">
                      <input
                        type="checkbox"
                        id="etsy_publish_immediately"
                        bind:checked={publishImmediately}
                        class="size-4 rounded border-input"
                      />
                      <Label for="etsy_publish_immediately" class="cursor-pointer text-xs font-normal">
                        Publish immediately as <strong>active</strong> on Etsy (default is draft)
                      </Label>
                    </div>
                  </div>
                </CardContent>
              </Card>

            <!-- GENERIC OTHER CONNECTOR SUB-STEP -->
            {:else}
              <Card class="shadow-sm">
                <CardHeader>
                  <div class="flex items-center gap-2.5">
                    {@html currentCh.mark}
                    <div>
                      <CardTitle class="text-lg">Sub-step 3.{activeSubStepIndex + 1}: {currentCh.name} Configuration</CardTitle>
                      <CardDescription>
                        Configuration parameters for {currentCh.name} ({currentCh.connector}).
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent class="space-y-4">
                  <div class="rounded-lg border bg-muted/20 p-4 space-y-2">
                    <div class="flex items-center gap-2 text-xs font-semibold text-foreground">
                      <Check class="size-4 text-success" /> Channel Ready for Publishing
                    </div>
                    <p class="text-xs text-muted-foreground">
                      Authenticated credentials and default endpoints are loaded from your channel configuration.
                    </p>
                  </div>
                </CardContent>
              </Card>
            {/if}

          <!-- FINAL SUB-STEP: REVIEW & SYNC -->
          {:else}
            <Card class="shadow-sm">
              <CardHeader>
                <CardTitle class="text-lg">Review & Run Import</CardTitle>
                <CardDescription>
                  Review the summary of catalogue saving and marketplace sync before execution.
                </CardDescription>
              </CardHeader>
              <CardContent class="space-y-4">
                <!-- Live Progress Card when submitting -->
                {#if submitting}
                  <div class="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-2.5">
                        <LoaderCircle class="size-5 animate-spin text-primary" />
                        <div>
                          <span class="text-sm font-bold text-foreground">Import & Marketplace Synchronization</span>
                          <span class="block text-xs text-muted-foreground">{progressStage}</span>
                        </div>
                      </div>
                      <span class="text-base font-bold font-mono text-primary">{Math.round(progressPercent)}%</span>
                    </div>

                    <div class="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        class="h-full bg-primary transition-all duration-300 ease-out"
                        style="width: {progressPercent}%"
                      ></div>
                    </div>

                    <div class="grid grid-cols-3 gap-2 pt-1 text-[11px] text-muted-foreground">
                      <div class="flex items-center gap-1.5">
                        <span class="size-2 rounded-full {progressPercent >= 20 ? 'bg-success' : 'bg-muted-foreground/40'}"></span>
                        <span>1. Group Variants</span>
                      </div>
                      <div class="flex items-center gap-1.5 justify-center">
                        <span class="size-2 rounded-full {progressPercent >= 50 ? 'bg-success' : (progressPercent >= 20 ? 'bg-primary animate-pulse' : 'bg-muted-foreground/40')}"></span>
                        <span>2. Save Catalogue</span>
                      </div>
                      <div class="flex items-center gap-1.5 justify-end">
                        <span class="size-2 rounded-full {progressPercent >= 90 ? 'bg-success' : (progressPercent >= 50 ? 'bg-primary animate-pulse' : 'bg-muted-foreground/40')}"></span>
                        <span>3. Sync Channels</span>
                      </div>
                    </div>
                  </div>
                {/if}

                <div class="space-y-3 rounded-xl border bg-muted/20 p-4 text-xs">
                  <div class="flex justify-between border-b pb-2">
                    <span class="text-muted-foreground">Source Sheet File:</span>
                    <span class="font-medium font-mono">{data.sheet.filename}</span>
                  </div>
                  <div class="flex justify-between border-b pb-2">
                    <span class="text-muted-foreground">Product Records:</span>
                    <span class="font-semibold">{data.sheet.rowCount} rows detected</span>
                  </div>
                  <div class="flex justify-between border-b pb-2">
                    <span class="text-muted-foreground">Step 1 Save Target:</span>
                    <span class="font-semibold text-primary">Store Catalogue (OpenCommerce DB)</span>
                  </div>
                  <div class="flex justify-between border-b pb-2">
                    <span class="text-muted-foreground">Step 2 Channels:</span>
                    <span class="font-semibold text-foreground">
                      {selectedConfiguredChannels.length > 0 ? selectedConfiguredChannels.map((c) => c.name).join(", ") : "None (Local Catalogue Only)"}
                    </span>
                  </div>

                  {#if selectedChannels.includes("etsy")}
                    <div class="flex justify-between border-b pb-2">
                      <span class="text-muted-foreground">Etsy Shop ID:</span>
                      <span class="font-mono">{etsyShopId || "Default"}</span>
                    </div>
                    <div class="flex justify-between border-b pb-2">
                      <span class="text-muted-foreground">Etsy Shipping Profile:</span>
                      <span class="font-mono">{shippingProfileId || "Default"}</span>
                    </div>
                    <div class="flex justify-between border-b pb-2">
                      <span class="text-muted-foreground">Etsy Taxonomy ID:</span>
                      <span class="font-mono">{taxonomyId || "Auto-resolved"}</span>
                    </div>
                    <div class="flex justify-between pb-1">
                      <span class="text-muted-foreground">Etsy Listing State:</span>
                      <span class="font-semibold">{publishImmediately ? "Active" : "Draft"}</span>
                    </div>
                  {/if}
                </div>
              </CardContent>
            </Card>
          {/if}
        {/if}

        <!-- ═════════════════════════════════════════════════════════════ -->
        <!-- WIZARD BUTTONS NAVIGATION                                     -->
        <!-- ═════════════════════════════════════════════════════════════ -->
        {#if !importResults}
          <div class="flex items-center justify-between border-t pt-4">
            <div>
              {#if currentStep === 1}
                <Button href="/dash/products" variant="outline">
                  Cancel
                </Button>
              {:else if currentStep === 2}
                <Button type="button" variant="outline" onclick={() => setStep(1)}>
                  <ArrowLeft class="mr-1.5 size-4" /> Back to Step 1
                </Button>
              {:else if currentStep === 3}
                <Button type="button" variant="outline" onclick={handleStep3Back}>
                  <ArrowLeft class="mr-1.5 size-4" />
                  {#if activeSubStepIndex > 0}
                    Back to Sub-step {activeSubStepIndex}
                  {:else}
                    Back to Step 2
                  {/if}
                </Button>
              {/if}
            </div>

            <div class="flex items-center gap-2">
              {#if currentStep === 1}
                <Button type="button" onclick={() => setStep(2)}>
                  Continue to Channel Selection <ArrowRight class="ml-1.5 size-4" />
                </Button>
              {:else if currentStep === 2}
                <Button type="button" onclick={() => setStep(3)}>
                  Continue to Channel Configuration <ArrowRight class="ml-1.5 size-4" />
                </Button>
              {:else if currentStep === 3}
                {#if selectedConfiguredChannels.length > 0 && activeSubStepIndex < selectedConfiguredChannels.length}
                  <Button type="button" onclick={handleStep3Next}>
                    Next Sub-step <ArrowRight class="ml-1.5 size-4" />
                  </Button>
                {:else}
                  <Button type="submit" disabled={submitting}>
                    {#if submitting}
                      <LoaderCircle class="mr-2 size-4 animate-spin" />
                      Importing & Syncing…
                    {:else}
                      <UploadCloud class="mr-2 size-4" />
                      Start Import & Sync
                    {/if}
                  </Button>
                {/if}
              {/if}
            </div>
          </div>
        {/if}
      </form>
    {/if}
  {/if}
</div>
