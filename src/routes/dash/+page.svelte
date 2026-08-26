<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { Progress } from "$lib/components/ui/progress";
  import Package from "@lucide/svelte/icons/package";
  import RefreshCw from "@lucide/svelte/icons/refresh-cw";
  import ShoppingBag from "@lucide/svelte/icons/shopping-bag";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Plus from "@lucide/svelte/icons/plus";
  import PackageX from "@lucide/svelte/icons/package-x";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import { money, statusLabel, statusVariant, timeAgo } from "$lib/format";
  import type { PageServerData } from "./$types";

  let { data }: { data: PageServerData } = $props();

  type Issue = { tone: "destructive" | "warning"; text: string; href: string; cta: string };

  const issues = $derived.by<Issue[]>(() => {
    const out: Issue[] = [];
    if (data.stats.DEAD_LETTER > 0) {
      out.push({
        tone: "destructive",
        text: `${data.stats.DEAD_LETTER} job${data.stats.DEAD_LETTER === 1 ? "" : "s"} failed after every retry`,
        href: "/dash/activity?filter=failed",
        cta: "Review",
      });
    }
    if (data.counts.outOfStock > 0) {
      out.push({
        tone: "destructive",
        text: `${data.counts.outOfStock} variant${data.counts.outOfStock === 1 ? " is" : "s are"} out of stock but still listed`,
        href: "#out-of-stock",
        cta: "See which",
      });
    }
    if (data.counts.incomplete > 0) {
      out.push({
        tone: "warning",
        text: `${data.counts.incomplete} listing${data.counts.incomplete === 1 ? "" : "s"} missing a marketplace-required field`,
        href: "/dash/products",
        cta: "Fix",
      });
    }
    for (const c of data.unhealthy) {
      out.push({ tone: "destructive", text: `${c.name} is ${statusLabel(c.status)}`, href: "/dash/channels", cta: "Reconnect" });
    }
    if (data.profileGaps.length) {
      out.push({
        tone: "warning",
        text: `Seller profile still needs ${data.profileGaps.join(", ")}`,
        href: "/dash/settings",
        cta: "Complete",
      });
    }
    if (data.counts.channels === 0) {
      out.push({ tone: "warning", text: "No sales channels connected yet", href: "/onboarding/connect", cta: "Connect" });
    }
    return out;
  });

  /** How much of the catalogue is actually live somewhere. */
  const reach = $derived(
    data.counts.products * Math.max(1, data.counts.channels),
  );
</script>

<svelte:head><title>Overview · OpenCommerce</title></svelte:head>

<!-- ── header ─────────────────────────────────────────────────────────── -->
<!--
  The store identity is a one-line strip, not a hero. It is the least changing
  thing on the page, so it takes the least room — the numbers and the issues
  below are what people come here to read.
