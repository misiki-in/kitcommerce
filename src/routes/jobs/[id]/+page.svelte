<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "$lib/components/ui/card";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Package from "@lucide/svelte/icons/package";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import CheckCircle2 from "@lucide/svelte/icons/check-circle-2";
  import Clock from "@lucide/svelte/icons/clock";
  import { statusLabel, statusVariant, timeAgo } from "$lib/format";
  import type { PageServerData } from "./$types";

  let { data }: { data: PageServerData } = $props();
  let retrying = $state(false);
</script>

<svelte:head>
  <title>Job {data.job.id} · OpenCommerce</title>
</svelte:head>

<div class="mx-auto max-w-4xl space-y-6 px-4 py-8">
  <!-- Back Button & Header -->
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <Button href="/dash/activity" variant="outline" size="sm" class="gap-1.5">
        <ArrowLeft class="size-4" /> Activity
      </Button>
      <div>
        <h1 class="text-xl font-bold font-mono tracking-tight flex items-center gap-2">
          {#if data.job.mark}{@html data.job.mark}{/if}
          <span>{data.job.id}</span>
        </h1>
        <p class="text-xs text-muted-foreground">
          {data.job.operation.replace(/_/g, " ")} · {timeAgo(data.job.createdAt)}
        </p>
      </div>
    </div>

    {#if data.job.status === "DEAD_LETTER" || data.job.status === "RETRYING" || data.job.status === "FAILED"}
      <form
        method="POST"
        action="?/retry"
        use:enhance={() => {
          retrying = true;
          return async ({ update }) => {
            retrying = false;
            await update();
          };
        }}
      >
        <Button type="submit" disabled={retrying} class="gap-1.5">
          <RefreshCw class="size-4 {retrying ? 'animate-spin' : ''}" />
          Retry Job
        </Button>
      </form>
    {/if}
  </div>

  <!-- Job Overview Card -->
  <Card>
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <div>
          <CardTitle class="text-base">Sync Execution Details</CardTitle>
          <CardDescription class="text-xs">
            Target Channel: <strong class="text-foreground">{data.job.channelName}</strong>
          </CardDescription>
        </div>
        <Badge variant={statusVariant(data.job.status)} class="text-xs uppercase px-2.5 py-0.5">
          {statusLabel(data.job.status)}
        </Badge>
      </div>
    </CardHeader>
    <CardContent class="space-y-4 text-xs">
      <div class="grid grid-cols-2 gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-4">
        <div>
          <span class="text-muted-foreground block text-[10px] uppercase">Operation</span>
          <span class="font-semibold font-mono text-sm">{data.job.operation}</span>
        </div>
        <div>
          <span class="text-muted-foreground block text-[10px] uppercase">Attempts</span>
          <span class="font-semibold text-sm">{data.job.attemptCount} / {data.job.maxAttempts}</span>
        </div>
        <div>
          <span class="text-muted-foreground block text-[10px] uppercase">Created</span>
          <span class="font-semibold text-sm">{timeAgo(data.job.createdAt)}</span>
        </div>
        <div>
          <span class="text-muted-foreground block text-[10px] uppercase">Last Updated</span>
          <span class="font-semibold text-sm">{timeAgo(data.job.updatedAt)}</span>
        </div>
      </div>

      {#if data.job.lastError}
        <div class="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-1.5">
          <div class="flex items-center gap-2 font-semibold text-destructive text-sm">
            <AlertTriangle class="size-4" />
            Last Error Encountered
          </div>
          <p class="font-mono text-xs text-destructive/90 break-words">{data.job.lastError}</p>
        </div>
      {/if}

      <!-- Target Entity / Product -->
      {#if data.product}
        <div class="rounded-xl border p-4 flex items-center justify-between bg-card">
          <div class="flex items-center gap-3">
            <div class="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Package class="size-5" />
            </div>
            <div>
              <span class="text-sm font-semibold block">{data.product.title}</span>
              <span class="text-xs text-muted-foreground font-mono">SKU: {data.product.sku} · ID: {data.product.id}</span>
            </div>
          </div>
          <Button href="/dash/products/{data.product.id}" variant="outline" size="sm">
            View Product
          </Button>
        </div>
      {/if}

      <!-- All Batched Products in Group -->
      {#if data.groupedJobs && data.groupedJobs.length > 1}
        <div class="space-y-2 pt-2 border-t">
          <span class="font-medium text-muted-foreground block text-[11px] uppercase tracking-wide">
            All Products Synced in this Batch ({data.groupedJobs.length})
          </span>
          <div class="divide-y rounded-xl border bg-card">
            {#each data.groupedJobs as gj}
              <div class="flex items-center justify-between p-3">
                <div class="flex items-center gap-3">
                  <div class="grid size-7 place-items-center rounded bg-primary/10 text-primary">
                    <Package class="size-4" />
                  </div>
                  <div>
                    <span class="text-xs font-semibold block">{gj.product?.title || gj.id}</span>
                    <span class="text-[11px] text-muted-foreground font-mono">
                      {gj.product?.sku ? `SKU: ${gj.product.sku} · ` : ""}Job: {gj.id}
                    </span>
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <Badge variant={statusVariant(gj.status)} class="text-[10px]">
                    {statusLabel(gj.status)}
                  </Badge>
                  {#if gj.product?.id}
                    <Button href="/dash/products/{gj.product.id}" variant="ghost" size="sm" class="h-7 text-xs px-2">
                      View
                    </Button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </CardContent>
  </Card>

  <!-- Execution Attempts History -->
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Attempt History</CardTitle>
      <CardDescription class="text-xs">
        Detailed breakdown of all synchronization tries made for this task.
      </CardDescription>
    </CardHeader>
    <CardContent class="p-0">
      {#if data.attempts.length === 0}
        <div class="py-8 text-center text-xs text-muted-foreground">
          No attempt records recorded yet. Job is queued for execution.
        </div>
      {:else}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-16">#</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Error Class</TableHead>
              <TableHead>Error Snippet</TableHead>
              <TableHead class="text-right">Duration</TableHead>
              <TableHead class="text-right">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {#each data.attempts as att}
              <TableRow>
                <TableCell class="font-mono font-medium">#{att.attempt}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(att.status)} class="text-[10px]">
                    {statusLabel(att.status)}
                  </Badge>
                </TableCell>
                <TableCell class="font-mono text-xs">{att.errorClass || "—"}</TableCell>
                <TableCell class="max-w-xs truncate font-mono text-xs text-muted-foreground" title={att.errorSnippet}>
                  {att.errorSnippet || "—"}
                </TableCell>
                <TableCell class="text-right font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {#if att.durationMs > 0}
                    {att.durationMs < 1000 ? `${att.durationMs}ms` : `${(att.durationMs / 1000).toFixed(1)}s`}
                  {:else}
                    &lt; 1ms
                  {/if}
                </TableCell>
                <TableCell class="text-right text-xs text-muted-foreground whitespace-nowrap">
                  {timeAgo(att.createdAt)}
                </TableCell>
              </TableRow>
            {/each}
          </TableBody>
        </Table>
      {/if}
    </CardContent>
  </Card>
</div>
