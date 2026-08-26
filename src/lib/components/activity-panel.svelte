<script lang="ts">
  import ActivityList, { type Entry } from "$lib/components/activity-list.svelte";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeOff from "@lucide/svelte/icons/volume-off";
  import { statusVariant } from "$lib/format";
  import { sound } from "$lib/sound.svelte";
  import { page } from "$app/state";

  /**
   * The activity feed body, with no chrome of its own.
   *
   * Shared by the persistent desktop sidebar and the tablet drawer so the two
   * cannot drift — the only difference between them is what wraps this.
   */
  let { autoRefreshOnNavigate = false }: { autoRefreshOnNavigate?: boolean } = $props();

  const FILTERS = [
    { key: "", label: "All" },
    { key: "sync", label: "Syncs" },
    { key: "failed", label: "Attention" },
    { key: "order", label: "Orders" },
  ] as const;

  let filter = $state("");
  let entries = $state<Entry[]>([]);
  let counts = $state({ all: 0, sync: 0, order: 0, change: 0, failed: 0 });
  let loading = $state(false);

  /**
   * Timestamp of the newest entry already accounted for. Kept out of $state:
   * nothing renders it, and it must not re-trigger the effect below.
   */
  let announced: number | null = null;

  /**
   * Chime for entries that arrived since the last look. The first load and a
   * filter change are both silent — neither is news, and a tool that beeps
   * every time you touch it gets muted within the hour.
   */
  function announce(next: Entry[], quiet: boolean) {
    const newest = next[0]?.at ?? 0;
    if (quiet || announced === null || newest <= announced) {
      announced = newest;
      return;
    }
    const fresh = next.filter((e) => e.at > announced!);
    announced = newest;
    sound.chime(fresh.some((e) => statusVariant(e.status) === "destructive") ? "attention" : "new");
  }

  async function load({ quiet = false }: { quiet?: boolean } = {}) {
    loading = true;
    try {
      const res = await fetch(`/api/activity${filter ? `?filter=${filter}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        entries = data.entries;
        counts = data.counts;
        announce(data.entries as Entry[], quiet);
      }
    } finally {
      loading = false;
    }
  }

  // The sidebar is always on screen, so it refreshes when you navigate —
  // that is the moment something is most likely to have changed.
  $effect(() => {
    if (autoRefreshOnNavigate) page.url.pathname;
    load();
  });

  const count = (key: string) => counts[(key || "all") as keyof typeof counts];
</script>

<div class="flex items-center gap-2 border-b px-4 py-3">
  <h2 class="text-sm font-semibold">Activity</h2>
  {#if loading}<LoaderCircle class="size-3.5 animate-spin text-muted-foreground" />{/if}

  <div class="ml-auto flex items-center">
    <!--
      Sound sits beside refresh because this is where you already come to ask
      the feed for news. aria-pressed rather than a checkbox: it is a toggle on
      a control, not a field with a value to submit.
    -->
    <button
      type="button"
      onclick={() => sound.toggle()}
      class="grid size-7 place-items-center rounded-md transition-colors hover:bg-secondary
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
             {sound.enabled ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
      aria-pressed={sound.enabled}
      aria-label={sound.enabled ? "Turn activity sound off" : "Turn activity sound on"}
      title={sound.enabled ? "Sound on" : "Sound off"}
    >
      {#if sound.enabled}
        <Volume2 class="size-3.5" />
      {:else}
        <VolumeOff class="size-3.5" />
      {/if}
    </button>

    <button
      type="button"
      onclick={() => load()}
      class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors
             hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2
             focus-visible:ring-ring"
      aria-label="Refresh activity"
      title="Refresh activity"
    >
      <RefreshCw class="size-3.5" />
    </button>
  </div>
</div>

<div class="flex flex-wrap gap-1 border-b px-4 py-2">
  {#each FILTERS as f (f.key)}
    <button
      type="button"
      onclick={() => {
        filter = f.key;
        load({ quiet: true });
      }}
      class="rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors
             {filter === f.key
               ? 'bg-primary text-primary-foreground'
               : f.key === 'failed' && count(f.key) > 0
                 ? 'bg-warning/10 text-warning'
                 : 'text-muted-foreground hover:bg-secondary'}"
    >
      {f.label} {count(f.key)}
    </button>
  {/each}
</div>

<!-- scroll-hidden: the rail still scrolls, the bar just is not drawn.
     A permanent scrollbar in a 320px column eats width and adds a hard
     vertical line beside one that is already there. -->
<div class="scroll-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain">
  {#if entries.length}
    <ActivityList {entries} compact retryAction="/dash/activity?/retry" />
  {:else if !loading}
    <p class="px-4 py-10 text-center text-xs text-muted-foreground">
      {filter ? "Nothing under this filter." : "Nothing yet."}
    </p>
  {/if}
</div>

<div class="border-t px-4 py-2">
  <a href="/dash/activity" class="text-xs">Open full activity →</a>
</div>
