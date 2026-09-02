<script lang="ts">
  import { fuzzyRank } from "$lib/fuzzy";
  import { ROADMAP } from "$lib/roadmap";
  import LandingHeader from "$lib/components/landing/LandingHeader.svelte";
  import LandingHero from "$lib/components/landing/LandingHero.svelte";
  import LandingDashboard from "$lib/components/landing/LandingDashboard.svelte";
  import LandingFeatures from "$lib/components/landing/LandingFeatures.svelte";
  import LandingConnectors from "$lib/components/landing/LandingConnectors.svelte";
  import LandingStack from "$lib/components/landing/LandingStack.svelte";
  import LandingFooter from "$lib/components/landing/LandingFooter.svelte";
  import type { PageServerData } from "./$types";

  let { data }: { data: PageServerData } = $props();

  const REPO = "https://github.com/misiki-in/kitcommerce";

  let copiedKey = $state<string | null>(null);
  let copyTimeout: ReturnType<typeof setTimeout> | undefined;

  function copy(key: string, text: string) {
    navigator.clipboard?.writeText(text);
    copiedKey = key;
    clearTimeout(copyTimeout);
    copyTimeout = setTimeout(() => {
      if (copiedKey === key) copiedKey = null;
    }, 1600);
  }

  let channelQuery = $state("");

  const builtRanked = $derived(
    fuzzyRank(
      channelQuery,
      data.channels.map((c) => ({ key: c.displayName, item: c })),
    ),
  );

  const builtHits = $derived(
    channelQuery.trim() ? builtRanked.filter((c) => c.score > 0).length : data.channels.length,
  );

  const builtGroups = $derived.by(() => {
    const q = channelQuery.trim();
    return (data.groups || [])
      .map((g: any) => {
        const names = Array.isArray(g.names) ? g.names : [];
        const channels = names
          .map((name: string) => (q ? builtRanked.find((r) => r.item.name === name) : null))
          .filter((r: any): r is NonNullable<typeof r> => (q ? (r?.score ?? 0) > 0 : false))
          .map((r: any) => r.item);
        const allChannels = names
          .map((name: string) => data.channels.find((c) => c.name === name)!)
          .filter(Boolean);
        return { label: g.label, channels: q ? channels : allChannels };
      })
      .filter((g: any) => g.channels.length > 0);
  });

  const wantedRanked = $derived(
    fuzzyRank(
      channelQuery,
      ROADMAP.flatMap((g) => g.channels.map((name) => ({ key: name, item: { group: g.label, name } }))),
    ),
  );

  const wantedHits = $derived(
    channelQuery.trim()
      ? wantedRanked.filter((r) => r.score > 0).length
      : ROADMAP.reduce((sum, g) => sum + g.channels.length, 0),
  );

  const wantedGroups = $derived.by(() => {
    const q = channelQuery.trim();
    if (!q) return ROADMAP;
    const matching = wantedRanked.filter((r) => r.score > 0);
    const byGroup = new Map<string, string[]>();
    for (const m of matching) {
      if (!byGroup.has(m.item.group)) byGroup.set(m.item.group, []);
      byGroup.get(m.item.group)!.push(m.item.name);
    }
    return Array.from(byGroup.entries()).map(([label, channels]) => ({ label, channels }));
  });

  const GROUP_NOTE: Record<string, string> = {
    Social:
      "Instagram and Facebook publish to the same Meta catalogue, so connecting both writes one product feed twice. Neither returns orders outside Meta's native checkout. TikTok Shop does not operate in India.",
  };

  const ICONS: Record<string, string[]> = {
    cpu: ["M4 4h16v16H4z", "M9 9h6v6H9z", "M9 1v3", "M15 1v3", "M9 20v3", "M15 20v3", "M1 9h3", "M1 15h3", "M20 9h3", "M20 15h3"],
    plug: ["M9 3.5V8", "M15 3.5V8", "M6.8 8h10.4v2.6a5.2 5.2 0 0 1-10.4 0z", "M12 15.8v4.7"],
    layout: ["M4 4h16v16H4z", "M4 9h16", "M9 9v11"],
    terminal: ["m4 6 6 6-6 6", "M12 18h8"],
    layers: ["m12 3.2 8.5 4.8-8.5 4.8L3.5 8z", "m3.5 12.6 8.5 4.8 8.5-4.8"],
    boxes: ["M4 7l8-4 8 4v10l-8 4-8-4V7z", "M4 7l8 4 8-4", "M12 11v10"],
    key: ["M8 15.6a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2z", "M12 11.5h8.6", "M18 11.5v3", "M15.2 11.5v2.2"],
    refresh: ["M20 12a8 8 0 1 1-2.4-5.7", "M20.2 4.2v4.6h-4.6"],
    activity: ["M22 12h-4l-3 9L9 3l-3 9H2"],
    lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
    ban: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "m4.93 4.93 14.14 14.14"],
    server: ["M4 4h16v6H4z", "M4 14h16v6H4z", "M8 7h.01", "M8 17h.01"],
    shield: ["M12 2s8 3.6 8 10c0 5.4-8 10-8 10s-8-4.6-8-10c0-6.4 8-10 8-10z"],
  };
</script>

<svelte:head>
  <title>OpenCommerce · free, open-source, self-hosted commerce sync</title>
  <meta
    name="description"
    content="Free, open-source, self-hosted commerce infrastructure. Publish one catalogue to {data.counts.channels} marketplaces and social channels with retries, idempotency and a full audit trail. MIT licensed, no paid tier, no telemetry — it runs on your own machine."
  />
</svelte:head>

{#snippet glyph(name: string, size: string)}
  <svg
    viewBox="0 0 24 24"
    class={size}
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#each ICONS[name] ?? [] as d (d)}
      <path {d} />
    {/each}
  </svg>
{/snippet}

{#snippet brandIcon(name: string)}
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true" class="shrink-0 opacity-70">
    {#if name === "github"}
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
    {:else if name === "discord"}
      <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    {:else if name === "telegram"}
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212-.07-.062-.174-.041-.249-.024-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635Z" />
    {:else if name === "x"}
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" />
    {/if}
  </svg>
{/snippet}

<div class="min-h-screen bg-peacock-deep text-chalk">
  <LandingHeader repo={REPO} />

  <LandingHero
    repo={REPO}
    sku={data.sku}
    channels={data.channels}
    onCopy={copy}
    {copiedKey}
  />

  <LandingDashboard
    channelsCount={data.counts.channels}
    portsCount={5}
  />

  <LandingFeatures
    ladder={data.ladder}
    {glyph}
  />

  <LandingConnectors
    counts={data.counts}
    {builtGroups}
    {wantedGroups}
    bind:channelQuery
    {builtHits}
    {wantedHits}
    groupNotes={GROUP_NOTE}
  />

  <LandingStack
    channels={data.channels}
    {glyph}
  />

  <LandingFooter
    repo={REPO}
    counts={data.counts}
    {brandIcon}
  />
</div>
