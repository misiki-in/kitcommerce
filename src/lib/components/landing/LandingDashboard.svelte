<script lang="ts">
  let { channelsCount = 10, portsCount = 5 }: { channelsCount?: number; portsCount?: number } = $props();

  const shots = [
    {
      src: "/shots/overview-dark.jpg",
      w: 1510,
      h: 812,
      title: "Overview",
      alt: "The OpenCommerce overview screen: catalogue, live listings, order and out-of-stock figures, a needs-attention list, and a card per connected channel showing how much of the catalogue is live.",
      cap: "What is broken first, then the numbers, then the channels, then the day's trade.",
    },
    {
      src: "/shots/channels-dark.jpg",
      w: 1510,
      h: 812,
      title: "Channels",
      alt: "The channels screen: a table of connected marketplace accounts with health, mode and listing counts, above a grid of available connectors grouped by market.",
      cap: "Every connector, grouped by market. Each one tests its credentials without leaving the page.",
    },
  ];
</script>

<!-- ── start small, grow ────────────────────────────────────────────── -->
<section class="border-t border-white/10 bg-peacock-lift">
  <div class="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-16">
    <h2 class="board max-w-3xl text-[clamp(1.5rem,3.2vw,2.1rem)] text-chalk">
      Start in one command. Grow without a rewrite.
    </h2>

    <div class="mt-9 grid gap-8 sm:grid-cols-2 sm:gap-12 lg:gap-16">
      <div class="min-w-0">
        <p class="board-label mb-3 text-[0.6rem] text-gold">Day one</p>
        <p class="machine text-[0.95rem] font-semibold text-chalk">bun dev</p>
        <p class="mt-2.5 text-[0.86rem] leading-relaxed text-chalk/60">
          No database to install, no broker, no API keys, no config file.
          Bun's built-in SQLite is both the database and the job queue, and
          the encryption key is generated on first boot.
        </p>
      </div>

      <div class="min-w-0 border-t border-white/12 pt-8 sm:border-l sm:border-t-0 sm:pl-12 sm:pt-0 lg:pl-16">
        <p class="board-label mb-3 text-[0.6rem] text-gold">When you outgrow it</p>
        <p class="machine text-[0.95rem] font-semibold text-chalk">
          {channelsCount} connectors · {portsCount} swappable ports
        </p>
        <p class="mt-2.5 text-[0.86rem] leading-relaxed text-chalk/60">
          A new marketplace is one file and one line in the registry. Postgres,
          Redis, Kafka, S3 or Vault is a driver swap. Neither is a migration,
          and neither touches the core — which is why the ceiling here is the
          infrastructure you choose, not the thing you started on.
        </p>
      </div>
    </div>
  </div>
</section>

<!-- ── the dashboard ────────────────────────────────────────────────── -->
<section id="dashboard" class="scroll-mt-4 border-t border-white/10 bg-peacock">
  <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
    <div class="max-w-2xl">
      <p class="board-label mb-4 text-[0.66rem] text-gold">The dashboard</p>
      <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
        One client of the API, with no privileges of its own.
      </h2>
      <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
        Everything below happens over the same REST API you can call yourself.
        Rendered from <span class="machine">bun seed</span> demo data on the running app.
      </p>
    </div>

    <div class="mt-10 space-y-8">
      {#each shots as shot (shot.src)}
        <figure class="min-w-0">
          <div class="overflow-hidden rounded-xl border border-white/12 bg-white/[0.04] shadow-2xl shadow-black/40">
            <div class="flex items-center gap-2 border-b border-white/10 px-3.5 py-2.5">
              <span class="size-2 rounded-full bg-rust/70"></span>
              <span class="size-2 rounded-full bg-gold/70"></span>
              <span class="size-2 rounded-full bg-verdigris/70"></span>
              <span class="board-label ml-2 text-[0.58rem] text-chalk/35">{shot.title}</span>
            </div>
            <img
              src={shot.src}
              alt={shot.alt}
              width={shot.w}
              height={shot.h}
              loading="lazy"
              decoding="async"
              class="block h-auto w-full"
            />
          </div>
          <figcaption class="mt-3 text-[0.8rem] leading-relaxed text-chalk/45">
            {shot.cap}
          </figcaption>
        </figure>
      {/each}
    </div>
  </div>
</section>
