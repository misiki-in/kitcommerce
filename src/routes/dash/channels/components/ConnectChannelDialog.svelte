<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button, buttonVariants } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import * as Dialog from "$lib/components/ui/dialog";
  import Field from "$lib/components/field.svelte";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Check from "@lucide/svelte/icons/check";
  import AlertCircle from "@lucide/svelte/icons/alert-circle";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Key from "@lucide/svelte/icons/key";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Layers from "@lucide/svelte/icons/layers";

  let {
    open = $bindable(false),
    connector = null,
    storeName,
  }: {
    open: boolean;
    connector: any;
    storeName: string;
  } = $props();

  // Dynamic values for credential fields
  let credValues = $state<Record<string, string>>({});

  // OAuth Automation State
  let redirectUri = $state("https://localhost");
  let generatedAuthUrl = $state("");
  let pkceVerifier = $state("");
  let pastedCode = $state("");
  let showAdvancedTokens = $state(false);
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

  $effect(() => {
    if (connector?.fields) {
      const init: Record<string, string> = {};
      for (const f of connector.fields) {
        init[f.key] = "";
      }
      credValues = init;
      generatedAuthUrl = "";
      pkceVerifier = "";
      pastedCode = "";
      oauthSuccessMessage = "";
      oauthErrorMessage = "";
      showAdvancedTokens = false;
      discoveredCatalogs = [];
      discoveredBusinesses = [];
      discoveredEbayFulfillment = [];
      discoveredEbayReturns = [];
      discoveredEbayPayments = [];
      discoveredEbayLocations = [];

      if (typeof window !== "undefined") {
        if (connector.name === "etsy") {
          redirectUri = `${window.location.origin}/auth/etsy/callback`;
        } else if (connector.name === "meta" || connector.name === "facebook" || connector.name === "instagram") {
          redirectUri = `${window.location.origin}/auth/meta/callback`;
        } else {
          redirectUri = `${window.location.origin}/auth/${connector.name}/callback`;
        }
      }
    }
  });

  function isMeta(name: string) {
    return name === "meta" || name === "facebook" || name === "instagram";
  }

  // ══════════════════════════════════════════════════════════════════
  // EBAY HANDLERS
  // ══════════════════════════════════════════════════════════════════
  function startOneClickEbayOAuth() {
    const clientId = (credValues["client_id"] || "").trim();
    const clientSecret = (credValues["client_secret"] || "").trim();
    const ruName = (credValues["ru_name"] || "").trim();

    const params = new URLSearchParams();
    if (clientId) params.set("client_id", clientId);
    if (clientSecret) params.set("shared_secret", clientSecret);
    if (ruName) params.set("redirect_uri", ruName);

    if (typeof window !== "undefined") {
      window.location.href = `/auth/ebay?${params.toString()}`;
    }
  }

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
      oauthErrorMessage = "Please paste the redirect URL or authorization code.";
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
      oauthErrorMessage = "Please fetch or enter a Refresh Token first.";
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

  // ══════════════════════════════════════════════════════════════════
  // ETSY HANDLERS
  // ══════════════════════════════════════════════════════════════════
  function startOneClickEtsyOAuth() {
    const keystring = (credValues["api_key"] || credValues["keystring"] || "").trim();
    const sharedSecret = (credValues["shared_secret"] || "").trim();

    if (!keystring) {
      oauthErrorMessage = "Please enter your Keystring (x-api-key) to connect.";
      return;
    }

    const currentOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
    const chosenRedirect = redirectUri.trim() || `${currentOrigin}/auth/etsy/callback`;

    const params = new URLSearchParams({
      client_id: keystring,
      shared_secret: sharedSecret,
      redirect_uri: chosenRedirect,
    });

    if (typeof window !== "undefined") {
      window.location.href = `/auth/etsy?${params.toString()}`;
    }
  }

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
  // META (FACEBOOK & INSTAGRAM) ZERO-CREDENTIAL 1-CLICK OAUTH HANDLER
  // ══════════════════════════════════════════════════════════════════
  function startOneClickMetaOAuth() {
    const appId = (credValues["app_id"] || credValues["client_id"] || "").trim();
    const appSecret = (credValues["app_secret"] || credValues["client_secret"] || "").trim();

    if (!connector.hasServerOAuth && !appId) {
      oauthErrorMessage = "Please enter your Meta App ID below, or configure META_APP_ID in your server .env.";
      return;
    }

    const currentOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
    const chosenRedirect = redirectUri.trim() || `${currentOrigin}/auth/meta/callback`;

    const params = new URLSearchParams();
    if (appId) params.set("client_id", appId);
    if (appSecret) params.set("shared_secret", appSecret);
    if (chosenRedirect) params.set("redirect_uri", chosenRedirect);

    const qs = params.toString() ? `?${params.toString()}` : "";
    if (typeof window !== "undefined") {
      window.location.href = `/auth/meta${qs}`;
    }
  }

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

      const catCount = discoveredCatalogs.length;
      oauthSuccessMessage = `Access token fetched! ${catCount > 0 ? `Auto-discovered ${catCount} catalog(s).` : "Ready to connect."}`;
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
  {#if connector}
    <Dialog.Content class="max-h-[92vh] overflow-y-auto sm:max-w-xl">
      <Dialog.Header>
        <div class="flex items-center gap-3">
          {@html connector.mark}
          <div>
            <Dialog.Title>{connector.already ? `Add another ${connector.displayName} account` : `Connect ${connector.displayName}`}</Dialog.Title>
            <Dialog.Description>
              {connector.regions.join(", ")} · {connector.authType} · {connector.rps}/s
            </Dialog.Description>
          </div>
        </div>
      </Dialog.Header>

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- 1-CLICK ETSY OAUTH FLOW (COMPLETELY AUTOMATED) -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {#if connector.name === "etsy"}
        <div class="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Sparkles class="size-4 text-primary" />
              <span class="text-sm font-bold text-foreground">1-Click Automated Connection</span>
            </div>
            <Badge variant="success">Recommended</Badge>
          </div>

          <p class="text-xs text-muted-foreground leading-relaxed">
            Enter your <strong>Keystring</strong> (and optional Shared Secret), then click Connect. You will approve on Etsy and be returned here with everything configured automatically.
          </p>

          <div class="grid gap-3 sm:grid-cols-2">
            <Field
              label="Keystring (x-api-key)"
              name="quick_keystring"
              required
              placeholder="e.g. xfntq5ua34db6l1lxr0bsp4r"
              bind:value={credValues["api_key"]}
            />
            <Field
              label="Shared secret"
              name="quick_shared_secret"
              type="password"
              placeholder="e.g. cdeacycl9q"
              bind:value={credValues["shared_secret"]}
            />
          </div>

          <div class="space-y-1 text-xs">
            <span class="font-medium text-foreground">Callback / Redirect URI</span>
            <input
              type="text"
              bind:value={redirectUri}
              placeholder="e.g. http://localhost:5173/auth/etsy/callback or https://localhost"
              class="flex h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs font-mono"
            />
            <p class="text-[10px] text-muted-foreground">
              Must match one of the <strong>Callback URLs</strong> in your Etsy Developer App settings at <a href="https://www.etsy.com/developers/your-apps" target="_blank" rel="noopener" class="underline text-primary">etsy.com/developers</a>.
            </p>
          </div>

          {#if oauthErrorMessage}
            <Alert variant="destructive" class="text-xs py-2">
              <AlertCircle class="size-3.5" />
              <AlertDescription>{oauthErrorMessage}</AlertDescription>
            </Alert>
          {/if}

          <Button
            type="button"
            class="w-full gap-2 font-semibold shadow-sm"
            onclick={startOneClickEtsyOAuth}
          >
            Connect with Etsy
            <ArrowRight class="size-4" />
          </Button>
        </div>

        <div class="my-1 flex items-center gap-3">
          <span class="h-px flex-1 bg-border"></span>
          <button
            type="button"
            onclick={() => (showAdvancedTokens = !showAdvancedTokens)}
            class="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Manual Token Setup & Advanced Tools
            <ChevronDown class="size-3 transition-transform {showAdvancedTokens ? 'rotate-180' : ''}" />
          </button>
          <span class="h-px flex-1 bg-border"></span>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- 1-CLICK META OAUTH FLOW (ZERO-CREDENTIALS LOGIN WITH FACEBOOK) -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {#if isMeta(connector.name)}
        <div class="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Sparkles class="size-4 text-primary" />
              <span class="text-sm font-bold text-foreground">1-Click Facebook & Instagram Connect</span>
            </div>
            <Badge variant="success">Zero Config</Badge>
          </div>

          <p class="text-xs text-muted-foreground leading-relaxed">
            Click below to sign in with your Facebook or Instagram business account. OpenCommerce will request access to your commerce catalogues (<strong>catalog_management</strong>, <strong>business_management</strong>) and synchronize your products automatically.
          </p>

          {#if !connector.hasServerOAuth && !credValues["app_id"]}
            <div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-2">
              <div class="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200">
                <AlertCircle class="size-3.5" />
                <span>Self-Hosted Server Notice</span>
              </div>
              <p class="text-[11px] text-muted-foreground leading-relaxed">
                Set <code>META_APP_ID</code> and <code>META_APP_SECRET</code> in your server's <code>.env</code> file to enable instant 1-click login for all users, or enter your Meta App ID & Secret below.
              </p>
              <div class="grid gap-2.5 sm:grid-cols-2 pt-1">
                <Field
                  label="Meta App ID"
                  name="quick_app_id"
                  placeholder="e.g. 159283746192837"
                  bind:value={credValues["app_id"]}
                />
                <Field
                  label="Meta App Secret"
                  name="quick_app_secret"
                  type="password"
                  placeholder="e.g. 4a8b9c0d1e2f3a4b..."
                  bind:value={credValues["app_secret"]}
                />
              </div>
            </div>
          {/if}

          {#if oauthErrorMessage}
            <Alert variant="destructive" class="text-xs py-2">
              <AlertCircle class="size-3.5" />
              <AlertDescription>{oauthErrorMessage}</AlertDescription>
            </Alert>
          {/if}

          {#if oauthSuccessMessage}
            <Alert variant="success" class="text-xs py-2">
              <Check class="size-3.5" />
              <AlertDescription>{oauthSuccessMessage}</AlertDescription>
            </Alert>
          {/if}

          <Button
            type="button"
            class="w-full gap-2.5 font-semibold shadow-sm bg-[#1877F2] hover:bg-[#166FE5] text-white"
            onclick={startOneClickMetaOAuth}
          >
            <svg class="size-4 fill-current" viewBox="0 0 24 24">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            Continue with Facebook
            <ArrowRight class="size-4 ml-auto" />
          </Button>
        </div>

        <div class="my-1 flex items-center gap-3">
          <span class="h-px flex-1 bg-border"></span>
          <button
            type="button"
            onclick={() => (showAdvancedTokens = !showAdvancedTokens)}
            class="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Manual Token Setup & Catalog Discovery
            <ChevronDown class="size-3 transition-transform {showAdvancedTokens ? 'rotate-180' : ''}" />
          </button>
          <span class="h-px flex-1 bg-border"></span>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- 1-CLICK EBAY OAUTH FLOW (ZERO-MANUAL-TOKEN CONNECT)             -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {#if connector.name === "ebay"}
        <div class="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <Sparkles class="size-4 text-primary" />
              <span class="text-sm font-bold text-foreground">1-Click eBay Store Connect</span>
            </div>
            <Badge variant="success">Recommended</Badge>
          </div>

          <p class="text-xs text-muted-foreground leading-relaxed">
            Click below to sign in to your eBay Seller account and approve OpenCommerce. Your inventory, business policies (fulfillment, return, payment), and orders will be linked automatically.
          </p>

          {#if !connector.hasServerOAuth && !credValues["client_id"]}
            <div class="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-2">
              <div class="flex items-center gap-1.5 font-medium text-amber-900 dark:text-amber-200">
                <AlertCircle class="size-3.5" />
                <span>Self-Hosted Server Notice</span>
              </div>
              <p class="text-[11px] text-muted-foreground leading-relaxed">
                Set <code>EBAY_CLIENT_ID</code>, <code>EBAY_CLIENT_SECRET</code>, and <code>EBAY_RU_NAME</code> in your server's <code>.env</code> file for instant 1-click connect, or enter them below:
              </p>
              <div class="grid gap-2.5 sm:grid-cols-2 pt-1">
                <Field
                  label="App ID (Client ID)"
                  name="quick_ebay_client_id"
                  placeholder="e.g. MyShop-App-PRD-..."
                  bind:value={credValues["client_id"]}
                />
                <Field
                  label="Cert ID (Client Secret)"
                  name="quick_ebay_client_secret"
                  type="password"
                  placeholder="e.g. PRD-123456789abc..."
                  bind:value={credValues["client_secret"]}
                />
                <div class="sm:col-span-2">
                  <Field
                    label="eBay RuName (Redirect URL Name)"
                    name="quick_ebay_ru_name"
                    placeholder="e.g. YourName-YourApp-PRD-12345..."
                    bind:value={credValues["ru_name"]}
                    help="From developer.ebay.com > User Tokens > Your Application Redirect URL"
                  />
                </div>
              </div>
            </div>
          {/if}

          {#if oauthErrorMessage}
            <Alert variant="destructive" class="text-xs py-2">
              <AlertCircle class="size-3.5" />
              <AlertDescription>{oauthErrorMessage}</AlertDescription>
            </Alert>
          {/if}

          {#if oauthSuccessMessage}
            <Alert variant="success" class="text-xs py-2">
              <Check class="size-3.5" />
              <AlertDescription>{oauthSuccessMessage}</AlertDescription>
            </Alert>
          {/if}

          <Button
            type="button"
            class="w-full gap-2.5 font-semibold shadow-sm bg-[#e53238] hover:bg-[#c92429] text-white"
            onclick={startOneClickEbayOAuth}
          >
            <ExternalLink class="size-4" />
            Connect with eBay
            <ArrowRight class="size-4 ml-auto" />
          </Button>
        </div>

        <div class="my-1 flex items-center gap-3">
          <span class="h-px flex-1 bg-border"></span>
          <button
            type="button"
            onclick={() => (showAdvancedTokens = !showAdvancedTokens)}
            class="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Manual Token Setup & Policy Discovery
            <ChevronDown class="size-3 transition-transform {showAdvancedTokens ? 'rotate-180' : ''}" />
          </button>
          <span class="h-px flex-1 bg-border"></span>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- MANUAL / ADVANCED FORM -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {#if (!isMeta(connector.name) && connector.name !== "etsy" && connector.name !== "ebay") || showAdvancedTokens}
        <form
          method="POST"
          action="?/connect"
          class="space-y-4"
          use:enhance={() => {
            return async ({ update }) => {
              await update();
              open = false;
            };
          }}
        >
          <input type="hidden" name="connector" value={connector.name} />
          <Field
            label="Channel display name"
            name="name"
            required
            value={`${connector.displayName} — ${storeName}`}
          />

          <div class="space-y-4 rounded-xl border bg-muted/30 p-4">
            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <span>Seller portal credentials</span>
              <a
                href={connector.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                API docs <ExternalLink class="size-3" />
              </a>
            </div>

            <!-- Fields with dynamic values -->
            {#each connector.fields as f (f.key)}
              <div class="space-y-1">
                <Field
                  label={f.label}
                  name={`cred_${f.key}`}
                  type={f.secret ? "password" : "text"}
                  autocomplete="off"
                  help={f.help}
                  required={!f.optional}
                  bind:value={credValues[f.key]}
                />

                <!-- Catalog Discovery Selector for Meta -->
                {#if f.key === "catalog_id" && isMeta(connector.name)}
                  <div class="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isDiscoveringCatalogs || !credValues["access_token"]}
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

            <!-- 2-Step Generator for Meta when Advanced is toggled -->
            {#if isMeta(connector.name)}
              <div class="rounded-xl border border-primary/20 bg-muted/40 p-3.5 space-y-3 mt-2 text-xs">
                <span class="font-bold text-foreground block">Meta OAuth Dialog & Token Exchange</span>

                <!-- Step 1 -->
                <div class="space-y-1">
                  <span class="text-[11px] font-semibold">1. Open Meta Authorization Dialog:</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={redirectUri}
                      placeholder="Redirect URI (e.g. https://localhost)"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isGeneratingAuth || !credValues["app_id"]}
                      onclick={generateMetaAuth}
                      class="text-xs shrink-0"
                    >
                      Open OAuth Dialog
                    </Button>
                  </div>
                </div>

                <!-- Step 2 -->
                <div class="space-y-1 pt-1">
                  <span class="text-[11px] font-semibold">2. Paste Redirected URL / Code:</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={pastedCode}
                      placeholder="https://localhost/?code=..."
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isExchangingToken || !pastedCode}
                      onclick={exchangeMetaCode}
                      class="text-xs shrink-0 gap-1"
                    >
                      <Key class="size-3" /> Fetch Token & Catalogs
                    </Button>
                  </div>
                </div>
              </div>
            {/if}

            <!-- 2-Step Generator for Etsy when Advanced is toggled -->
            {#if connector.name === "etsy"}
              <div class="rounded-xl border border-primary/20 bg-muted/40 p-3.5 space-y-3 mt-2 text-xs">
                <span class="font-bold text-foreground block">OAuth 2.0 PKCE Generator</span>

                {#if oauthSuccessMessage}
                  <Alert variant="success" class="text-xs py-1.5">
                    <Check class="size-3.5" />
                    <AlertDescription>{oauthSuccessMessage}</AlertDescription>
                  </Alert>
                {/if}

                <!-- Step 1 -->
                <div class="space-y-1">
                  <span class="text-[11px] font-semibold">1. Open Authorization URL:</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={redirectUri}
                      placeholder="Redirect URI (e.g. https://localhost)"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isGeneratingAuth || !credValues["api_key"]}
                      onclick={generateEtsyAuth}
                      class="text-xs shrink-0"
                    >
                      Open URL
                    </Button>
                  </div>
                </div>

                <!-- Step 2 -->
                <div class="space-y-1 pt-1">
                  <span class="text-[11px] font-semibold">2. Paste Redirected URL / Code:</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={pastedCode}
                      placeholder="https://localhost/?code=..."
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isExchangingToken || !pastedCode}
                      onclick={exchangeEtsyCode}
                      class="text-xs shrink-0 gap-1"
                    >
                      <Key class="size-3" /> Fetch Tokens
                    </Button>
                  </div>
                </div>

                <!-- Refresh Token -->
                {#if credValues["refresh_token"]}
                  <div class="flex items-center justify-between border-t pt-2">
                    <span class="text-[10px] text-muted-foreground">Renew token:</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isRefreshingToken}
                      onclick={refreshEtsyTokens}
                      class="gap-1 text-xs h-7"
                    >
                      <RefreshCw class="size-3" /> Refresh
                    </Button>
                  </div>
                {/if}
              </div>
            {/if}

            <!-- 2-Step Generator for eBay when Advanced is toggled -->
            {#if connector.name === "ebay"}
              <div class="rounded-xl border border-primary/20 bg-muted/40 p-3.5 space-y-3 mt-2 text-xs">
                <span class="font-bold text-foreground block">eBay OAuth Authorization & Policy Discovery</span>

                {#if oauthSuccessMessage}
                  <Alert variant="success" class="text-xs py-1.5">
                    <Check class="size-3.5" />
                    <AlertDescription>{oauthSuccessMessage}</AlertDescription>
                  </Alert>
                {/if}

                <!-- Step 1 -->
                <div class="space-y-1">
                  <span class="text-[11px] font-semibold">1. Open eBay Authorization Dialog:</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={credValues["ru_name"]}
                      placeholder="eBay RuName (e.g. YourName-YourApp-PRD-...)"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={isGeneratingAuth}
                      onclick={generateEbayAuth}
                      class="text-xs shrink-0"
                    >
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

                <!-- Step 2 -->
                <div class="space-y-1 pt-1">
                  <span class="text-[11px] font-semibold">2. Paste Redirected URL / Authorization Code:</span>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      bind:value={pastedCode}
                      placeholder="Paste accepted URL (e.g. ?code=...) or authorization code"
                      class="flex h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs font-mono"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isExchangingToken || !pastedCode}
                      onclick={exchangeEbayCode}
                      class="text-xs shrink-0 gap-1"
                    >
                      <Key class="size-3" /> Fetch Tokens & Policies
                    </Button>
                  </div>
                </div>

                <!-- Step 3: Policy Discovery -->
                {#if credValues["refresh_token"]}
                  <div class="space-y-2 border-t pt-2">
                    <div class="flex items-center justify-between">
                      <span class="text-[11px] font-semibold">Business Policies & Inventory:</span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isDiscoveringCatalogs}
                        onclick={discoverEbayPolicies}
                        class="gap-1 text-xs h-7"
                      >
                        <RefreshCw class="size-3 {isDiscoveringCatalogs ? 'animate-spin' : ''}" /> Discover Policies
                      </Button>
                    </div>

                    {#if discoveredEbayFulfillment.length > 0}
                      <div class="text-[11px] text-muted-foreground">
                        ✓ Found {discoveredEbayFulfillment.length} fulfillment policy(s), {discoveredEbayReturns.length} return policy(s), {discoveredEbayLocations.length} location(s).
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}

            <Field
              label="Extra config (JSON)"
              name="config"
              textarea
              rows={2}
              value={"{}"}
              help={'e.g. {"catalog_id":"123456789","business_id":"987654321"}'}
            />
          </div>

          <Dialog.Footer>
            <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
            <Button type="submit">{connector.already ? "Add account" : `Connect ${connector.displayName}`}</Button>
          </Dialog.Footer>
        </form>
      {/if}
    </Dialog.Content>
  {/if}
</Dialog.Root>
