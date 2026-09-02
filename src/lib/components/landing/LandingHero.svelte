<script lang="ts">
  let {
    repo,
    sku,
    channels,
    platformsPlus = "6+",
    onCopy,
    copiedKey,
  }: {
    repo: string;
    sku: string;
    channels: Array<{
      name: string;
      displayName: string;
      ready: boolean;
      mark: string;
      remoteId: string;
    }>;
    platformsPlus?: string;
    onCopy: (key: string, text: string) => void;
    copiedKey: string | null;
  } = $props();

  const INSTALL = `git clone ${repo}\ncd opencommerce\nbun i\nbun seed\nbun dev`;

  const ROW_H = 34;
  const FAN_W = 56;
  const boardH = $derived(channels.length * ROW_H);
  const originY = $derived(boardH / 2);

  const curve = (i: number) => {
    const y = i * ROW_H + ROW_H / 2;
    return `M2 ${originY} C ${FAN_W * 0.55} ${originY}, ${FAN_W * 0.45} ${y}, ${FAN_W} ${y}`;
  };

  type State = { kind: "listed" | "queued" | "retrying" | "incomplete"; note?: string };
  const stateFor = (i: number): State => {
    if (i === 8) return { kind: "incomplete", note: "needs ingredients" };
    if (i === 9) return { kind: "retrying", note: "attempt 2 of 5" };
    if (i === 12) return { kind: "queued" };
    return { kind: "listed" };
  };

  const TONE: Record<State["kind"], string> = {
    listed: "text-verdigris",
    queued: "text-chalk/45",
    retrying: "text-gold",
    incomplete: "text-rust",
  };
</script>

<section class="mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:pb-24 lg:pt-16">
  <div class="min-w-0 self-center">
    <p class="board-label mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.7rem] text-gold">
      <span>Free</span>
      <span class="text-gold/35" aria-hidden="true">·</span>
      <span>Open source</span>
      <span class="text-gold/35" aria-hidden="true">·</span>
      <span>Runs on your machine</span>
    </p>

    <h1 class="board text-[clamp(2.4rem,6.2vw,4rem)] text-chalk">
      Publish <span class="text-gold">one</span> catalogue to
      <span class="text-gold">{platformsPlus}</span> ecommerce platforms.
    </h1>

    <p class="mt-6 max-w-lg text-[1.05rem] leading-relaxed text-chalk/70">
      Free and open-source commerce infrastructure for marketplaces and social
      selling. Retries, idempotency and a full audit trail — from a single
      command, on your own machine. No account, no vendor, nothing phoned
      home.
    </p>

    <div class="mt-8 max-w-md overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
      <div class="flex items-center justify-between gap-3 border-b border-white/10 px-3.5 py-2">
        <span class="board-label text-[0.62rem] text-chalk/40">Run it</span>
        <button
          type="button"
          onclick={() => onCopy("install", INSTALL)}
          class="machine rounded px-2 py-0.5 text-[0.7rem] text-chalk/55 transition-colors hover:bg-white/10 hover:text-chalk
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-peacock-deep"
        >
          {copiedKey === "install" ? "copied" : "copy"}
        </button>
      </div>
      <pre class="machine overflow-x-auto px-3.5 py-3 text-[0.82rem] leading-relaxed text-chalk/90"><span class="select-none text-gold">$ </span>git clone {repo}
<span class="select-none text-gold">$ </span>cd opencommerce
<span class="select-none text-gold">$ </span>bun i
<span class="select-none text-gold">$ </span>bun seed
<span class="select-none text-gold">$ </span>bun dev</pre>
    </div>

    <p class="machine mt-3 text-[0.75rem] text-chalk/40">
      demo@opencommerce.dev · demo1234
    </p>
  </div>

  <div class="min-w-0 self-center">
    <div class="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/10 px-4 py-3">
        <div class="min-w-0">
          <p class="board-label text-[0.62rem] text-chalk/40">Consignment</p>
          <p class="machine mt-1 truncate text-[0.9rem] font-semibold text-chalk">
            {sku}
          </p>
        </div>
        <p class="machine shrink-0 text-[0.7rem] text-chalk/40">live engine</p>
      </div>

      <div class="flex px-4 py-3">
        <svg
          class="fan shrink-0"
          width={FAN_W}
          height={boardH}
          viewBox="0 0 {FAN_W} {boardH}"
          fill="none"
          aria-hidden="true"
        >
          {#each channels as _, i (i)}
            <path
              d={curve(i)}
              pathLength="1"
              stroke="currentColor"
              class="text-verdigris/45"
              stroke-width="1"
              style="animation-delay: {i * 45}ms"
            />
          {/each}
          <circle cx="2" cy={originY} r="3" class="fill-gold" />
        </svg>

        <ul class="min-w-0 flex-1">
          {#each channels as channel, i (channel.name)}
            {@const s = stateFor(i)}
            <li
              class="row flex items-center gap-2.5"
              style="height: {ROW_H}px; animation-delay: {i * 45 + 120}ms"
            >
              <span class="shrink-0 leading-none {channel.ready ? '' : 'opacity-45 grayscale'}">
                {@html channel.mark}
              </span>

              <span
                class="min-w-0 flex-1 truncate text-[0.82rem] {channel.ready
                  ? 'text-chalk/90'
                  : 'text-chalk/45'}"
              >
                {channel.displayName}
              </span>

              <span class="machine hidden shrink-0 text-[0.7rem] text-chalk/35 sm:inline">
                {s.kind === "listed" ? channel.remoteId : (s.note ?? "—")}
              </span>

              <span class="board-label w-[4.6rem] shrink-0 text-right text-[0.58rem] {TONE[s.kind]}">
                {s.kind}
              </span>
            </li>
          {/each}
        </ul>
      </div>
    </div>

    <p class="mt-3 text-[0.78rem] leading-relaxed text-chalk/40">
      Engine output. Every connector implements the canonical sync interface to publish listings across channels.
    </p>
  </div>
</section>
