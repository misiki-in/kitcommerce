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

  let {
    open = $bindable(false),
    channel = null,
  }: {
    open: boolean;
    channel: any;
  } = $props();

  let credValues = $state<Record<string, string>>({});

  // Etsy PKCE OAuth Automation State
  let redirectUri = $state("https://localhost");
  let generatedAuthUrl = $state("");
  let pkceVerifier = $state("");
  let pastedCode = $state("");
  let isGeneratingAuth = $state(false);
  let isExchangingToken = $state(false);
  let isRefreshingToken = $state(false);
  let oauthSuccessMessage = $state("");
  let oauthErrorMessage = $state("");

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
    }
  });

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
          {/each}

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

          <Field
            label="Extra parameters / config (JSON)"
            name="config"
            textarea
            rows={3}
            value={channel.config}
            help={'e.g. {"warehouse_id":"wh_123","allocationStrategy":"split","currency":"INR"}'}
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
