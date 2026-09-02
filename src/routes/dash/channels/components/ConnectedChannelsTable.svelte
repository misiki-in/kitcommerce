<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import ConfirmButton from "$lib/components/confirm-button.svelte";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import Settings from "@lucide/svelte/icons/settings";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import { statusLabel, statusVariant, timeAgo } from "$lib/format";

  let {
    connected,
    onEdit,
  }: {
    connected: any[];
    onEdit: (channel: any) => void;
  } = $props();

  let testingId = $state<string | null>(null);
  let refreshingId = $state<string | null>(null);
  let flashId = $state<string | null>(null);
  let flashOk = $state(true);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  function flash(id: string, ok: boolean) {
    clearTimeout(flashTimer);
    flashId = id;
    flashOk = ok;
    flashTimer = setTimeout(() => (flashId = null), 1800);
  }
</script>

<Card class="mb-6">
  <CardHeader><CardTitle class="text-base">Connected channels</CardTitle></CardHeader>
  <CardContent class="p-0">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead class="pl-6">Channel</TableHead>
          <TableHead>Status</TableHead>
          <TableHead class="text-right">Listings</TableHead>
          <TableHead class="text-right">Last check</TableHead>
          <TableHead class="pr-6 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {#each connected as channel (channel.id)}
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
                  <span class="block text-xs text-muted-foreground">{channel.displayName}</span>
                </span>
              </span>
            </TableCell>
            <TableCell>
              <Badge variant={statusVariant(channel.status)}>{statusLabel(channel.status)}</Badge>
              {#if channel.lastError}
                <div class="mt-1 max-w-xs text-xs text-destructive">{channel.lastError}</div>
              {/if}
            </TableCell>
            <TableCell class="text-right text-sm">{channel.live} / {channel.total}</TableCell>
            <TableCell class="text-right text-xs whitespace-nowrap text-muted-foreground">
              {timeAgo(channel.lastCheckedAt)}
            </TableCell>
            <TableCell class="pr-6 text-right whitespace-nowrap">
              <div class="inline-flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onclick={() => onEdit(channel)}
                  title="Edit channel & rotate credentials"
                >
                  <Settings class="size-3.5" />
                  Edit
                </Button>

                <!-- Refresh Configurations & Auto-Discover Shop -->
                <form
                  method="POST"
                  action="?/refreshSettings"
                  class="inline"
                  use:enhance={() => {
                    refreshingId = channel.id;
                    return async ({ result, update }) => {
                      await update({ reset: false });
                      refreshingId = null;
                      if (result.type === "success") {
                        flash(channel.id, true);
                      }
                    };
                  }}
                >
                  <input type="hidden" name="id" value={channel.id} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    class="gap-1.5"
                    disabled={refreshingId === channel.id || testingId === channel.id}
                    title="Auto-discover shop ID, shipping profiles & refresh token status"
                  >
                    <RefreshCw class="size-3.5 {refreshingId === channel.id ? 'animate-spin' : ''}" />
                    {refreshingId === channel.id ? "Syncing…" : "Refresh"}
                  </Button>
                </form>

                <form
                  method="POST"
                  action="?/test"
                  class="inline"
                  use:enhance={() => {
                    testingId = channel.id;
                    return async ({ result, update }) => {
                      await update({ reset: false });
                      testingId = null;
                      if (result.type === "success") {
                        flash(channel.id, (result.data as { status?: string })?.status === "HEALTHY");
                      }
                    };
                  }}
                >
                  <input type="hidden" name="id" value={channel.id} />
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    class="w-[4.2rem]"
                    disabled={testingId === channel.id || refreshingId === channel.id}
                  >
                    {#if testingId === channel.id}
                      <LoaderCircle class="size-3.5 animate-spin" />
                    {:else}
                      Test
                    {/if}
                  </Button>
                </form>

                <ConfirmButton
                  action="?/remove"
                  title="Remove {channel.name}?"
                  description="This disconnects the channel from your store."
                  consequence="Listings already published on {channel.name} stay live there — OpenCommerce simply stops syncing them, and its stored credentials are deleted."
                  confirmLabel="Remove channel"
                  fields={{ id: channel.id }}
                />
              </div>
            </TableCell>
          </TableRow>
        {/each}
      </TableBody>
    </Table>
  </CardContent>
</Card>
