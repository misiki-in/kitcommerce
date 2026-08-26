<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button, buttonVariants } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import * as Dialog from "$lib/components/ui/dialog";
  import Field from "$lib/components/field.svelte";
  import ConfirmButton from "$lib/components/confirm-button.svelte";
  import ExternalLink from "@lucide/svelte/icons/external-link";
import ArrowRight from "@lucide/svelte/icons/arrow-right";
import Check from "@lucide/svelte/icons/check";
import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import { statusLabel, statusVariant, timeAgo } from "$lib/format";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();

  type Connector = PageServerData["groups"][number]["connectors"][number];

  /**
   * ONE dialog for all 14 connectors, driven by which one is selected.
   *
   * Rendering a Dialog.Root per connector meant 14 portals mounted at once,
   * which hung server rendering outright. A single dialog is also the shape
   * shadcn itself uses for a list of items.
   */
  let selected = $state<Connector | null>(null);
  let open = $state(false);
  let mode = $state<"mock" | "live">("mock");

  /**
   * Test feedback belongs on the row you clicked, not in a banner at the top
   * of the page: with five channels listed, a top-level alert makes you match
   * a name back to a row to work out what happened.
   */
  let testingId = $state<string | null>(null);
  let flashId = $state<string | null>(null);
  let flashOk = $state(true);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function flash(id: string, ok: boolean) {
    clearTimeout(flashTimer);
    flashId = id;
    flashOk = ok;
    flashTimer = setTimeout(() => (flashId = null), 1800);
  }

  function pick(connector: Connector) {
    selected = connector;
    mode = "mock";
    open = true;
  }
</script>

<svelte:head><title>Channels · OpenCommerce</title></svelte:head>

<div class="mb-6">
  <h1 class="board text-[1.6rem]">Channels</h1>
  <p class="text-sm text-muted-foreground">Each marketplace account you publish to</p>
</div>

