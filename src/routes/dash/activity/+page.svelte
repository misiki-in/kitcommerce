<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent } from "$lib/components/ui/card";
  import ActivityList from "$lib/components/activity-list.svelte";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeOff from "@lucide/svelte/icons/volume-off";
  import { sound } from "$lib/sound.svelte";
  import type { PageServerData } from "./$types";

  let { data }: { data: PageServerData } = $props();

  const FILTERS = [
    { key: "", label: "Everything" },
    { key: "sync", label: "Syncs" },
    { key: "failed", label: "Needs attention" },
    { key: "order", label: "Orders" },
    { key: "change", label: "Changes" },
  ] as const;

  const count = (key: string) => data.counts[(key || "all") as keyof typeof data.counts];
</script>

<svelte:head><title>Activity · OpenCommerce</title></svelte:head>

<div class="mb-6 flex items-start justify-between gap-4">
  <div class="min-w-0">
    <h1 class="board text-[1.6rem]">Activity</h1>
    <p class="text-sm text-muted-foreground">Every sync, order and change, newest first</p>
  </div>

  <!--
    Same preference the rail toggles, so the two always agree. It is here as
    well because this is where someone goes when the feed matters enough to
    read properly, which is exactly when they decide whether it should speak.
  -->
  <button
    type="button"
    onclick={() => sound.toggle()}
    class="flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium
           transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2
           focus-visible:ring-ring focus-visible:ring-offset-2
           {sound.enabled ? 'text-foreground' : 'text-muted-foreground'}"
    aria-pressed={sound.enabled}
    aria-label={sound.enabled ? "Turn activity sound off" : "Turn activity sound on"}
    title={sound.enabled ? "Sound on" : "Sound off"}
  >
    {#if sound.enabled}
      <Volume2 class="size-3.5" />
    {:else}
      <VolumeOff class="size-3.5" />
    {/if}
    <span class="hidden sm:inline">Sound {sound.enabled ? "on" : "off"}</span>
  </button>
</div>

<div class="mb-4 flex flex-wrap gap-2">
  {#each FILTERS as f (f.key)}
    <a
      href={f.key ? `/dash/activity?filter=${f.key}` : "/dash/activity"}
      class="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:no-underline
             {data.filter === f.key
               ? 'border-transparent bg-primary text-primary-foreground'
               : f.key === 'failed' && count(f.key) > 0
                 ? 'border-transparent bg-warning/10 text-warning'
                 : 'text-muted-foreground hover:bg-secondary'}"
    >
      {f.label} {count(f.key)}
    </a>
  {/each}
</div>

{#if data.entries.length === 0}
  <Card>
    <CardContent class="py-16 text-center">
      <p class="mb-4 text-sm text-muted-foreground">
        {data.filter ? "Nothing here under this filter." : "Nothing has happened yet."}
      </p>
      <Button href="/dash/products/new">Add a product</Button>
    </CardContent>
  </Card>
{:else}
  <Card>
    <CardContent class="p-0">
      <!-- Same renderer the desktop drawer uses, so the two cannot drift. -->
      <ActivityList entries={data.entries} retryAction="?/retry" />
    </CardContent>
  </Card>
{/if}
