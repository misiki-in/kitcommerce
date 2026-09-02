<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    channels,
    glyph,
  }: {
    channels: Array<{ name: string; mark: string }>;
    glyph: Snippet<[string, string]>;
  } = $props();

  const PORTS = [
    { port: "db", now: "SQLite (bun:sqlite)", later: "Postgres" },
    { port: "queue", now: "the database itself", later: "Redis Streams, BullMQ, NATS, SQS" },
    { port: "events", now: "transactional outbox", later: "Kafka, NATS, Redis" },
    { port: "search", now: "SQL LIKE", later: "Meilisearch, Typesense" },
    { port: "notify", now: "noop (log)", later: "Resend, SendGrid, SMTP" },
    { port: "secrets", now: "AES-256-GCM (node:crypto)", later: "HashiCorp Vault, AWS KMS" },
    { port: "blob", now: "local filesystem (data/blobs)", later: "S3, R2, GCS" },
  ];

  const PRIVACY = [
    {
      icon: "server",
      title: "No vendor cloud",
      body: "All data sits in the SQLite file on your disk. There is no OpenCommerce cloud account, telemetry or licence verification.",
    },
    {
      icon: "shield",
      title: "Direct API calls",
      body: "Listing requests go directly from your IP address to Amazon, Flipkart or Shopify. We never intermediate traffic.",
    },
    {
      icon: "key",
      title: "Zero cleartext keys",
      body: "Marketplace keys and tokens are sealed before hitting disk with local AES-256-GCM authenticated encryption.",
    },
  ];
</script>

<!-- ── privacy / self-hosted ────────────────────────────────────────── -->
<section id="privacy" class="scroll-mt-4 border-t border-white/10">
  <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
    <div class="max-w-2xl">
      <p class="board-label mb-4 text-[0.66rem] text-gold">Private by default</p>
      <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
        You are not giving your data to another business.
      </h2>
      <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
        This is not a service with a privacy policy. It is software you run,
        on your own PC or your own server. There is no account, no vendor
        backend and no middleman — the only parties to your catalogue are you
        and the marketplaces you deliberately publish to.
      </p>
    </div>

    <div class="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        <div class="flex-1 rounded-lg border border-gold/25 bg-gold/[0.06] p-4">
          <div class="mb-2.5 flex items-center gap-2.5 text-gold">
            {@render glyph("server", "size-[1.15rem] shrink-0")}
            <span class="board text-[0.95rem] text-chalk">Your machine</span>
          </div>
          <p class="text-[0.82rem] leading-relaxed text-chalk/60">
            The app, the SQLite file and the encryption key. All three are on
            disk where you put them.
          </p>
        </div>

        <div class="flex items-center justify-center gap-2 lg:w-28 lg:flex-col">
          <svg viewBox="0 0 48 24" class="w-12 rotate-90 text-gold/60 lg:rotate-0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M2 12h42" />
            <path d="m36 6 8 6-8 6" />
          </svg>
          <span class="board-label text-[0.58rem] text-chalk/40">direct</span>
        </div>

        <div class="flex-1 rounded-lg border border-white/12 p-4">
          <div class="mb-2.5 flex items-center gap-2.5">
            {@render glyph("shield", "size-[1.15rem] shrink-0 text-verdigris")}
            <span class="board text-[0.95rem] text-chalk">Marketplaces you chose</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            {#each channels.slice(0, 9) as c (c.name)}
              <span class="shrink-0 leading-none opacity-90">{@html c.mark}</span>
            {/each}
          </div>
        </div>
      </div>

      <div class="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-white/12 px-4 py-3">
        <span class="shrink-0 text-rust/70">{@render glyph("ban", "size-[1.05rem]")}</span>
        <span class="text-[0.84rem] text-chalk/35 line-through decoration-rust/50">
          Analytics · vendor cloud · data broker · a server of ours
        </span>
        <span class="board-label ml-auto shrink-0 text-[0.58rem] text-gold/70">
          not in the path
        </span>
      </div>
    </div>

    <ul class="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
      {#each PRIVACY as p (p.title)}
        <li class="rounded-xl border border-white/10 p-4">
          <div class="mb-2 flex items-center gap-2.5">
            <span class="shrink-0 text-gold/75">{@render glyph(p.icon, "size-[1.1rem]")}</span>
            <h3 class="board text-[0.95rem] text-chalk">{p.title}</h3>
          </div>
          <p class="text-[0.85rem] leading-relaxed text-chalk/60">{p.body}</p>
        </li>
      {/each}
    </ul>
  </div>
</section>

<!-- ── stack ────────────────────────────────────────────────────────── -->
<section id="stack" class="scroll-mt-4 border-t border-white/10">
  <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
    <div class="max-w-2xl">
      <p class="board-label mb-4 text-[0.66rem] text-gold">The stack</p>
      <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
        Nothing to install, because everything is a driver.
      </h2>
      <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
        Every port ships a default that needs no external infrastructure, and
        each one is a seam rather than a ceiling. The default queue is durable,
        not absent: jobs live in the same database as your data, so the event
        and the state change commit in one transaction.
      </p>
    </div>

    <div class="mt-10 overflow-x-auto">
      <table class="w-full min-w-[34rem] border-collapse text-left">
        <thead>
          <tr class="border-b border-white/15">
            <th class="board-label py-2.5 pr-4 text-[0.6rem] text-chalk/40">Port</th>
            <th class="board-label py-2.5 pr-4 text-[0.6rem] text-chalk/40">Default</th>
            <th class="board-label py-2.5 text-[0.6rem] text-chalk/40">Drivers later</th>
          </tr>
        </thead>
        <tbody>
          {#each PORTS as row (row.port)}
            <tr class="border-b border-white/8">
              <td class="machine py-2.5 pr-4 text-[0.82rem] text-gold">{row.port}</td>
              <td class="py-2.5 pr-4 text-[0.85rem] text-chalk/85">{row.now}</td>
              <td class="py-2.5 text-[0.85rem] text-chalk/45">{row.later}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>
