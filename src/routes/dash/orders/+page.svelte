<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import { money, statusLabel, statusVariant, timeAgo } from "$lib/format";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();
  let importing = $state(false);
</script>

<svelte:head><title>Orders · OpenCommerce</title></svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="board text-[1.6rem]">Orders</h1>
    <p class="text-sm text-muted-foreground">
      Imported from every connected marketplace — open one to manage it there
    </p>
  </div>
  <form
    method="POST"
    action="?/import"
    use:enhance={() => {
      importing = true;
      return async ({ update }) => {
        await update();
        importing = false;
      };
    }}
  >
    <Button type="submit" disabled={importing}>{importing ? "Importing…" : "Import now"}</Button>
  </form>
</div>

{#if form?.imported !== undefined}
  <Alert variant={form.imported > 0 ? "success" : "default"} class="mb-4">
    <AlertDescription>
      {form.imported > 0
        ? `Imported ${form.imported} new order${form.imported === 1 ? "" : "s"}.`
        : "No new orders — everything already imported."}
    </AlertDescription>
  </Alert>
{/if}

{#if data.orders.length === 0}
  <Card>
    <CardContent class="py-16 text-center">
      <p class="text-sm text-muted-foreground">
        No orders yet. Mock channels generate sample orders against your real SKUs.
      </p>
    </CardContent>
  </Card>
{:else}
  <Card>
    <CardContent class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-12 pl-4"></TableHead>
            <TableHead>Order</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Items</TableHead>
            <TableHead class="text-right">Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="text-right">Imported</TableHead>
            <TableHead class="w-10"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {#each data.orders as order (order.id)}
            <!--
              Only a live order exists on the marketplace. Linking a mock one
              out would land on a 404, so those rows stay inert and say why.
            -->
            {@const openable = !order.isMock && order.externalUrl}
            <TableRow class={openable ? "cursor-pointer" : ""}>
              <TableCell class="pl-4">{@html order.mark}</TableCell>
              <TableCell>
                {#if openable}
                  <a
                    href={order.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="font-mono text-xs"
                    title="Open on {order.marketplace}"
                  >{order.externalId}</a>
                {:else}
                  <span class="font-mono text-xs">{order.externalId}</span>
                {/if}
                <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {order.channelName}
                  {#if order.isMock}<Badge variant="secondary" class="px-1.5 py-0">mock</Badge>{/if}
                </div>
              </TableCell>
              <TableCell class="text-sm">{order.customer.name || "—"}</TableCell>
              <TableCell class="text-xs">
                {#each order.items as item (item.id)}
                  <div>{item.sku} ×{item.quantity}</div>
                {/each}
              </TableCell>
              <TableCell class="text-right font-medium whitespace-nowrap">
                {money(order.totalCents, order.currency)}
              </TableCell>
              <TableCell><Badge variant={statusVariant(order.status)}>{statusLabel(order.status)}</Badge></TableCell>
              <TableCell class="text-right text-xs whitespace-nowrap text-muted-foreground">
                {timeAgo(order.createdAt)}
              </TableCell>
              <TableCell class="pr-4 text-right">
                {#if openable}
                  <a
                    href={order.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex text-muted-foreground hover:text-foreground"
                    aria-label="Open on {order.marketplace}"
                    title="Open on {order.marketplace}"
                  >
                    <ExternalLink class="size-4" />
                  </a>
                {:else}
                  <span
                    class="inline-flex cursor-help text-muted-foreground/40"
                    title={order.isMock
                      ? "Mock order — it exists only here, not on the marketplace"
                      : `${order.marketplace} publishes no link for a single order`}
                  >
                    <ExternalLink class="size-4" />
                  </span>
                {/if}
              </TableCell>
            </TableRow>
          {/each}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
{/if}
