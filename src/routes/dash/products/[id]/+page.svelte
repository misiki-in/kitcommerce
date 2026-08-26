<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Pencil from "@lucide/svelte/icons/pencil";
  import { money, statusLabel, statusVariant, timeAgo } from "$lib/format";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();

  let hero = $state(0);
  let publishing = $state(false);

  const p = $derived(data.product);
  const totalStock = $derived(data.variants.reduce((n, v) => n + v.available, 0));
  const priceRange = $derived.by(() => {
    if (data.variants.length === 0) return "—";
    const prices = data.variants.map((v) => v.priceCents);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    return lo === hi ? money(lo, p.currency) : `${money(lo, p.currency)} – ${money(hi, p.currency)}`;
  });

  const dims = $derived(
    p.lengthMm || p.widthMm || p.heightMm ? `${p.lengthMm} × ${p.widthMm} × ${p.heightMm} mm` : "—",
  );

  /** Discount is only meaningful when MRP is genuinely above the selling price. */
  function discount(priceCents: number, mrpCents: number): number {
    if (!mrpCents || mrpCents <= priceCents) return 0;
    return Math.round(((mrpCents - priceCents) / mrpCents) * 100);
  }
</script>

<svelte:head><title>{p.title} · OpenCommerce</title></svelte:head>

<a href="/dash/products" class="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
  <ChevronLeft class="size-4" /> Products
</a>

