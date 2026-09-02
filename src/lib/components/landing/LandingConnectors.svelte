<script lang="ts">
  import { ROADMAP_COUNT } from "$lib/roadmap";

  let {
    counts,
    builtGroups,
    wantedGroups,
    channelQuery = $bindable(""),
    builtHits,
    wantedHits,
    groupNotes = {},
  }: {
    counts: { ready: number; channels: number };
    builtGroups: Array<{ label: string; channels: Array<{ name: string; displayName: string; ready: boolean; mark: string }> }>;
    wantedGroups: Array<{ label: string; channels: string[] }>;
    channelQuery: string;
    builtHits: number;
    wantedHits: number;
    groupNotes?: Record<string, string>;
  } = $props();
</script>

<section id="connectors" class="scroll-mt-4 border-t border-white/10 bg-peacock">
  <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
    <div class="max-w-2xl">
      <p class="board-label mb-4 text-[0.66rem] text-gold">Connectors</p>
      <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
        {counts.ready} ready to use.
        {counts.channels - counts.ready} still in development.
      </h2>
      <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
        Only {counts.ready} of these marketplaces publish an API anyone can
        register for, and those are the ones you can point a real catalogue at
        today. The other {counts.channels - counts.ready} are written —
        each declares its fields and moves through the same
        pipeline — but their APIs are partner-gated, so none has been proven
        against a live account. They are greyed out below, and they stay greyed
        out until that changes.
      </p>
    </div>

    <p class="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.78rem] text-chalk/45">
      <span class="inline-flex items-center gap-1.5">
        <span class="inline-block size-1.5 rounded-full bg-verdigris"></span>
        ready to use — checked against the live API
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="inline-block size-1.5 rounded-full bg-chalk/25"></span>
        in development — schema built, API partner-gated
      </span>
    </p>

    <div class="mt-8 max-w-md">
      <label class="sr-only" for="channel-search">Search channels</label>
      <input
        id="channel-search"
        type="search"
        bind:value={channelQuery}
        autocomplete="off"
        placeholder="Search {counts.channels} built, {ROADMAP_COUNT} wanted…"
        class="machine w-full rounded-lg border border-white/12 bg-white/[0.04] px-3.5 py-2 text-[0.85rem]
               text-chalk transition-colors placeholder:text-chalk/30 focus:border-gold/40
               focus:outline-none focus:ring-2 focus:ring-gold/20"
      />
      {#if channelQuery.trim()}
        <p class="machine mt-2 text-[0.72rem] text-chalk/35">
          {builtHits} built · {wantedHits} wanted
        </p>
      {/if}
    </div>

    {#if channelQuery.trim() && builtHits === 0 && wantedHits === 0}
      <p class="mt-8 max-w-2xl text-[0.88rem] leading-relaxed text-chalk/50">
        Nothing matches <span class="machine text-chalk/80">{channelQuery}</span>. That is not a
        no — it is a marketplace nobody has asked for yet. Open an issue and it
        lands on the wanted-list.
      </p>
    {/if}

    <div class="mt-9 space-y-8">
      {#each builtGroups as group (group.label)}
        <div>
          <div class="mb-3 flex items-baseline gap-3">
            <h3 class="board-label shrink-0 text-[0.62rem] text-gold">{group.label}</h3>
            <span class="h-px min-w-0 flex-1 bg-white/10"></span>
            <span class="machine shrink-0 text-[0.7rem] text-chalk/30">
              {group.channels.length}
            </span>
          </div>

          {#if groupNotes[group.label]}
            <p class="mb-3 max-w-2xl text-[0.78rem] leading-relaxed text-chalk/45">
              {groupNotes[group.label]}
            </p>
          {/if}

          <ul class="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {#each group.channels as c (c.name)}
              <li
                class="flex items-center gap-2.5 rounded-lg border px-3 py-2
                       {c.ready ? 'border-verdigris/30 bg-verdigris/8' : 'border-white/10'}"
              >
                <span class="shrink-0 leading-none {c.ready ? '' : 'opacity-40 grayscale'}">
                  {@html c.mark}
                </span>
                <span
                  class="min-w-0 flex-1 truncate text-[0.85rem] {c.ready
                    ? 'text-chalk/85'
                    : 'text-chalk/40'}"
                >
                  {c.displayName}
                </span>
                {#if c.ready}
                  <span class="inline-block size-1.5 shrink-0 rounded-full bg-verdigris"></span>
                  <span class="board-label shrink-0 text-[0.55rem] text-verdigris/80">ready</span>
                {:else}
                  <span class="board-label shrink-0 text-[0.55rem] text-chalk/25">in dev</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>

    <p class="mt-8 max-w-2xl text-[0.78rem] leading-relaxed text-chalk/40">
      Correcting a path or a field name once you have partner credentials is a one-file change.
    </p>

    {#if wantedGroups.length}
      <div class="mt-12 border-t border-white/10 pt-10">
        <div class="max-w-2xl">
          <h3 class="board text-[1.15rem] text-chalk">Wanted, not built</h3>
          <p class="mt-3 text-[0.9rem] leading-relaxed text-chalk/60">
            {ROADMAP_COUNT} channels with no connector behind them. Nothing here
            is integrated and none of it can be connected — it is a list of what
            has been asked for, published so you can check before assuming
            rather than after. A connector is one file and one line in the
            registry; the guide is in
            <span class="machine text-chalk/75">docs/connector-development.md</span>.
          </p>
        </div>

        <div class="mt-6 space-y-5">
          {#each wantedGroups as group (group.label)}
            <div>
              <h4 class="board-label mb-2 text-[0.58rem] text-chalk/35">{group.label}</h4>
              <ul class="flex flex-wrap gap-1.5">
                {#each group.channels as name (name)}
                  <li
                    class="rounded-md border border-white/[0.08] px-2.5 py-1 text-[0.78rem] text-chalk/40"
                  >
                    {name}
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</section>
