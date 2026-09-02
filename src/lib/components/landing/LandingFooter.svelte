<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    repo,
    counts,
    brandIcon,
  }: {
    repo: string;
    counts: { channels: number; india: number };
    brandIcon: Snippet<[string]>;
  } = $props();

  const LINKS = {
    github: repo,
    issues: `${repo}/issues`,
    discussions: `${repo}/discussions`,
    building: `${repo}/blob/main/docs/connector-development.md`,
    roadmap: `${repo}/blob/main/docs/connector-roadmap.md`,
    license: `${repo}/blob/main/LICENSE`,
    terms: `${repo}/blob/main/LICENSE`,
    discord: "https://discord.gg/your-invite",
    telegram: "https://t.me/your-channel",
    x: "https://x.com/your-handle",
    contact: "mailto:you@your-domain.example",
    security: "mailto:security@your-domain.example",
  };

  const FOOTER = [
    {
      title: "Explore",
      links: [
        { label: "Dashboard", href: "#dashboard" },
        { label: "Features", href: "#features" },
        { label: "Connectors", href: "#connectors" },
        { label: "The stack", href: "#stack" },
      ],
    },
    {
      title: "Source",
      links: [
        { label: "GitHub", href: LINKS.github, icon: "github" },
        { label: "Issues", href: LINKS.issues },
        { label: "Adding a connector", href: LINKS.building },
        { label: "Connector roadmap", href: LINKS.roadmap },
      ],
    },
    {
      title: "Community",
      links: [
        { label: "Discord", href: LINKS.discord, icon: "discord" },
        { label: "Telegram", href: LINKS.telegram, icon: "telegram" },
        { label: "X", href: LINKS.x, icon: "x" },
        { label: "Discussions", href: LINKS.discussions },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "License (MIT)", href: LINKS.license },
        { label: "Terms", href: LINKS.terms },
        { label: "How your data is handled", href: "#privacy" },
        { label: "Report a vulnerability", href: LINKS.security },
        { label: "Contact", href: LINKS.contact },
      ],
    },
  ];

  const isExternal = (href: string) => href.startsWith("http");
</script>

<footer class="border-t border-white/10 bg-peacock">
  <div class="mx-auto max-w-6xl px-5 py-14 sm:px-8">
    <div class="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)] lg:gap-14">
      <div class="max-w-md">
        <div class="flex items-center gap-2.5">
          <img src="/logo.svg" alt="" width="26" height="26" />
          <span class="board text-[0.95rem] text-chalk">OpenCommerce</span>
        </div>
        <p class="mt-4 text-[0.82rem] leading-relaxed text-chalk/45">
          Deliberately not here yet: teams and roles, multi-store, AI,
          Postgres, Redis, shipping, accounting, and bulk marketplace writes.
          Each has a seam waiting for it.
        </p>

        <div class="mt-6 flex flex-wrap items-center gap-2.5">
          <a
            href="/signup"
            class="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-peacock-deep transition-opacity hover:opacity-90 hover:no-underline"
          >
            Get started
          </a>
          <a
            href="/login"
            class="rounded-md border border-white/20 px-4 py-2 text-sm font-medium text-chalk transition-colors hover:border-white/40 hover:text-white hover:no-underline"
          >
            Sign in
          </a>
          <a
            href={LINKS.github}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-2 rounded-md border border-white/15 px-3.5 py-2 text-sm text-chalk/80 transition-colors hover:border-white/30 hover:text-chalk hover:no-underline
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-peacock"
          >
            {@render brandIcon("github")}
            Star on GitHub
          </a>
        </div>
      </div>

      <nav class="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4" aria-label="Footer">
        {#each FOOTER as column (column.title)}
          <div class="min-w-0">
            <h2 class="board-label mb-3 text-[0.58rem] text-chalk/35">{column.title}</h2>
            <ul class="space-y-2">
              {#each column.links as link (link.label)}
                <li>
                  <a
                    href={link.href}
                    target={isExternal(link.href) ? "_blank" : undefined}
                    rel={isExternal(link.href) ? "noopener noreferrer" : undefined}
                    class="inline-flex items-center gap-1.5 text-[0.82rem] leading-snug text-chalk/60 transition-colors hover:text-chalk hover:no-underline
                           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-peacock"
                  >
                    {#if link.icon}{@render brandIcon(link.icon)}{/if}
                    {link.label}
                  </a>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </nav>
    </div>

    <p class="machine mt-12 border-t border-white/8 pt-6 text-[0.72rem] text-chalk/30">
      MIT · {counts.channels} connectors · {counts.india} built for India ·
      no analytics, no trackers
    </p>
  </div>
</footer>
