<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Check from "@lucide/svelte/icons/check";

  let {
    groups,
    onPick,
  }: {
    groups: any[];
    onPick: (connector: any) => void;
  } = $props();
</script>

<h2 class="mb-1 text-sm font-semibold">Available connectors</h2>

{#each groups as group (group.label)}
  <p class="mb-2 mt-5 board-label text-[0.62rem] text-muted-foreground">
    {group.label}
  </p>
  <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
    {#each group.connectors as connector (connector.name)}
      <button
        type="button"
        onclick={() => onPick(connector)}
        class="group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors
               {connector.already
                 ? 'border-success/30 bg-success/5 hover:border-success/60'
                 : 'bg-card hover:border-foreground/20'}"
      >
        <span class="shrink-0 {connector.ready ? '' : 'opacity-45 saturate-50'}">
          {@html connector.mark}
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="truncate text-sm font-medium">{connector.displayName}</span>
            {#if !connector.ready}
              <span
                class="board-label shrink-0 text-[0.5rem] text-muted-foreground"
                title="In development — credentials required, but this API has not been run against a live account yet."
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
