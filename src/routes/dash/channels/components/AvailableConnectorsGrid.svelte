<script lang="ts">
  import { buttonVariants } from "$lib/components/ui/button";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Check from "@lucide/svelte/icons/check";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";

  let {
    groups,
    onPick,
  }: {
    groups: any[];
    onPick: (connector: any) => void;
  } = $props();

  let devAccordionOpen = $state(false);

  // Split into active (ready to connect) groups and in-development groups
  const readyGroups = $derived.by(() => {
    return groups
      .map((g) => ({
        label: g.label,
        connectors: g.connectors.filter((c: any) => c.ready),
      }))
      .filter((g) => g.connectors.length > 0);
  });

  const devGroups = $derived.by(() => {
    return groups
      .map((g) => ({
        label: g.label,
        connectors: g.connectors.filter((c: any) => !c.ready),
      }))
      .filter((g) => g.connectors.length > 0);
  });

  const totalDevCount = $derived.by(() => {
    return devGroups.reduce((acc, g) => acc + g.connectors.length, 0);
  });
</script>

<div class="space-y-6">
  <div>
    <h2 class="text-sm font-semibold">Available connectors</h2>
    <p class="text-xs text-muted-foreground">Production-ready channels with automated listing, inventory sync & OAuth</p>
  </div>

  {#each readyGroups as group (group.label)}
    <div>
      <p class="mb-2.5 board-label text-[0.62rem] text-muted-foreground">
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
            <span class="shrink-0">
              {@html connector.mark}
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{connector.displayName}</span>
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
                  variant: 'default',
                  size: 'sm',
                })} pointer-events-none shrink-0"
              >
                Connect
                <ArrowRight class="size-3.5" />
              </span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/each}

  <!-- In Development Accordion (Default Hidden) -->
  {#if totalDevCount > 0}
    <div class="mt-8 rounded-xl border bg-card/50 transition-colors">
      <button
        type="button"
        onclick={() => (devAccordionOpen = !devAccordionOpen)}
        class="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-accent/40 rounded-xl"
        aria-expanded={devAccordionOpen}
      >
        <div class="flex items-center gap-2.5">
          <div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">Upcoming & In Development</span>
              <span class="rounded bg-muted px-1.5 py-0.5 text-[0.62rem] font-medium text-muted-foreground">
                {totalDevCount}
              </span>
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">
              Marketplace connectors currently under active integration
            </p>
          </div>
        </div>
        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{devAccordionOpen ? "Hide" : "Show all"}</span>
          <ChevronDown class="size-4 transition-transform duration-200 {devAccordionOpen ? 'rotate-180' : ''}" />
        </div>
      </button>

      {#if devAccordionOpen}
        <div class="border-t p-4 pt-3 space-y-5">
          {#each devGroups as group (group.label)}
            <div>
              <p class="mb-2 board-label text-[0.62rem] text-muted-foreground">
                {group.label}
              </p>
              <div class="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {#each group.connectors as connector (connector.name)}
                  <button
                    type="button"
                    onclick={() => onPick(connector)}
                    class="group flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:border-foreground/20"
                  >
                    <span class="shrink-0 opacity-50 saturate-50 group-hover:opacity-80 transition-opacity">
                      {@html connector.mark}
                    </span>
                    <span class="min-w-0 flex-1">
                      <span class="flex items-center gap-2">
                        <span class="truncate text-sm font-medium">{connector.displayName}</span>
                        <span
                          class="board-label shrink-0 text-[0.5rem] text-muted-foreground"
                          title="In development — credentials required, but this API has not been run against a live account yet."
                        >
                          in dev
                        </span>
                      </span>
                    </span>
                    <span
                      class="{buttonVariants({
                        variant: 'outline',
                        size: 'sm',
                      })} pointer-events-none shrink-0 text-muted-foreground"
                    >
                      Connect
                      <ArrowRight class="size-3.5" />
                    </span>
                  </button>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
