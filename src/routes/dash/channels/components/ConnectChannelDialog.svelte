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

  // Etsy PKCE OAuth Automation State
  let redirectUri = $state("https://localhost");
  let generatedAuthUrl = $state("");
  let pkceVerifier = $state("");
  let pastedCode = $state("");
  let showAdvancedTokens = $state(false);
  let isGeneratingAuth = $state(false);
  let isExchangingToken = $state(false);
  let isRefreshingToken = $state(false);
  let oauthSuccessMessage = $state("");
  let oauthErrorMessage = $state("");

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
      if (typeof window !== "undefined") {
        redirectUri = `${window.location.origin}/auth/etsy/callback`;
      }
    }
  });

  function startOneClickOAuth() {
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
      window.location.href = `/auth/${connector.name}?${params.toString()}`;
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
            onclick={startOneClickOAuth}
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
      <!-- MANUAL / ADVANCED FORM -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {#if connector.name !== "etsy" || showAdvancedTokens}
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
              <Field
                label={f.label}
                name={`cred_${f.key}`}
                type={f.secret ? "password" : "text"}
                autocomplete="off"
                help={f.help}
                required={!f.optional}
                bind:value={credValues[f.key]}
              />
            {/each}

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

            <Field
              label="Extra config (JSON)"
              name="config"
              textarea
              rows={2}
              value={"{}"}
              help={'e.g. {"shop_id":"39352707","default_shipping_profile_id":12345}'}
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
