<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import Field from "$lib/components/field.svelte";
  import ConfirmButton from "$lib/components/confirm-button.svelte";
  import Check from "@lucide/svelte/icons/check";
  import Download from "@lucide/svelte/icons/download";
  import BookOpen from "@lucide/svelte/icons/book-open";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";

  let { litekart, form }: { litekart: any; form: any } = $props();
  let importing = $state(false);
</script>

<Card>
  <CardHeader>
    <CardTitle class="text-base">Catalogue source</CardTitle>
    <CardDescription>
      Import products from an existing store instead of typing them in. Litekart is a
      <strong>platform adapter</strong>, not a sales channel — products flow <em>in</em> from it,
      then out to your marketplaces.
    </CardDescription>
  </CardHeader>
  <CardContent>
    {#if litekart.connected}
      <div class="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
        <Check class="size-4 shrink-0 text-success" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">Connected to Litekart</p>
          <p class="truncate font-mono text-xs text-muted-foreground">{litekart.baseUrl}</p>
        </div>
        <Badge variant="secondary">
          {litekart.importedCount} product{litekart.importedCount === 1 ? "" : "s"} imported
        </Badge>
      </div>

      <div class="mb-6 flex flex-wrap gap-2">
        <form
          method="POST"
          action="?/importLitekart"
          use:enhance={() => {
            importing = true;
            return async ({ update }) => {
              await update();
              importing = false;
            };
          }}
        >
          <Button type="submit" disabled={importing}>
            {#if importing}<LoaderCircle class="animate-spin" />{:else}<Download />{/if}
            {importing ? "Importing…" : "Import catalogue"}
          </Button>
        </form>
        <ConfirmButton
          action="?/disconnectLitekart"
          label="Disconnect"
          size="default"
          title="Disconnect Litekart?"
          consequence="Already-imported products stay in your catalogue. Only the stored connection is removed, so further imports stop until you reconnect."
          confirmLabel="Disconnect"
        />
      </div>

      {#if form?.imported}
        <Alert variant="success" class="mb-6">
          <AlertDescription>
            {form.imported.created} created · {form.imported.updated} updated ·
            {form.imported.unchanged} unchanged. Imported products land as
            <strong>drafts</strong> — review them, then publish.
          </AlertDescription>
        </Alert>
      {/if}
    {/if}

    <div class="mb-5 rounded-lg border bg-muted/40 p-4">
      <p class="mb-3 flex items-center gap-2 board-label text-[0.62rem] text-muted-foreground">
        <BookOpen class="size-3.5" /> Where to find these
      </p>
      <ol class="space-y-2 text-sm">
        <li class="flex gap-2.5">
          <span class="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">1</span>
          <span>Sign in to your Litekart admin.</span>
        </li>
        <li class="flex gap-2.5">
          <span class="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">2</span>
          <span>
            Open <strong>Settings → API</strong> and create an API key with read access to
            products. A read-only key is enough — OpenCommerce never writes back to Litekart.
          </span>
        </li>
        <li class="flex gap-2.5">
          <span class="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">3</span>
          <span>
            Copy your store URL (the admin origin, e.g. <code class="rounded bg-background px-1 py-0.5 text-xs">https://yourstore.litekart.in</code>)
            and paste both below.
          </span>
        </li>
      </ol>
      <p class="mt-3 text-xs text-muted-foreground">
        The key is sealed with AES-256-GCM before it is stored, exactly like your marketplace
        credentials, and is never returned by the API. We verify the connection before saving,
        so a wrong URL or key fails here rather than silently at the first import.
      </p>
    </div>

    <form method="POST" action="?/connectLitekart" class="space-y-4" use:enhance>
      <Field
        label="Store URL"
        name="base_url"
        required
        value={litekart.baseUrl}
        placeholder="https://yourstore.litekart.in"
        help="The origin only — no trailing path."
      />
      <Field
        label="API key"
        name="api_token"
        type="password"
        autocomplete="off"
        placeholder={litekart.hasToken ? "•••••••••••• stored" : ""}
        help={litekart.hasToken ? "Stored. Leave blank to keep it, or type a new key." : ""}
      />
      <Button type="submit">
        {litekart.connected ? "Update connection" : "Connect Litekart"}
      </Button>
    </form>
  </CardContent>
</Card>