<!-- Test results animate on their own row; only connect/errors need a banner. -->
{#if form?.connected}
  <Alert variant="success" class="mb-4"><AlertDescription>{form.connected} connected.</AlertDescription></Alert>
{:else if form?.error}
  <Alert variant="destructive" class="mb-4"><AlertDescription>{form.error}</AlertDescription></Alert>
{/if}

{#if data.connected.length}
  <Card class="mb-6">
    <CardHeader><CardTitle class="text-base">Connected channels</CardTitle></CardHeader>
    <CardContent class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="pl-6">Channel</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead class="text-right">Listings</TableHead>
            <TableHead class="text-right">Last check</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {#each data.connected as channel (channel.id)}
            <TableRow
              class={flashId === channel.id
                ? flashOk
                  ? "animate-flash-ok"
                  : "animate-flash-bad"
                : ""}
            >
              <TableCell class="pl-6">
                <span class="flex items-center gap-2.5">
                  {@html channel.mark}
                  <span>
                    <span class="block text-sm font-medium">{channel.name}</span>
                    <span class="block text-xs text-muted-foreground">{channel.connector}</span>
                  </span>
                </span>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(channel.status)}>{statusLabel(channel.status)}</Badge>
                {#if channel.lastError}
                  <div class="mt-1 max-w-xs text-xs text-destructive">{channel.lastError}</div>
                {/if}
              </TableCell>
              <TableCell><Badge variant="secondary">{channel.mode}</Badge></TableCell>
              <TableCell class="text-right text-sm">{channel.live} / {channel.total}</TableCell>
              <TableCell class="text-right text-xs whitespace-nowrap text-muted-foreground">
                {timeAgo(channel.lastCheckedAt)}
              </TableCell>
              <TableCell class="pr-6 text-right whitespace-nowrap">
                <form
                  method="POST"
                  action="?/test"
                  class="inline"
                  use:enhance={() => {
                    testingId = channel.id;
                    return async ({ result, update }) => {
                      // reset:false keeps the rest of the page steady while
                      // the load function refreshes this row's status badge.
                      await update({ reset: false });
                      testingId = null;
                      if (result.type === "success") {
                        flash(channel.id, (result.data as { status?: string })?.status === "HEALTHY");
                      }
                    };
                  }}
                >
                  <input type="hidden" name="id" value={channel.id} />
                  <!--
                    Fixed width so the spinner state does not widen the button
                    and shove the row's other controls sideways mid-click.
                  -->
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    class="w-[4.5rem]"
                    disabled={testingId === channel.id}
                  >
                    {#if testingId === channel.id}
                      <LoaderCircle class="size-3.5 animate-spin" />
                    {:else}
                      Test
                    {/if}
                  </Button>
                </form>
                <span class="ml-1.5 inline-block align-middle">
                  <ConfirmButton
                    action="?/remove"
                    title="Remove {channel.name}?"
                    description="This disconnects the channel from your store."
                    consequence="Listings already published on {channel.name} stay live there — OpenCommerce simply stops syncing them, and its stored credentials are deleted."
                    confirmLabel="Remove channel"
                    fields={{ id: channel.id }}
                  />
                </span>
              </TableCell>
            </TableRow>
          {/each}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
{/if}

<h2 class="mb-1 text-sm font-semibold">Available connectors</h2>

{#each data.groups as group (group.label)}
  <p class="mb-2 mt-5 board-label text-[0.62rem] text-muted-foreground">
    {group.label}
  </p>
  <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
    {#each group.connectors as connector (connector.name)}
      <!--
        A connected card and a connectable one must differ in KIND, not just
        hue: "Connect" is an action and gets a button affordance, "Connected"
        is a state and gets a check. Rendering both as a Badge made an action
        look like a status.
      -->
      <button
        type="button"
        onclick={() => pick(connector)}
        class="group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors
               {connector.already
                 ? 'border-success/30 bg-success/5 hover:border-success/60'
                 : 'bg-card hover:border-foreground/20'}"
      >
        <!--
          In-development marks are dimmed, matching how the landing page greys
          them. The connector still works in mock mode and is still connectable,
          so it is not disabled — but presenting it identically to one that has
          been run against the live API is the kind of thing a seller only
          discovers after wiring up credentials.
        -->
        <span class="shrink-0 {connector.ready ? '' : 'opacity-45 saturate-50'}">
          {@html connector.mark}
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{connector.displayName}</span>
            {#if !connector.ready}
              <span
                class="board-label shrink-0 text-[0.5rem] text-muted-foreground"
                title="Built and mock-tested. Its API has not been run against a live account yet."
              >
                in dev
              </span>
            {/if}
          </span>
          <span class="block truncate text-xs text-muted-foreground">
            {connector.regions.slice(0, 3).join(", ")}
          </span>
        </span>
        {#if connector.already}
          <span class="flex shrink-0 items-center gap-1.5 text-xs font-medium text-success">
            <Check class="size-4" />
            <span class="group-hover:hidden">Connected</span>
            <span class="hidden group-hover:inline">Add another</span>
          </span>
        {:else}
          <!--
            Only a ready connector gets the filled button. The gold fill is the
            page's strongest "do this next" signal, and spending it on a
            connector whose API has never been reached sends people at the one
            thing that cannot finish the job. In-development ones stay
            connectable — mock mode is the point of them — but they ask rather
            than beckon.
          -->
          <span
            class="{buttonVariants({
              variant: connector.ready ? 'default' : 'outline',
              size: 'sm',
            })} pointer-events-none shrink-0 {connector.ready ? '' : 'text-muted-foreground'}"
          >
            Connect
            <ArrowRight class="size-3.5" />
          </span>
        {/if}
      </button>
    {/each}
  </div>
{/each}

<Dialog.Root bind:open>
  {#if selected}
    <Dialog.Content>
      <Dialog.Header>
        <div class="flex items-center gap-3">
          {@html selected.mark}
          <div>
            <Dialog.Title>{selected.already ? `Add another ${selected.displayName} account` : `Connect ${selected.displayName}`}</Dialog.Title>
            <Dialog.Description>
              {selected.regions.join(", ")} · {selected.authType} · {selected.rps}/s
            </Dialog.Description>
          </div>
        </div>
      </Dialog.Header>

      {#if selected.oauth}
        <!--
          The whole point of the handshake: a seller who clicks this never sees
          a token. The form below stays for anyone who already has one, or who
          is connecting a second account, but it is no longer the only way in.
        -->
        <div class="mb-5 rounded-lg border border-primary/30 bg-secondary p-4">
          <a
            href="/auth/{selected.name}"
            class="{buttonVariants({ size: 'sm' })} w-full"
            data-sveltekit-reload
          >
            Connect with {selected.displayName}
            <ArrowRight class="size-3.5" />
          </a>
          <p class="mt-2.5 text-xs text-muted-foreground">
            Opens {selected.displayName} to approve access. Nothing is stored until
            you come back, and no password is ever seen by this app.
          </p>
        </div>

        <div class="mb-5 flex items-center gap-3">
          <span class="h-px flex-1 bg-border"></span>
          <span class="text-[11px] uppercase tracking-wider text-muted-foreground">
            or paste credentials
          </span>
          <span class="h-px flex-1 bg-border"></span>
        </div>
      {/if}

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
        <input type="hidden" name="connector" value={selected.name} />
        <Field
          label="Channel name"
          name="name"
          required
          value={`${selected.displayName} — ${data.storeName}`}
        />

        <div class="grid gap-2 sm:grid-cols-2">
          <label
            class="flex cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors
                   {mode === 'mock' ? 'border-primary bg-secondary' : 'hover:border-foreground/20'}"
          >
            <input type="radio" name="mode" value="mock" bind:group={mode} class="mt-0.5 shrink-0" />
            <span class="min-w-0">
              <span class="block text-sm font-medium">Mock</span>
              <span class="block text-xs text-muted-foreground">
                Simulate {selected.displayName}. No account needed — the full publish pipeline still runs.
              </span>
            </span>
          </label>
          <label
            class="flex cursor-pointer gap-2.5 rounded-lg border p-3 transition-colors
                   {mode === 'live' ? 'border-primary bg-secondary' : 'hover:border-foreground/20'}"
          >
            <input type="radio" name="mode" value="live" bind:group={mode} class="mt-0.5 shrink-0" />
            <span class="min-w-0">
              <span class="block text-sm font-medium">Live</span>
              <span class="block text-xs text-muted-foreground">
                Call the real {selected.displayName} API with your seller credentials.
              </span>
            </span>
          </label>
        </div>

        <!-- Mock mode needs no credentials, so it is not asked for any. -->
        {#if mode === "live"}
          <div class="space-y-4 rounded-lg border bg-muted/40 p-4">
            {#if selected.credentialsNote}
              <p class="text-xs leading-relaxed text-muted-foreground">
                {selected.credentialsNote}
                <a
                  href={selected.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1"
                >
                  Seller portal <ExternalLink class="size-3" />
                </a>
              </p>
            {:else}
              <p class="text-xs text-muted-foreground">
                Create these in the {selected.displayName} seller portal —
                <a
                  href={selected.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1"
                >
                  API docs <ExternalLink class="size-3" />
                </a>
              </p>
            {/if}
            {#each selected.fields as f (f.key)}
              <Field
                label={f.label}
                name={`cred_${f.key}`}
                type={f.secret ? "password" : "text"}
                autocomplete="off"
                help={f.help}
                required
              />
            {/each}
            <Field
              label="Extra config (JSON)"
              name="config"
              textarea
              rows={2}
              value={"{}"}
              help={'e.g. {"shop_id":"12345","priceRule":{"type":"percent","value":5}}'}
            />
          </div>
        {/if}

        <Dialog.Footer>
          <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
          <Button type="submit">{selected.already ? "Add account" : `Connect ${selected.displayName}`}</Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  {/if}
</Dialog.Root>