-->
<header class="mb-5 flex flex-wrap items-center justify-between gap-3">
  <div class="flex min-w-0 items-center gap-2.5">
    {#if data.store.logoUrl}
      <img src={data.store.logoUrl} alt="" class="size-8 shrink-0 rounded-lg border object-cover" />
    {:else}
      <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-semibold">
        {data.store.name.charAt(0).toUpperCase()}
      </span>
    {/if}
    <div class="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
      <h1 class="board truncate text-[1.15rem]">{data.store.name}</h1>
      <p class="text-xs text-muted-foreground">
        {data.counts.liveListings}/{reach} listings live · {data.counts.channels} channel{data.counts.channels === 1 ? "" : "s"}
      </p>
    </div>
  </div>
  <div class="flex shrink-0 gap-2">
    <Button href="/dash/channels" variant="outline" size="sm">Channels</Button>
    <Button href="/dash/products/new" size="sm"><Plus /> Add product</Button>
  </div>
</header>

<!-- ── needs attention ────────────────────────────────────────────────── -->
{#if issues.length}
  <section class="mb-6">
    <h2 class="board-label mb-2 text-[0.62rem] text-muted-foreground">
      Needs attention
    </h2>
    <div class="space-y-1.5">
      {#each issues as issue (issue.text)}
        <div
          class="flex flex-wrap items-center gap-2.5 rounded-lg border py-2 pl-3.5 pr-2
                 {issue.tone === 'destructive'
                   ? 'border-destructive/30 bg-destructive/5'
                   : 'border-warning/30 bg-warning/5'}"
        >
          <span
            class="size-1.5 shrink-0 rounded-full {issue.tone === 'destructive' ? 'bg-destructive' : 'bg-warning'}"
          ></span>
          <span class="min-w-[220px] flex-1 text-sm">{issue.text}</span>
          <Button href={issue.href} variant="outline" size="sm" class="h-7 shrink-0 px-2.5 text-xs">
            {issue.cta}<ArrowRight />
          </Button>
        </div>
      {/each}
    </div>
  </section>
{:else}
  <section class="mb-6 flex items-center gap-2.5 rounded-lg border border-success/30 bg-success/5 px-3.5 py-2.5">
    <CircleCheck class="size-4 shrink-0 text-success" />
    <p class="text-sm">
      <span class="font-medium">Everything is in sync.</span>
      <span class="text-muted-foreground">
        {data.stats.SUCCEEDED} successful sync{data.stats.SUCCEEDED === 1 ? "" : "s"}, nothing queued, nothing failed.
      </span>
    </p>
  </section>
{/if}

<!-- ── the numbers that matter ────────────────────────────────────────── -->
<!--
  Each tile carries one accent, used on the icon chip and the hairline only.
  Colour marks *which* number you are looking at; the figures themselves stay
  in the foreground ink so they remain the most legible thing on the page.
-->
<section class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
  {#each [
    { label: "Catalogue", value: data.counts.products, foot: `${data.counts.variants} variants · ${data.counts.stock} in stock`, href: "/dash/products", icon: Package, accent: "bg-kingfisher/15 text-kingfisher", bar: "bg-kingfisher" },
    { label: "Live listings", value: data.counts.liveListings, foot: `across ${data.counts.channels} channel${data.counts.channels === 1 ? "" : "s"}`, href: "/dash/channels", icon: RefreshCw, accent: "bg-verdigris/15 text-verdigris", bar: "bg-verdigris" },
    { label: "Orders", value: data.counts.orders, foot: `${money(data.counts.revenue, data.store.currency)} total`, href: "/dash/orders", icon: ShoppingBag, accent: "bg-gold/15 text-gold", bar: "bg-gold" },
    { label: "Out of stock", value: data.counts.outOfStock, foot: data.counts.outOfStock ? "still listed on channels" : "nothing sold out", href: "#out-of-stock", icon: PackageX, accent: data.counts.outOfStock ? "bg-rust/15 text-rust" : "bg-muted text-muted-foreground", bar: data.counts.outOfStock ? "bg-rust" : "bg-border" },
  ] as tile (tile.label)}
    <a
      href={tile.href}
      class="group relative overflow-hidden rounded-xl border bg-card px-4 py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-md hover:no-underline"
    >
      <span class="absolute inset-x-0 top-0 h-0.5 {tile.bar}"></span>
      <div class="flex items-center justify-between gap-2">
        <span class="board-label truncate text-[0.62rem] text-muted-foreground">{tile.label}</span>
        <span class="grid size-6 shrink-0 place-items-center rounded-md {tile.accent}">
          <tile.icon class="size-3.5" />
        </span>
      </div>
      <!-- The figure is the reason the tile exists, so it gets the display
           face. tabular-nums keeps the four tiles' baselines from dancing as
           the numbers change. -->
      <div class="board mt-2 text-[2.1rem] tabular-nums">{tile.value}</div>
      <p class="mt-1.5 truncate text-xs text-muted-foreground">{tile.foot}</p>
    </a>
  {/each}
</section>

<!-- ── out of stock ───────────────────────────────────────────────────── -->
{#if data.outOfStock.length}
  <section id="out-of-stock" class="mb-6 scroll-mt-20">
    <div class="mb-2 flex items-baseline justify-between">
      <h2 class="board-label flex items-center gap-2 text-[0.62rem] text-muted-foreground">
        <TriangleAlert class="size-3.5 text-rust" />
        Out of stock &amp; running low
      </h2>
      <a href="/dash/products" class="text-xs">All products →</a>
    </div>

    <Card>
      <CardContent class="p-0">
        <ul class="divide-y">
          {#each data.outOfStock as item (item.variantSku)}
            <li class="flex items-center gap-2.5 px-3.5 py-2">
              {#if item.image}
                <img src={item.image} alt="" class="size-8 shrink-0 rounded-md border object-cover" />
              {:else}
                <span class="size-8 shrink-0 rounded-md border border-dashed"></span>
              {/if}

              <span class="min-w-0 flex-1">
                <a href="/dash/products/{item.id}" class="block truncate text-sm font-medium">{item.title}</a>
                <span class="block truncate text-[11px] text-muted-foreground">
                  <span class="machine">{item.variantSku}</span>{item.options ? ` · ${item.options}` : ""}
                </span>
              </span>

              <!-- Listed-but-empty is the actionable combination, so say it -->
              {#if item.channels > 0}
                <span class="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                  live on {item.channels} channel{item.channels === 1 ? "" : "s"}
                </span>
              {/if}

              <Badge variant={item.available === 0 ? "destructive" : "warning"}>
                {item.available === 0 ? "out of stock" : `${item.available} left`}
              </Badge>
            </li>
          {/each}
        </ul>

        {#if data.outOfStockTotal > data.outOfStock.length}
          <div class="border-t px-3.5 py-2 text-center">
            <a href="/dash/products" class="text-xs">
              {data.outOfStockTotal - data.outOfStock.length} more at or below {data.lowStockThreshold} →
            </a>
          </div>
        {/if}
      </CardContent>
    </Card>
  </section>
{/if}

<!-- ── channels ───────────────────────────────────────────────────────── -->
<section class="mb-6">
  <div class="mb-2 flex items-baseline justify-between">
    <h2 class="board-label text-[0.62rem] text-muted-foreground">Channels</h2>
    <a href="/dash/channels" class="text-xs">Manage →</a>
  </div>

  {#if data.channels.length}
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.channels as channel (channel.id)}
        <a
          href="/dash/channels"
          class="rounded-xl border bg-card px-3.5 py-3 transition-colors hover:border-foreground/25 hover:no-underline"
        >
          <div class="mb-2.5 flex items-center gap-2.5">
            <span class="shrink-0">{@html channel.mark}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{channel.name}</span>
              <span class="block text-[11px] text-muted-foreground">{channel.mode} mode</span>
            </span>
            <Badge variant={statusVariant(channel.status)}>{statusLabel(channel.status)}</Badge>
          </div>
          <Progress
            value={channel.live}
            max={Math.max(1, channel.total)}
            indicatorClass={channel.live === channel.total ? "bg-success" : "bg-primary"}
          />
          <!--
            Listed and last-synced answer two different questions — how much of
            the catalogue is up there, and whether the number can be trusted —
            so they share the line under the bar rather than one being buried.
          -->
          <p class="mt-1.5 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
            <span class="truncate">
              <span class="tabular-nums">{channel.live}</span> of
              <span class="tabular-nums">{channel.total}</span> products listed
            </span>
            <span class="shrink-0 whitespace-nowrap tabular-nums">
              {channel.lastSyncedAt ? `synced ${timeAgo(channel.lastSyncedAt)}` : "never synced"}
            </span>
          </p>
        </a>
      {/each}
    </div>
  {:else}
    <Card>
      <CardContent class="flex flex-col items-center gap-3 py-10 text-center">
        <p class="text-sm text-muted-foreground">No sales channels connected yet.</p>
        <Button href="/onboarding/connect">Connect a marketplace</Button>
      </CardContent>
    </Card>
  {/if}
</section>

<!-- ── orders ─────────────────────────────────────────────────────────── -->
<!--
  Activity used to sit beside this in a two-column grid. It was the same feed
  as the rail on the right and the header button, so on a wide screen you were
  looking at two copies of it at once — the rail is the one that is on every
  page and refreshes itself, so the duplicate is what goes.
-->
<div>
  <section>
    <div class="mb-2 flex items-baseline justify-between">
      <h2 class="board-label text-[0.62rem] text-muted-foreground">Recent orders</h2>
      <a href="/dash/orders" class="text-xs">All orders →</a>
    </div>
    <Card>
      <CardContent class="p-0">
        {#if data.orders.length}
          <ul class="divide-y">
            {#each data.orders as order (order.id)}
              <li class="flex items-center gap-2.5 px-3.5 py-2">
                <span class="shrink-0">{@html order.mark}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">
                    {order.customer || order.externalId}
                  </span>
                  <span class="block truncate font-mono text-[11px] text-muted-foreground">
                    {order.externalId}
                  </span>
                </span>
                <span class="shrink-0 text-right">
                  <span class="block text-sm font-medium tabular-nums">
                    {money(order.totalCents, order.currency)}
                  </span>
                  <span class="block text-[11px] text-muted-foreground">{timeAgo(order.createdAt)}</span>
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="py-10 text-center text-sm text-muted-foreground">No orders imported yet.</p>
        {/if}
      </CardContent>
    </Card>
  </section>
</div>