<!-- ── header ─────────────────────────────────────────────────────────── -->
<header class="mb-6 flex flex-wrap items-start justify-between gap-4">
  <div class="min-w-0">
    <div class="mb-1.5 flex flex-wrap items-center gap-2">
      <Badge variant={statusVariant(p.status)}>{statusLabel(p.status)}</Badge>
      <span class="font-mono text-xs text-muted-foreground">{p.sku}</span>
      <span class="text-xs text-muted-foreground">v{p.version} · edited {timeAgo(p.updatedAt)}</span>
    </div>
    <h1 class="board text-[1.6rem]">{p.title}</h1>
    {#if p.brand || p.category}
      <p class="mt-1 text-sm text-muted-foreground">
        {[p.brand, p.category].filter(Boolean).join(" · ")}
      </p>
    {/if}
  </div>

  <div class="flex shrink-0 gap-2">
    <Button href="/dash/products/{p.id}/wizard/basics" variant="outline"><Pencil /> Edit</Button>
    <form
      method="POST"
      action="?/publish"
      use:enhance={() => {
        publishing = true;
        return async ({ update }) => {
          await update();
          publishing = false;
        };
      }}
    >
      <Button type="submit" disabled={publishing || data.readyCount === 0}>
        {publishing
          ? "Queueing…"
          : data.readyCount === 0
            ? "No channel ready"
            : `Publish to ${data.readyCount} channel${data.readyCount === 1 ? "" : "s"}`}
      </Button>
    </form>
  </div>
</header>

{#if form?.queued !== undefined}
  <Alert variant={form.queued > 0 ? "success" : "default"} class="mb-6">
    <AlertDescription>
      {form.queued > 0
        ? `Queued ${form.queued} sync job${form.queued === 1 ? "" : "s"}.`
        : "Nothing queued — every eligible channel is already up to date."}
      <a href="/dash/activity" class="ml-1">View activity →</a>
    </AlertDescription>
  </Alert>
{/if}

<div class="flex flex-col gap-8 lg:flex-row">
  <!-- ── media + key facts ────────────────────────────────────────────── -->
  <!-- Fixed 320px rail; w-80 + flex-1 are core utilities that always build,
       unlike the arbitrary grid template this replaced. -->
  <div class="w-full shrink-0 space-y-5 lg:w-80">
    <div>
      {#if data.images.length}
        <img
          src={data.images[hero]?.url}
          alt={data.images[hero]?.alt ?? ""}
          class="aspect-square w-full rounded-xl border object-cover"
        />
        {#if data.images.length > 1}
          <div class="mt-2 flex gap-2">
            {#each data.images as image, i (image.id)}
              <button
                type="button"
                onclick={() => (hero = i)}
                class="size-14 overflow-hidden rounded-lg border transition-colors
                       {i === hero ? 'border-primary ring-1 ring-primary' : 'hover:border-foreground/25'}"
                aria-label="Image {i + 1}"
              >
                <img src={image.url} alt="" class="size-full object-cover" />
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <div class="grid aspect-square w-full place-items-center rounded-xl border border-dashed">
          <span class="text-sm text-muted-foreground">No image</span>
        </div>
      {/if}
    </div>

    <Card>
      <CardContent class="p-0">
        <dl class="divide-y text-sm">
          {#each [
            { k: "Price", v: priceRange },
            { k: "In stock", v: String(totalStock) },
            { k: "Variants", v: String(data.variants.length) },
            { k: "HSN code", v: p.hsnCode || "—" },
            { k: "Tax", v: p.taxRatePct ? `${p.taxRatePct}%` : "—" },
            { k: "Weight", v: p.weightG ? `${p.weightG} g` : "—" },
            { k: "Dimensions", v: dims },
          ] as row (row.k)}
            <div class="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <dt class="text-muted-foreground">{row.k}</dt>
              <dd class="text-right font-medium tabular-nums">{row.v}</dd>
            </div>
          {/each}
        </dl>
      </CardContent>
    </Card>
  </div>

  <!-- ── channel readiness, variants, attributes, description ─────────── -->
  <div class="min-w-0 flex-1 space-y-8">
    <section>
      <h2 class="mb-3 board-label text-[0.62rem] text-muted-foreground">
        Channel readiness
      </h2>
      {#if data.channels.length}
        <div class="space-y-2">
          {#each data.channels as channel (channel.id)}
            <div
              class="rounded-lg border p-3 {channel.ready ? '' : 'border-warning/40 bg-warning/5'}"
            >
              <div class="flex flex-wrap items-center gap-3">
                <span class="shrink-0">{@html channel.mark}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium">{channel.name}</span>
                  {#if channel.remoteId}
                    <span class="block font-mono text-[11px] text-muted-foreground">
                      {channel.remoteId}
                    </span>
                  {/if}
                </span>
                {#if channel.ready}
                  <span class="flex items-center gap-1.5 text-xs font-medium text-success">
                    <CircleCheck class="size-4" /> Ready
                  </span>
                {:else}
                  <span class="flex items-center gap-1.5 text-xs font-medium text-warning">
                    <CircleAlert class="size-4" />
                    {channel.missing.length} field{channel.missing.length === 1 ? "" : "s"} missing
                  </span>
                {/if}
                <Badge variant={statusVariant(channel.status)}>{statusLabel(channel.status)}</Badge>
                <span class="text-[11px] whitespace-nowrap text-muted-foreground">
                  {timeAgo(channel.lastSyncedAt)}
                </span>
              </div>

              {#if !channel.ready}
                <!-- Naming the exact fields is the whole point: "incomplete" alone
                     sends you hunting through the wizard. -->
                <ul class="mt-2.5 flex flex-wrap gap-1.5 border-t pt-2.5">
                  {#each channel.missing as field (field.path)}
                    <li
                      class="rounded-md bg-warning/10 px-2 py-1 text-[11px] text-warning"
                      title={field.help}
                    >
                      {field.label}
                    </li>
                  {/each}
                </ul>
              {/if}

              {#if channel.lastError}
                <p class="mt-2 text-xs text-destructive">{channel.lastError}</p>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <Card>
          <CardContent class="flex flex-col items-center gap-3 py-10 text-center">
            <p class="text-sm text-muted-foreground">No channels connected.</p>
            <Button href="/dash/channels" variant="outline">Connect a marketplace</Button>
          </CardContent>
        </Card>
      {/if}
    </section>

    <section>
      <h2 class="mb-3 board-label text-[0.62rem] text-muted-foreground">
        Variants
      </h2>
      <Card>
        <CardContent class="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead class="pl-4">SKU</TableHead>
                <TableHead>Options</TableHead>
                <TableHead class="text-right">Price</TableHead>
                <TableHead class="text-right">MRP</TableHead>
                <TableHead class="text-right">Stock</TableHead>
                <TableHead class="pr-4">Barcode</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {#each data.variants as variant (variant.id)}
                {@const off = discount(variant.priceCents, variant.mrpCents)}
                <TableRow>
                  <TableCell class="pl-4 font-mono text-xs">{variant.sku}</TableCell>
                  <TableCell>
                    {#if Object.keys(variant.options).length}
                      <span class="flex flex-wrap gap-1">
                        {#each Object.entries(variant.options) as [key, value] (key)}
                          <Badge variant="secondary">{key}: {value}</Badge>
                        {/each}
                      </span>
                    {:else}
                      <span class="text-xs text-muted-foreground">—</span>
                    {/if}
                  </TableCell>
                  <TableCell class="text-right font-medium tabular-nums whitespace-nowrap">
                    {money(variant.priceCents, variant.currency)}
                  </TableCell>
                  <TableCell class="text-right tabular-nums whitespace-nowrap text-muted-foreground">
                    {#if off}
                      <span class="line-through">{money(variant.mrpCents, variant.currency)}</span>
                      <span class="ml-1 text-success">−{off}%</span>
                    {:else}
                      {money(variant.mrpCents, variant.currency)}
                    {/if}
                  </TableCell>
                  <TableCell class="text-right tabular-nums">
                    <span class={variant.available === 0 ? "text-destructive" : ""}>
                      {variant.available}
                    </span>
                  </TableCell>
                  <TableCell class="pr-4 font-mono text-xs text-muted-foreground">
                    {variant.barcode || "—"}
                  </TableCell>
                </TableRow>
              {/each}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>

    {#if p.description}
      <section>
        <h2 class="mb-3 board-label text-[0.62rem] text-muted-foreground">
          Description
        </h2>
        <Card>
          <CardContent class="pt-6">
            <p class="max-w-prose text-sm leading-relaxed whitespace-pre-line">{p.description}</p>
          </CardContent>
        </Card>
      </section>
    {/if}

    <section>
      <h2 class="mb-3 board-label text-[0.62rem] text-muted-foreground">
        Attributes
      </h2>
      <Card>
        <CardContent class="p-0">
          {#if data.attributes.length}
            <!--
              Key above value, not beside it. Marketplace attribute names are
              long (ebay_merchant_location_key) and so are their values, so a
              two-column key/value row collides at any sensible width.
            -->
            <dl class="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
              {#each data.attributes as attribute (attribute.key)}
                <div class="bg-card px-4 py-3">
                  <dt class="font-mono text-[11px] break-all text-muted-foreground">{attribute.key}</dt>
                  <dd class="mt-0.5 text-sm font-medium break-words">{attribute.value}</dd>
                </div>
              {/each}
            </dl>
          {:else}
            <p class="py-10 text-center text-sm text-muted-foreground">
              No attributes yet — these are what marketplaces require.
            </p>
          {/if}
        </CardContent>
      </Card>
    </section>
  </div>
</div>
