<script lang="ts">
  import { page } from "$app/stores";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import ConnectedChannelsTable from "./components/ConnectedChannelsTable.svelte";
  import AvailableConnectorsGrid from "./components/AvailableConnectorsGrid.svelte";
  import ConnectChannelDialog from "./components/ConnectChannelDialog.svelte";
  import EditChannelDialog from "./components/EditChannelDialog.svelte";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();

  type Connector = PageServerData["groups"][number]["connectors"][number];
  type ConnectedChannel = PageServerData["connected"][number];

  let selectedConnector = $state<Connector | null>(null);
  let connectDialogOpen = $state(false);

  let editingChannel = $state<ConnectedChannel | null>(null);
  let editDialogOpen = $state(false);

  function pickConnector(connector: Connector) {
    selectedConnector = connector;
    connectDialogOpen = true;
  }

  function pickChannelToEdit(channel: ConnectedChannel) {
    editingChannel = channel;
    editDialogOpen = true;
  }
</script>

<svelte:head><title>Channels · OpenCommerce</title></svelte:head>

<div class="mb-6">
  <h1 class="board text-[1.6rem]">Channels</h1>
  <p class="text-sm text-muted-foreground">Each marketplace account you publish to</p>
</div>

{#if $page.url.searchParams.get("connected")}
  <Alert variant="success" class="mb-4">
    <AlertDescription>✨ {$page.url.searchParams.get("connected")} connected successfully via Etsy OAuth!</AlertDescription>
  </Alert>
{:else if $page.url.searchParams.get("oauth_error")}
  <Alert variant="destructive" class="mb-4">
    <AlertDescription>OAuth Error: {$page.url.searchParams.get("oauth_error")}</AlertDescription>
  </Alert>
{:else if form?.connected}
  <Alert variant="success" class="mb-4">
    <AlertDescription>{form.connected} connected successfully.</AlertDescription>
  </Alert>
{:else if form?.refreshed}
  <Alert variant="success" class="mb-4">
    <AlertDescription>
      ✨ Channel configuration and live shop details refreshed successfully {form.shopName ? `(Shop: ${form.shopName} · ID: ${form.shopId})` : ""}!
    </AlertDescription>
  </Alert>
{:else if form?.updated}
  <Alert variant="success" class="mb-4">
    <AlertDescription>{form.updated} configuration & credentials updated.</AlertDescription>
  </Alert>
{:else if form?.error}
  <Alert variant="destructive" class="mb-4">
    <AlertDescription>{form.error}</AlertDescription>
  </Alert>
{/if}

{#if data.connected.length}
  <ConnectedChannelsTable
    connected={data.connected}
    onEdit={pickChannelToEdit}
  />
{/if}

<AvailableConnectorsGrid
  groups={data.groups}
  onPick={pickConnector}
/>

<ConnectChannelDialog
  bind:open={connectDialogOpen}
  connector={selectedConnector}
  storeName={data.storeName}
/>

<EditChannelDialog
  bind:open={editDialogOpen}
  channel={editingChannel}
/>
