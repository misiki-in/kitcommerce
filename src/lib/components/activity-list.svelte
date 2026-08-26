<script lang="ts">
  import { enhance } from "$app/forms";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import Pencil from "@lucide/svelte/icons/pencil";
  import ShoppingBag from "@lucide/svelte/icons/shopping-bag";
  import { statusLabel, statusVariant, timeAgo } from "$lib/format";

  /**
   * One renderer for the activity feed, used by both the /dash/activity page and
   * the desktop drawer. Two copies of this list would drift the moment either
   * gained a field.
   */
  export type Entry = {
    kind: "sync" | "change" | "order";
    id: string;
    at: number;
    status: string;
    title: string;
    detail: string;
    error: string;
    href: string;
    meta: string;
    mark: string;
    retryable: boolean;
  };

  let {
    entries,
    compact = false,
    retryAction = "/dash/activity?/retry",
    onnavigate,
  }: {
    entries: Entry[];
    /** Tighter padding for the drawer's narrower column. */
    compact?: boolean;
    retryAction?: string;
    onnavigate?: () => void;
  } = $props();
</script>

<ul class="divide-y">
  {#each entries as entry (entry.kind + entry.id)}
    <li class="flex items-start gap-3 {compact ? 'px-4 py-2.5' : 'px-5 py-3'}">
      <span class="mt-0.5 shrink-0">
        {#if entry.mark}
          {@html entry.mark}
        {:else if entry.kind === "change"}
          <span class="grid size-6.5 place-items-center rounded-md bg-secondary text-secondary-foreground">
            <Pencil class="size-3.5" />
          </span>
        {:else if entry.kind === "order"}
          <span class="grid size-6.5 place-items-center rounded-md bg-success/10 text-success">
            <ShoppingBag class="size-3.5" />
          </span>
        {:else}
          <span class="grid size-6.5 place-items-center rounded-md bg-secondary text-muted-foreground">
            <ArrowLeftRight class="size-3.5" />
          </span>
        {/if}
      </span>

      {#if compact}
        <!--
          In a 320px rail the title, a badge and a timestamp cannot share one
          row without wrapping. So: title alone on line one, truncated; status,
          detail and time together on line two. Nothing wraps, nothing shifts.
        -->
        <span class="min-w-0 flex-1">
          <span class="flex items-baseline gap-2">
            {#if entry.href}
              <a href={entry.href} onclick={onnavigate} class="min-w-0 flex-1 truncate text-[13px] font-medium">
                {entry.title}
              </a>
            {:else}
              <span class="min-w-0 flex-1 truncate text-[13px] font-medium">{entry.title}</span>
            {/if}
            <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">{timeAgo(entry.at)}</span>
          </span>

          <span class="mt-0.5 flex items-center gap-1.5">
            {#if entry.status}
              <Badge variant={statusVariant(entry.status)} class="px-1.5 py-0 text-[10px]">
                {statusLabel(entry.status)}
              </Badge>
            {/if}
            <span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {entry.detail}{entry.meta ? ` · ${entry.meta}` : ""}
            </span>
            {#if entry.retryable}
              <form method="POST" action={retryAction} use:enhance class="shrink-0">
                <input type="hidden" name="id" value={entry.id} />
                <Button type="submit" variant="outline" size="sm" class="h-6 px-2 text-[11px]">Retry</Button>
              </form>
            {/if}
          </span>

          {#if entry.error}
            <span class="mt-0.5 block truncate text-[11px] text-destructive">{entry.error}</span>
          {/if}
        </span>
      {:else}
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            {#if entry.href}
              <a href={entry.href} onclick={onnavigate} class="text-sm font-medium">{entry.title}</a>
            {:else}
              <span class="text-sm font-medium">{entry.title}</span>
            {/if}
            {#if entry.status}
              <Badge variant={statusVariant(entry.status)}>{statusLabel(entry.status)}</Badge>
            {/if}
          </div>
          <div class="truncate text-xs text-muted-foreground">
            {entry.detail}{entry.meta ? ` · ${entry.meta}` : ""}
          </div>
          {#if entry.error}
            <div class="mt-0.5 text-xs text-destructive">{entry.error.slice(0, 160)}</div>
          {/if}
        </div>

        <span class="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{timeAgo(entry.at)}</span>

        {#if entry.retryable}
          <form method="POST" action={retryAction} use:enhance class="shrink-0">
            <input type="hidden" name="id" value={entry.id} />
            <Button type="submit" variant="outline" size="sm">Retry</Button>
          </form>
        {/if}
      {/if}
    </li>
  {/each}
</ul>
