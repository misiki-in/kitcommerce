<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    ladder = ["15s", "1m", "5m", "15m", "30m"],
    glyph,
  }: {
    ladder?: string[];
    glyph: Snippet<[string, string]>;
  } = $props();

  const PIPELINE = [
    {
      title: "Validate",
      body: "Every channel declares the fields it requires. A product missing one becomes a visible INCOMPLETE mapping here, instead of five failed jobs there.",
    },
    {
      title: "Plan",
      body: "One job per channel that can actually accept the product. The engine never calls an operation a connector says it does not support.",
    },
    {
      title: "Execute",
      body: "Each job carries an idempotency key. Retrying produces the same remote ID as the first attempt, so a retry is never a second listing.",
    },
    {
      title: "Record",
      body: "Every attempt, payload and error lands in the audit trail. Nothing about a sync is inferred after the fact.",
    },
  ];

  const REPO_PARTS = [
    { icon: "cpu", label: "Sync engine", note: "idempotency · retries · audit trail" },
    { icon: "plug", label: "All connectors", note: "India, quick-commerce, social, global" },
    { icon: "layout", label: "Dashboard", note: "SvelteKit · light & dark · Tailwind" },
    { icon: "terminal", label: "MCP server", note: "13 tools for Claude, Cursor, Claude Code" },
  ];

  const FEATURES = [
    {
      icon: "layers",
      title: "One canonical product",
      body: "Variants, images, GST slabs and tax IDs stored once, then mapped to each platform's schema at sync time. Adding a channel never changes your product data.",
    },
    {
      icon: "boxes",
      title: "Port-and-adapter core",
      body: "The engine runs against TypeScript interfaces. Swap SQLite for Postgres or the memory queue for Redis without touching sync logic.",
    },
    {
      icon: "key",
      title: "Idempotent by construction",
      body: "Every job carries a deterministic key: channel + action + entity + version. Retries never create duplicate listings or double-charge stock.",
    },
    {
      icon: "refresh",
      title: "Live connector sync",
      body: "Connectors call live platform APIs with classified error handling for rate limits, token expiry, and schema validation.",
    },
    {
      icon: "activity",
      title: "Full audit trail",
      body: "Every sync attempt, request payload, response status, and error classification is logged immutably in your local database.",
    },
    {
      icon: "lock",
      title: "AES-256-GCM credentials",
      body: "Marketplace API keys and tokens are sealed at rest with authenticated encryption. Cleartext credentials never touch disk or API responses.",
    },
  ];
</script>

<!-- ── pipeline ─────────────────────────────────────────────────────── -->
<section class="border-t border-white/10 bg-peacock">
  <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
    <h2 class="board max-w-2xl text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
      A product is entered once. The engine works out the rest.
    </h2>

    <ol class="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
      {#each PIPELINE as step, i (step.title)}
        <li class="border-t border-white/12 pt-4">
          <div class="mb-2.5 flex items-baseline gap-2.5">
            <span class="machine text-[0.72rem] text-gold">{i + 1}</span>
            <h3 class="board text-[1.05rem] text-chalk">{step.title}</h3>
          </div>
          <p class="text-[0.85rem] leading-relaxed text-chalk/60">{step.body}</p>
        </li>
      {/each}
    </ol>
  </div>
</section>

<!-- ── retry ladder ─────────────────────────────────────────────────── -->
<section class="border-t border-white/10">
  <div class="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16 lg:py-20">
    <div>
      <p class="board-label mb-4 text-[0.66rem] text-gold">The retry ladder</p>
      <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
        A failed job is not a lost job.
      </h2>
      <p class="mt-5 max-w-md text-[0.92rem] leading-relaxed text-chalk/65">
        Errors are classified before they are retried. A rate limit backs off
        and comes back; a malformed payload does not, because trying it four
        more times cannot help. Anything that exhausts the ladder is
        dead-lettered with its last error intact, and can be retried by hand
        once the cause is fixed.
      </p>
    </div>

    <div class="self-end">
      <ol class="flex items-end gap-1.5 sm:gap-2.5">
        {#each ladder as delay, i (delay)}
          <li class="flex min-w-0 flex-1 flex-col items-center gap-2">
            <span class="machine text-[0.68rem] text-chalk/55 sm:text-[0.78rem]">{delay}</span>
            <span
              class="w-full rounded-t-sm bg-gold/85"
              style="height: {14 + i * 17}px"
            ></span>
            <span class="machine text-[0.62rem] text-chalk/30">{i + 1}</span>
          </li>
        {/each}

        <li class="flex min-w-0 flex-1 flex-col items-center gap-2">
          <span class="machine text-[0.68rem] text-rust sm:text-[0.78rem]">dead</span>
          <span class="w-full rounded-t-sm bg-rust/60" style="height: {14 + 5 * 17}px"></span>
          <span class="machine text-[0.62rem] text-chalk/30">—</span>
        </li>
      </ol>
      <p class="mt-4 text-[0.78rem] text-chalk/40">
        Five attempts over roughly forty minutes, then the dead-letter queue.
      </p>
    </div>
  </div>
</section>

<!-- ── open source & features ───────────────────────────────────────── -->
<section id="features" class="scroll-mt-4 border-t border-white/10 bg-peacock">
  <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
    <div class="max-w-2xl">
      <p class="board-label mb-4 text-[0.66rem] text-gold">Open source</p>
      <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
        MIT licensed. There is no paid tier.
      </h2>
      <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
        Fork it, read it, change the parts that do not fit your catalogue.
      </p>
    </div>

    <div class="mt-10 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
      <div class="p-5 sm:p-7">
        <p class="board-label mb-5 text-[0.58rem] text-gold">What the repository contains</p>
        <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {#each REPO_PARTS as part (part.label)}
            <li class="rounded-lg border border-gold/25 bg-gold/[0.06] p-4">
              <div class="mb-2.5 flex items-center gap-2.5">
                <span class="shrink-0 text-gold">
                  {@render glyph(part.icon, "size-[1.15rem]")}
                </span>
                <span class="board text-[0.95rem] text-chalk">{part.label}</span>
              </div>
              <p class="machine text-[0.72rem] leading-snug text-chalk/45">{part.note}</p>
            </li>
          {/each}
        </ul>
      </div>

      <div
        class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/10 bg-rust/[0.06]
               px-5 py-4 sm:px-7"
      >
        <span class="shrink-0 text-rust">{@render glyph("ban", "size-[1.15rem]")}</span>
        <p class="board-label text-[0.58rem] text-chalk/40">Held back for a paid tier</p>
        <span class="machine ml-auto text-[0.85rem] text-rust">nothing</span>
      </div>
    </div>

    <ul class="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
      {#each FEATURES as f (f.title)}
        <li class="border-t border-white/12 pt-4">
          <div class="mb-2 flex items-center gap-2.5">
            <span class="shrink-0 text-gold/75">{@render glyph(f.icon, "size-[1.1rem]")}</span>
            <h3 class="board text-[1rem] text-chalk">{f.title}</h3>
          </div>
          <p class="text-[0.85rem] leading-relaxed text-chalk/60">{f.body}</p>
        </li>
      {/each}
    </ul>
  </div>
</section>
