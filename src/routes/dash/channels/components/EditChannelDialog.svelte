<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import * as Dialog from "$lib/components/ui/dialog";
  import Field from "$lib/components/field.svelte";
  import Lock from "@lucide/svelte/icons/lock";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Check from "@lucide/svelte/icons/check";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Key from "@lucide/svelte/icons/key";
  import Layers from "@lucide/svelte/icons/layers";

  let {
    open = $bindable(false),
    channel = null,
  }: {
    open: boolean;
    channel: any;
  } = $props();

  let credValues = $state<Record<string, string>>({});

  // OAuth Automation State
  let redirectUri = $state("https://localhost");
  let generatedAuthUrl = $state("");
  let pkceVerifier = $state("");
  let pastedCode = $state("");
  let isGeneratingAuth = $state(false);
  let isExchangingToken = $state(false);
  let isRefreshingToken = $state(false);
  let isDiscoveringCatalogs = $state(false);
  let oauthSuccessMessage = $state("");
  let oauthErrorMessage = $state("");

  let discoveredCatalogs = $state<Array<{ id: string; name: string; product_count?: number }>>([]);
  let discoveredBusinesses = $state<Array<{ id: string; name: string }>>([]);
  let discoveredEbayFulfillment = $state<Array<{ id: string; name: string }>>([]);
  let discoveredEbayReturns = $state<Array<{ id: string; name: string }>>([]);
  let discoveredEbayPayments = $state<Array<{ id: string; name: string }>>([]);
  let discoveredEbayLocations = $state<Array<{ key: string; name: string }>>([]);

  function isMeta(name: string) {
    return name === "meta" || name === "facebook" || name === "instagram";
  }

  // ══════════════════════════════════════════════════════════════════
  // EBAY HANDLERS
  // ══════════════════════════════════════════════════════════════════
  async function generateEbayAuth() {
    const clientId = (credValues["client_id"] || "").trim();
    const ruName = (credValues["ru_name"] || redirectUri || "").trim();

    isGeneratingAuth = true;
    oauthErrorMessage = "";
    oauthSuccessMessage = "";

    try {
      const form = new FormData();
      if (clientId) form.append("client_id", clientId);
      if (ruName) form.append("ru_name", ruName);

      const res = await fetch("?/generateEbayAuthUrl", {
        method: "POST",
        body: form,
      });

      const result = await res.json();
      const data = result?.data || result;
      if (result.type === "failure" || data?.error) {
        throw new Error(data?.error || "Failed to generate eBay authorization URL.");
      }

      generatedAuthUrl = data.authUrl;
      if (data.ruName && !credValues["ru_name"]) {
        credValues["ru_name"] = data.ruName;
      }

      if (typeof window !== "undefined") {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      oauthErrorMessage = err.message || "Failed to generate eBay authorization URL.";
    } finally {
      isGeneratingAuth = false;
    }
  }

  async function exchangeEbayCode() {
    const clientId = (credValues["client_id"] || "").trim();
    const clientSecret = (credValues["client_secret"] || "").trim();
    const ruName = (credValues["ru_name"] || redirectUri || "").trim();

    if (!pastedCode.trim()) {
      oauthErrorMessage = "Please paste the redirected URL or authorization code.";
      return;
    }

    isExchangingToken = true;
    oauthErrorMessage = "";
    oauthSuccessMessage = "";

    try {
      const form = new FormData();
      if (clientId) form.append("client_id", clientId);
      if (clientSecret) form.append("client_secret", clientSecret);
      if (ruName) form.append("ru_name", ruName);
      form.append("code", pastedCode.trim());

      const res = await fetch("?/exchangeEbayCode", {
        method: "POST",
        body: form,
      });

      const result = await res.json();
      const data = result?.data || result;
      if (result.type === "failure" || data?.error) {
        throw new Error(data?.error || "eBay token exchange failed.");
      }

      credValues["refresh_token"] = data.refreshToken;
      discoveredEbayFulfillment = data.fulfillmentPolicies || [];
      discoveredEbayReturns = data.returnPolicies || [];
      discoveredEbayPayments = data.paymentPolicies || [];
      discoveredEbayLocations = data.locations || [];

      oauthSuccessMessage = `Tokens fetched successfully! Discovered ${discoveredEbayFulfillment.length} fulfillment, ${discoveredEbayReturns.length} return policies.`;
    } catch (err: any) {
      oauthErrorMessage = err.message || "eBay token exchange failed.";
    } finally {
      isExchangingToken = false;
    }
  }

  async function discoverEbayPolicies() {
    const clientId = (credValues["client_id"] || "").trim();
    const clientSecret = (credValues["client_secret"] || "").trim();
    const refreshToken = (credValues["refresh_token"] || "").trim();

    if (!refreshToken) {
      oauthErrorMessage = "Please enter or fetch a Refresh Token first.";
      return;
    }

    isDiscoveringCatalogs = true;
    oauthErrorMessage = "";
    oauthSuccessMessage = "";

    try {
      const form = new FormData();
      if (clientId) form.append("client_id", clientId);
      if (clientSecret) form.append("client_secret", clientSecret);
      form.append("refresh_token", refreshToken);

      const res = await fetch("?/discoverEbayPolicies", {
        method: "POST",
        body: form,
      });

      const result = await res.json();
      const data = result?.data || result;
      if (result.type === "failure" || data?.error) {
        throw new Error(data?.error || "Policy discovery failed.");
      }

      discoveredEbayFulfillment = data.fulfillmentPolicies || [];
      discoveredEbayReturns = data.returnPolicies || [];
      discoveredEbayPayments = data.paymentPolicies || [];
      discoveredEbayLocations = data.locations || [];

      oauthSuccessMessage = `Discovered ${discoveredEbayFulfillment.length} fulfillment policy(s), ${discoveredEbayReturns.length} return policy(s), ${discoveredEbayLocations.length} location(s).`;
    } catch (err: any) {
      oauthErrorMessage = err.message || "Policy discovery failed.";
    } finally {
      isDiscoveringCatalogs = false;
    }
  }

  $effect(() => {
    if (channel?.fields) {
      const init: Record<string, string> = {};
      for (const f of channel.fields) {
        init[f.key] = "";
      }
      credValues = init;
      generatedAuthUrl = "";
      pkceVerifier = "";
      pastedCode = "";
      oauthSuccessMessage = "";
      oauthErrorMessage = "";
      discoveredCatalogs = [];
      discoveredBusinesses = [];

      if (typeof window !== "undefined") {
        if (channel.connector === "etsy") {
          redirectUri = `${window.location.origin}/auth/etsy/callback`;
        } else if (isMeta(channel.connector)) {
          redirectUri = `${window.location.origin}/auth/meta/callback`;
        } else {
          redirectUri = `${window.location.origin}/auth/${channel.connector}/callback`;
        }
      }
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // ETSY HANDLERS
  // ══════════════════════════════════════════════════════════════════
  async function generateEtsyAuth() {
    const keystring = (credValues["api_key"] || credValues["keystring"] || "").trim();
    if (!keystring) {
      oauthErrorMessage = "Please enter your Keystring (x-api-key) first.";
      return;
    }

    isGeneratingAuth = true;
    oauthErrorMessage = "";
    oauthSuccessMessage = "";

    try {
      const form = new FormData();
      form.append("keystring", keystring);
      form.append("redirect_uri", redirectUri.trim() || "https://localhost");

      const res = await fetch("?/generateEtsyAuthUrl", {
        method: "POST",
        body: form,
      });

      const result = await res.json();
      const data = result?.data || result;
      if (result.type === "failure" || data?.error) {
        throw new Error(data?.error || "Failed to generate authorization URL.");
      }

      generatedAuthUrl = data.authUrl;
      pkceVerifier = data.verifier;
      redirectUri = data.redirectUri;

      if (typeof window !== "undefined") {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      oauthErrorMessage = err.message || "Failed to generate authorization URL.";
    } finally {
      isGeneratingAuth = false;
    }
  }

  async function exchangeEtsyCode() {
    const keystring = (credValues["api_key"] || credValues["keystring"] || "").trim();
    const sharedSecret = (credValues["shared_secret"] || "").trim();

    if (!keystring) {
      oauthErrorMessage = "Keystring is required.";
      return;
    }
    if (!pastedCode.trim()) {
      oauthErrorMessage = "Please paste the redirect URL or authorization code.";
      return;
    }
    if (!pkceVerifier) {
      oauthErrorMessage = "PKCE verifier is missing. Please click 'Generate Authorization URL' first.";
      return;
    }

    isExchangingToken = true;
    oauthErrorMessage = "";
    oauthSuccessMessage = "";

    try {
      const form = new FormData();
      form.append("keystring", keystring);
      form.append("shared_secret", sharedSecret);
      form.append("code", pastedCode.trim());
      form.append("verifier", pkceVerifier);
      form.append("redirect_uri", redirectUri.trim() || "https://localhost");

      const res = await fetch("?/exchangeEtsyCode", {
        method: "POST",
        body: form,
      });

      const result = await res.json();
      const data = result?.data || result;
      if (result.type === "failure" || data?.error) {
        throw new Error(data?.error || "Token exchange failed.");
      }

      credValues["access_token"] = data.accessToken;
      credValues["refresh_token"] = data.refreshToken;
      oauthSuccessMessage = `Tokens fetched successfully! Access token valid for ${Math.round(data.expiresIn / 60)} min; Refresh token valid for 90 days.`;
    } catch (err: any) {
      oauthErrorMessage = err.message || "Token exchange failed.";
    } finally {
      isExchangingToken = false;
    }
  }

  async function refreshEtsyTokens() {
    const keystring = (credValues["api_key"] || credValues["keystring"] || "").trim();
    const sharedSecret = (credValues["shared_secret"] || "").trim();
    const refreshToken = (credValues["refresh_token"] || "").trim();

    if (!keystring || !refreshToken) {
      oauthErrorMessage = "Keystring and Refresh Token are required to refresh.";
      return;
    }

    isRefreshingToken = true;
    oauthErrorMessage = "";
    oauthSuccessMessage = "";

    try {
      const form = new FormData();
      form.append("keystring", keystring);
      form.append("shared_secret", sharedSecret);
      form.append("refresh_token", refreshToken);

      const res = await fetch("?/refreshEtsyToken", {
        method: "POST",
        body: form,
      });

      const result = await res.json();
      const data = result?.data || result;
      if (result.type === "failure" || data?.error) {
        throw new Error(data?.error || "Token refresh failed.");
      }

      credValues["access_token"] = data.accessToken;
      credValues["refresh_token"] = data.refreshToken;
      oauthSuccessMessage = `Tokens refreshed successfully! Access token renewed.`;
    } catch (err: any) {
      oauthErrorMessage = err.message || "Token refresh failed.";
    } finally {
      isRefreshingToken = false;
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // META (FACEBOOK & INSTAGRAM) HANDLERS
  // ══════════════════════════════════════════════════════════════════
  async function generateMetaAuth() {
    const appId = (credValues["app_id"] || credValues["client_id"] || "").trim();
    if (!appId) {
      oauthErrorMessage = "Please enter your Meta App ID first.";
      return;
    }

    isGeneratingAuth = true;
    oauthErrorMessage = "";
    oauthSuccessMessage = "";

    try {
      const form = new FormData();
      form.append("app_id", appId);
      form.append("redirect_uri", redirectUri.trim() || "https://localhost");

      const res = await fetch("?/generateMetaAuthUrl", {
        method: "POST",
        body: form,
      });

      const result = await res.json();
      const data = result?.data || result;
      if (result.type === "failure" || data?.error) {
        throw new Error(data?.error || "Failed to generate Meta authorization URL.");
      }

      generatedAuthUrl = data.authUrl;
      redirectUri = data.redirectUri;

      if (typeof window !== "undefined") {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
      }
    } catch (err: any) {
      oauthErrorMessage = err.message || "Failed to generate Meta authorization URL.";
    } finally {
      isGeneratingAuth = false;
    }
  }

  async function exchangeMetaCode() {
    const appId = (credValues["app_id"] || credValues["client_id"] || "").trim();
    const appSecret = (credValues["app_secret"] || credValues["client_secret"] || "").trim();

    if (!appId) {
      oauthErrorMessage = "Meta App ID is required.";
      return;
    }
    if (!pastedCode.trim()) {
      oauthErrorMessage = "Please paste the redirected URL or authorization code.";
      return;
    }

    isExchangingToken = true;
    oauthErrorMessage = "";
    oauthSuccessMessage = "";

    try {
      const form = new FormData();
      form.append("app_id", appId);
      form.append("app_secret", appSecret);
      form.append("code", pastedCode.trim());
      form.append("redirect_uri", redirectUri.trim() || "https://localhost");

      const res = await fetch("?/exchangeMetaCode", {
        method: "POST",
        body: form,
      });

      const result = await res.json();
      const data = result?.data || result;
      if (result.type === "failure" || data?.error) {
        throw new Error(data?.error || "Meta token exchange failed.");
      }

      credValues["access_token"] = data.accessToken;
      if (data.catalogId) {
        credValues["catalog_id"] = data.catalogId;
      }
      if (data.businesses?.[0]?.id) {
        credValues["business_id"] = data.businesses[0].id;
      }
      discoveredCatalogs = data.catalogs || [];
      discoveredBusinesses = data.businesses || [];

      oauthSuccessMessage = `Access token fetched! Auto-discovered ${discoveredCatalogs.length} catalog(s).`;
    } catch (err: any) {
      oauthErrorMessage = err.message || "Meta token exchange failed.";
    } finally {
      isExchangingToken = false;
    }
  }

  async function discoverMetaCatalogs() {
    const token = (credValues["access_token"] || "").trim();
    if (!token) {
      oauthErrorMessage = "Please enter an Access Token first to discover catalogs.";
      return;
    }

    isDiscoveringCatalogs = true;
    oauthErrorMessage = "";
    oauthSuccessMessage = "";

    try {
      const form = new FormData();
      form.append("access_token", token);
      form.append("catalog_id", (credValues["catalog_id"] || "").trim());

      const res = await fetch("?/discoverMetaCatalogs", {
        method: "POST",
        body: form,
      });

      const result = await res.json();
      const data = result?.data || result;
      if (result.type === "failure" || data?.error) {
        throw new Error(data?.error || "Catalog discovery failed.");
      }

      discoveredCatalogs = data.catalogs || [];
      discoveredBusinesses = data.businesses || [];
      if (data.catalogId && !credValues["catalog_id"]) {
        credValues["catalog_id"] = data.catalogId;
      }
      if (data.businesses?.[0]?.id && !credValues["business_id"]) {
        credValues["business_id"] = data.businesses[0].id;
      }
      oauthSuccessMessage = `Discovered ${discoveredCatalogs.length} catalog(s) and ${discoveredBusinesses.length} business portfolio(s).`;
    } catch (err: any) {
      oauthErrorMessage = err.message || "Catalog discovery failed.";
    } finally {
      isDiscoveringCatalogs = false;
    }
  }
</script>

<Dialog.Root bind:open>
  {#if channel}
    <Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-xl">
      <Dialog.Header>
        <div class="flex items-center gap-3">
          {@html channel.mark}
          <div>
            <Dialog.Title>Edit {channel.displayName} Configuration</Dialog.Title>
            <Dialog.Description>
              Update channel details, rotate credentials, or modify JSON parameters.
            </Dialog.Description>
          </div>
        </div>
      </Dialog.Header>

      <form
        method="POST"
        action="?/update"
        class="space-y-4"
        use:enhance={() => {
          return async ({ update }) => {
            await update();
            open = false;
          };
        }}
      >
        <input type="hidden" name="id" value={channel.id} />

        <Field
          label="Channel display name"
          name="name"
          required
          value={channel.name}
        />

        <div class="space-y-4 rounded-xl border bg-muted/30 p-4">
          <div class="flex items-center justify-between">
            <span class="board-label text-[0.62rem] text-muted-foreground">Credentials</span>
            <Badge variant="success"><Lock class="mr-1 size-3" /> encrypted AES-256-GCM</Badge>
          </div>

          {#if channel.credentialsNote}
            <p class="text-xs leading-relaxed text-muted-foreground">
              {channel.credentialsNote}
              {#if channel.docsUrl}
                <a
                  href={channel.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  Portal <ExternalLink class="size-3" />
                </a>
              {/if}
            </p>
          {/if}

          {#if channel.setupGuide}
            <p class="text-xs text-muted-foreground">
              Need help?
              <a
                href={channel.setupGuide}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                Step-by-step setup guide <ExternalLink class="size-3" />
              </a>
            </p>
          {/if}

          {#each channel.fields as f (f.key)}
            {@const isStored = channel.storedCredKeys?.includes(f.key)}
            <div class="space-y-1">
              <Field
                label={f.label}
                name={`cred_${f.key}`}
                type={f.secret ? "password" : "text"}
                autocomplete="off"
                placeholder={isStored && !credValues[f.key] ? "•••••••••••• (stored)" : ""}
                help={isStored
                  ? "Credential is saved. Leave blank to keep existing value, or enter a new one to rotate."
                  : f.help}
                bind:value={credValues[f.key]}
              />

              <!-- Catalog Discovery Selector for Meta -->
              {#if f.key === "catalog_id" && isMeta(channel.connector)}
                <div class="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isDiscoveringCatalogs}
                    onclick={discoverMetaCatalogs}
                    class="h-7 text-xs gap-1"
                  >
                    <Layers class="size-3" />
                    {#if isDiscoveringCatalogs}
                      <LoaderCircle class="size-3 animate-spin" />
                    {/if}
                    Auto-Discover Catalogs
                  </Button>
                  {#if discoveredCatalogs.length > 0}
                    <select
                      class="flex h-7 rounded-md border border-input bg-background px-2 text-xs"
                      onchange={(e) => {
                        const target = e.target as HTMLSelectElement;
                        if (target.value) credValues["catalog_id"] = target.value;
                      }}
                    >
                      <option value="">Select discovered catalog ({discoveredCatalogs.length} found)…</option>
                      {#each discoveredCatalogs as c (c.id)}
                        <option value={c.id}>{c.name} (ID: {c.id}{c.product_count !== undefined ? `, ${c.product_count} items` : ""})</option>
                      {/each}
                    </select>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}

          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- AUTOMATIC META OAUTH TOKEN GENERATOR (FOR META) -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          {#if isMeta(channel.connector)}
            <div class="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3.5 mt-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <Sparkles class="size-4 text-primary" />
                  <span class="text-xs font-bold text-foreground">Automatic Meta OAuth & Catalog Discovery</span>
                </div>
                <Badge variant="outline" class="text-[0.62rem]">OAuth 2.0</Badge>
              </div>
              <p class="text-[11px] text-muted-foreground leading-relaxed">
                Generate or exchange tokens with Meta Graph API and discover connected commerce catalogs.
              </p>

              {#if oauthSuccessMessage}
                <Alert variant="success" class="text-xs py-2">
                  <Check class="size-3.5" />
                  <AlertDescription>{oauthSuccessMessage}</AlertDescription>
                </Alert>
              {/if}

              {#if oauthErrorMessage}
                <Alert variant="destructive" class="text-xs py-2">
                  <AlertCircle class="size-3.5" />
                  <AlertDescription>{oauthErrorMessage}</AlertDescription>
                </Alert>
              {/if}

              <div class="space-y-3 border-t border-primary/20 pt-3">
                <!-- Step 1: Generate Auth URL -->
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-semibold">Step 1: Open Meta Authorization</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={redirectUri}
                      placeholder="Redirect URI (e.g. https://localhost)"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isGeneratingAuth || !credValues["app_id"]}
                      onclick={generateMetaAuth}
                      class="gap-1.5 text-xs shrink-0"
                    >
                      {#if isGeneratingAuth}
                        <LoaderCircle class="size-3 animate-spin" />
                      {:else}
                        <ExternalLink class="size-3" />
                      {/if}
                      Open OAuth Dialog
                    </Button>
                  </div>
                  {#if generatedAuthUrl}
                    <div class="rounded bg-background p-2 text-[10px] font-mono text-muted-foreground border truncate">
                      <a href={generatedAuthUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">
                        {generatedAuthUrl}
                      </a>
                    </div>
                  {/if}
                </div>

                <!-- Step 2: Exchange Code -->
                <div class="space-y-1.5 pt-1">
                  <span class="block text-xs font-semibold">Step 2: Paste Redirect URL or Code to Fetch Tokens</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={pastedCode}
                      placeholder="Paste redirected URL or authorization code"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isExchangingToken || !pastedCode}
                      onclick={exchangeMetaCode}
                      class="gap-1.5 text-xs shrink-0"
                    >
                      {#if isExchangingToken}
                        <LoaderCircle class="size-3 animate-spin" />
                      {:else}
                        <Key class="size-3" />
                      {/if}
                      Fetch & Auto-Fill
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          {/if}

          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- AUTOMATIC ETSY OAUTH PKCE TOKEN GENERATOR (FOR ETSY) -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          {#if channel.connector === "etsy"}
            <div class="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3.5 mt-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <Sparkles class="size-4 text-primary" />
                  <span class="text-xs font-bold text-foreground">Automatic Etsy OAuth Token Fetcher</span>
                </div>
                <Badge variant="outline" class="text-[0.62rem]">OAuth 2.0 PKCE</Badge>
              </div>
              <p class="text-[11px] text-muted-foreground leading-relaxed">
                Automatically generate & exchange authorization tokens with Etsy API using your Keystring.
              </p>

              {#if oauthSuccessMessage}
                <Alert variant="success" class="text-xs py-2">
                  <Check class="size-3.5" />
                  <AlertDescription>{oauthSuccessMessage}</AlertDescription>
                </Alert>
              {/if}

              {#if oauthErrorMessage}
                <Alert variant="destructive" class="text-xs py-2">
                  <AlertCircle class="size-3.5" />
                  <AlertDescription>{oauthErrorMessage}</AlertDescription>
                </Alert>
              {/if}

              <div class="space-y-3 border-t border-primary/20 pt-3">
                <!-- Step 1: Generate Auth URL -->
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-semibold">Step 1: Open Etsy Authorization</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={redirectUri}
                      placeholder="Redirect URI (e.g. https://localhost)"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isGeneratingAuth || !credValues["api_key"]}
                      onclick={generateEtsyAuth}
                      class="gap-1.5 text-xs shrink-0"
                    >
                      {#if isGeneratingAuth}
                        <LoaderCircle class="size-3 animate-spin" />
                      {:else}
                        <ExternalLink class="size-3" />
                      {/if}
                      Open Auth URL
                    </Button>
                  </div>
                  {#if generatedAuthUrl}
                    <div class="rounded bg-background p-2 text-[10px] font-mono text-muted-foreground border truncate">
                      <a href={generatedAuthUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">
                        {generatedAuthUrl}
                      </a>
                    </div>
                  {/if}
                </div>

                <!-- Step 2: Exchange Code -->
                <div class="space-y-1.5 pt-1">
                  <span class="block text-xs font-semibold">Step 2: Paste Redirect URL or Code to Fetch Tokens</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={pastedCode}
                      placeholder="Paste redirected URL (e.g. https://localhost/?code=...) or code"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isExchangingToken || !pastedCode}
                      onclick={exchangeEtsyCode}
                      class="gap-1.5 text-xs shrink-0"
                    >
                      {#if isExchangingToken}
                        <LoaderCircle class="size-3 animate-spin" />
                      {:else}
                        <Key class="size-3" />
                      {/if}
                      Fetch & Auto-Fill Tokens
                    </Button>
                  </div>
                </div>

                <!-- Optional: Refresh existing token -->
                <div class="flex items-center justify-between border-t border-primary/20 pt-2.5 text-xs">
                  <span class="text-[11px] text-muted-foreground">Rotate / renew using refresh token:</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isRefreshingToken || !credValues["refresh_token"]}
                    onclick={refreshEtsyTokens}
                    class="gap-1 text-xs h-7"
                  >
                    {#if isRefreshingToken}
                      <LoaderCircle class="size-3 animate-spin" />
                    {:else}
                      <RefreshCw class="size-3" />
                    {/if}
                    Refresh Token
                  </Button>
                </div>
              </div>
            </div>
          {/if}

          <!-- ═══════════════════════════════════════════════════════════ -->
          <!-- AUTOMATIC EBAY OAUTH TOKEN & POLICY DISCOVERY               -->
          <!-- ═══════════════════════════════════════════════════════════ -->
          {#if channel.connector === "ebay"}
            <div class="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3.5 mt-2">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <Sparkles class="size-4 text-primary" />
                  <span class="text-xs font-bold text-foreground">eBay OAuth & Business Policy Discovery</span>
                </div>
                <Badge variant="outline" class="text-[0.62rem]">OAuth 2.0</Badge>
              </div>
              <p class="text-[11px] text-muted-foreground leading-relaxed">
                Re-authorize or discover fulfillment, return, payment policies and inventory locations from eBay API.
              </p>

              {#if oauthSuccessMessage}
                <Alert variant="success" class="text-xs py-2">
                  <Check class="size-3.5" />
                  <AlertDescription>{oauthSuccessMessage}</AlertDescription>
                </Alert>
              {/if}

              {#if oauthErrorMessage}
                <Alert variant="destructive" class="text-xs py-2">
                  <AlertCircle class="size-3.5" />
                  <AlertDescription>{oauthErrorMessage}</AlertDescription>
                </Alert>
              {/if}

              <div class="space-y-3 border-t border-primary/20 pt-3">
                <!-- Step 1: Generate Auth URL -->
                <div class="space-y-1.5">
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-semibold">Step 1: Open eBay Authorization Dialog</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={credValues["ru_name"]}
                      placeholder="eBay RuName (e.g. YourName-YourApp-PRD-...)"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isGeneratingAuth}
                      onclick={generateEbayAuth}
                      class="gap-1.5 text-xs shrink-0"
                    >
                      {#if isGeneratingAuth}
                        <LoaderCircle class="size-3 animate-spin" />
                      {:else}
                        <ExternalLink class="size-3" />
                      {/if}
                      Open OAuth Dialog
                    </Button>
                  </div>
                  {#if generatedAuthUrl}
                    <div class="rounded bg-background p-2 text-[10px] font-mono text-muted-foreground border truncate">
                      <a href={generatedAuthUrl} target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">
                        {generatedAuthUrl}
                      </a>
                    </div>
                  {/if}
                </div>

                <!-- Step 2: Exchange Code -->
                <div class="space-y-1.5 pt-1">
                  <span class="block text-xs font-semibold">Step 2: Paste Redirected URL / Code</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={pastedCode}
                      placeholder="Paste accepted URL (e.g. ?code=...) or code"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isExchangingToken || !pastedCode}
                      onclick={exchangeEbayCode}
                      class="gap-1.5 text-xs shrink-0"
                    >
                      {#if isExchangingToken}
                        <LoaderCircle class="size-3 animate-spin" />
                      {:else}
                        <Key class="size-3" />
                      {/if}
                      Fetch & Discover
                    </Button>
                  </div>
                </div>

                <!-- Step 3: Discover Policies -->
                <div class="flex items-center justify-between border-t border-primary/20 pt-2.5 text-xs">
                  <span class="text-[11px] text-muted-foreground">Sync business policies & locations:</span>
                  <div class="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isDiscoveringCatalogs || !credValues["refresh_token"]}
                      onclick={discoverEbayPolicies}
                      class="gap-1 text-xs h-7"
                    >
                      {#if isDiscoveringCatalogs}
                        <LoaderCircle class="size-3 animate-spin" />
                      {:else}
                        <RefreshCw class="size-3" />
                      {/if}
                      Sync Policies
                    </Button>
                  </div>
                </div>

                {#if discoveredEbayFulfillment.length > 0 || discoveredEbayReturns.length > 0 || discoveredEbayPayments.length > 0}
                  <div class="rounded-lg border bg-background/80 p-3 space-y-2.5 text-xs mt-2">
                    <div class="flex items-center justify-between">
                      <span class="font-semibold text-[11px] text-foreground">Discovered eBay Policies</span>
                      <span class="text-[10px] text-muted-foreground">Auto-assigned to listings</span>
                    </div>

                    <div class="grid gap-2 sm:grid-cols-3 text-[11px]">
                      <div class="rounded border p-2 bg-muted/20">
                        <span class="block font-medium text-muted-foreground">Fulfillment / Shipping</span>
                        <span class="block truncate font-semibold text-foreground mt-0.5">
                          {discoveredEbayFulfillment[0]?.name || "Auto-managed"}
                        </span>
                      </div>
                      <div class="rounded border p-2 bg-muted/20">
                        <span class="block font-medium text-muted-foreground">Return Policy</span>
                        <span class="block truncate font-semibold text-foreground mt-0.5">
                          {discoveredEbayReturns[0]?.name || "30-Day Returns"}
                        </span>
                      </div>
                      <div class="rounded border p-2 bg-muted/20">
                        <span class="block font-medium text-muted-foreground">Payment Policy</span>
                        <span class="block truncate font-semibold text-foreground mt-0.5">
                          {discoveredEbayPayments[0]?.name || "Managed Payments"}
                        </span>
                      </div>
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <Field
            label="Extra parameters / config (JSON)"
            name="config"
            textarea
            rows={3}
            value={channel.config}
            help={'e.g. {"catalog_id":"123456789","business_id":"987654321"}'}
          />
        </div>

        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
          <Button type="submit">Save Changes</Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  {/if}
</Dialog.Root>
