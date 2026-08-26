<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Label } from "$lib/components/ui/label";
  import Field from "$lib/components/field.svelte";
  import Steps from "$lib/components/steps.svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();

  const steps = $derived(
    [
      { key: "basics", label: "Basics" },
      { key: "pricing", label: "Pricing" },
      { key: "images", label: "Images" },
      { key: "attributes", label: "Channel details" },
      { key: "review", label: "Review" },
    ].map((s) => ({ ...s, href: `/dash/products/${data.product.id}/wizard/${s.key}` })),
  );

  const TITLES: Record<string, { h: string; p: string }> = {
    basics: { h: "The basics", p: "What it is and what it is called." },
    pricing: { h: "Pricing and stock", p: "One row per sellable combination. Selling below MRP is what marketplaces show as a discount." },
    images: { h: "Images", p: "The first image is the primary listing image. Most marketplaces want a plain background and at least 1000px on the longest side." },
    attributes: { h: "Channel details", p: "Only what your connected channels actually require." },
    review: { h: "Review and publish", p: "" },
  };

  // Repeating rows held as state rather than cloned DOM.
  let variants = $state(
    data.variants.length
      ? data.variants.map((v) => ({ ...v }))
      : [{ sku: "", options: "", price: "", mrp: "", stock: 0, barcode: "" }],
  );
  let imageUrls = $state(data.images.length ? data.images.map((i) => i.url) : [""]);
  let extras = $state(
    data.extraAttributes.length ? data.extraAttributes.map((a) => ({ ...a })) : [{ key: "", value: "" }],
  );
  let attrValues = $state<Record<string, string>>({ ...data.attributes });
  let saving = $state(false);

  const readyCount = $derived(data.channels.filter((c) => c.ready).length);
</script>

<svelte:head><title>{TITLES[data.step]?.h} · {data.product.title} · OpenCommerce</title></svelte:head>

<div class="mx-auto max-w-3xl">
  <a
    href="/dash/products/{data.product.id}"
    class="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
  >
    <ChevronLeft class="size-4" /> {data.product.title}
  </a>

  <Steps {steps} current={data.step} />

  <div class="mb-6">
    <h1 class="board text-[1.6rem]">{TITLES[data.step]?.h}</h1>
    {#if TITLES[data.step]?.p}
      <p class="mt-1 text-sm text-muted-foreground">{TITLES[data.step]?.p}</p>
    {/if}
  </div>

  {#if form?.error}
    <Alert variant="destructive" class="mb-4"><AlertDescription>{form.error}</AlertDescription></Alert>
  {/if}

  {#if data.step === "review"}
    <!-- ── review ──────────────────────────────────────────────────────── -->
    <Card class="mb-4">
      <CardContent class="pt-6">
        <p class="mb-4 text-sm">
          <span class="font-medium">{readyCount} of {data.channels.length}</span>
          channel{data.channels.length === 1 ? "" : "s"} can accept this product right now.
        </p>
        <div class="space-y-2">
          {#each data.channels as channel (channel.id)}
            <div class="flex flex-wrap items-center gap-3 rounded-lg border p-3 {channel.ready ? '' : 'border-warning/40 bg-warning/5'}">
              <span class="shrink-0">{@html channel.mark}</span>
              <span class="min-w-0 flex-1 text-sm font-medium">{channel.name}</span>
              {#if channel.ready}
                <span class="flex items-center gap-1.5 text-xs font-medium text-success">
                  <CircleCheck class="size-4" /> Ready
                </span>
              {:else}
                <span class="flex flex-wrap items-center gap-1.5">
                  <span class="flex items-center gap-1.5 text-xs font-medium text-warning">
                    <CircleAlert class="size-4" /> Needs
                  </span>
                  {#each channel.missing as label (label)}
                    <Badge variant="warning">{label}</Badge>
                  {/each}
                </span>
              {/if}
            </div>
          {/each}
        </div>
      </CardContent>
    </Card>

    <div class="flex flex-wrap gap-2">
      <form
        method="POST"
        action="?/publish"
        use:enhance={() => {
          saving = true;
          return async ({ update }) => {
            await update();
            saving = false;
          };
        }}
      >
        <Button type="submit" disabled={saving || readyCount === 0}>
          {saving
            ? "Queueing…"
            : readyCount === 0
              ? "No channel ready"
              : `Publish to ${readyCount} channel${readyCount === 1 ? "" : "s"}`}
        </Button>
      </form>
      <Button href="/dash/products/{data.product.id}" variant="outline">Save as draft</Button>
    </div>

    {#if readyCount < data.channels.length}
      <p class="mt-3 text-xs text-muted-foreground">
        Channels with missing fields are not queued. Fill them in on
        <a href="/dash/products/{data.product.id}/wizard/attributes">channel details</a> and publish
        again — nothing is lost.
      </p>
    {/if}
  {:else}
    <!-- ── editable steps ──────────────────────────────────────────────── -->
    <form
      method="POST"
      action="?/save"
      enctype="multipart/form-data"
      use:enhance={() => {
        saving = true;
        return async ({ update }) => {
          await update();
          saving = false;
        };
      }}
    >
      <Card>
        <CardContent class="space-y-5 pt-6">
          {#if data.step === "basics"}
            <Field label="Product title" name="title" required value={data.product.title} />
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label="Brand" name="brand" value={data.product.brand} />
              <Field label="Category" name="category" value={data.product.category} />
            </div>
            <Field
              label="SKU"
              name="sku"
              required
              value={data.product.sku}
              help="Your unique code, used as the key on every marketplace."
            />
            <Field label="Description" name="description" textarea rows={5} value={data.product.description} />
          {/if}

          {#if data.step === "pricing"}
            <div class="space-y-2">
              {#each variants as variant, i (i)}
                <div class="grid grid-cols-2 gap-2 rounded-lg border p-3 sm:grid-cols-12">
                  <input name="variant_sku" bind:value={variant.sku} placeholder="SKU"
                    class="col-span-2 h-9 rounded-md border border-input bg-transparent px-2 text-sm sm:col-span-3" />
                  <input name="variant_options" bind:value={variant.options} placeholder="Size=M; Colour=Red"
                    class="col-span-2 h-9 rounded-md border border-input bg-transparent px-2 text-sm sm:col-span-3" />
                  <input name="variant_price" bind:value={variant.price} type="number" step="0.01" placeholder="Price"
                    class="h-9 rounded-md border border-input bg-transparent px-2 text-sm sm:col-span-2" />
                  <input name="variant_mrp" bind:value={variant.mrp} type="number" step="0.01" placeholder="MRP"
                    class="h-9 rounded-md border border-input bg-transparent px-2 text-sm sm:col-span-2" />
                  <input name="variant_stock" bind:value={variant.stock} type="number" placeholder="Stock"
                    class="h-9 rounded-md border border-input bg-transparent px-2 text-sm sm:col-span-1" />
                  <button
                    type="button"
                    onclick={() => variants.length > 1 && variants.splice(i, 1)}
                    class="grid h-9 place-items-center rounded-md text-muted-foreground hover:text-destructive sm:col-span-1"
                    aria-label="Remove variation"
                    title="Remove variation"
                  >
                    <Trash2 class="size-4" />
                  </button>
                  <input type="hidden" name="variant_barcode" value={variant.barcode ?? ""} />
                </div>
              {/each}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onclick={() => variants.push({ sku: "", options: "", price: "", mrp: "", stock: 0, barcode: "" })}
            >
              <Plus /> Add variation
            </Button>

            <div class="grid gap-4 border-t pt-5 sm:grid-cols-3">
              <Field label="HSN code" name="hsn_code" value={data.product.hsnCode} help="Required for GST" />
              <Field label="Tax rate %" name="tax_rate" type="number" step="0.01" value={data.product.taxRatePct || ""} />
              <Field label="Weight (g)" name="weight_g" type="number" value={data.product.weightG || ""} />
            </div>
            <div class="grid gap-4 sm:grid-cols-3">
              <Field label="Length (mm)" name="length_mm" type="number" value={data.product.lengthMm || ""} />
              <Field label="Width (mm)" name="width_mm" type="number" value={data.product.widthMm || ""} />
              <Field label="Height (mm)" name="height_mm" type="number" value={data.product.heightMm || ""} />
            </div>
          {/if}

          {#if data.step === "images"}
            <div>
              <Label class="mb-2 block">Upload images</Label>
              <input
                type="file"
                name="image_file"
                accept="image/*"
                multiple
                class="w-full rounded-md border border-dashed p-3 text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
              />
            </div>
            <div class="space-y-2">
              {#each imageUrls as url, i (i)}
                <div class="flex items-center gap-2">
                  {#if url}
                    <img src={url} alt="" class="size-10 shrink-0 rounded-md border object-cover" />
                  {:else}
                    <span class="size-10 shrink-0 rounded-md border border-dashed"></span>
                  {/if}
                  <input
                    name="image_url"
                    bind:value={imageUrls[i]}
                    placeholder="https://…/image.jpg"
                    class="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
                  />
                  <button
                    type="button"
                    onclick={() => imageUrls.length > 1 && imageUrls.splice(i, 1)}
                    class="grid size-9 place-items-center rounded-md text-muted-foreground hover:text-destructive"
                    aria-label="Remove image"
                    title="Remove image"
                  >
                    <Trash2 class="size-4" />
                  </button>
                </div>
              {/each}
            </div>
            <Button type="button" variant="outline" size="sm" onclick={() => imageUrls.push("")}>
              <Plus /> Add image URL
            </Button>
          {/if}

          {#if data.step === "attributes"}
            {#if data.requiredAttributes.length}
              <div class="space-y-3">
                {#each data.requiredAttributes as attr (attr.key)}
                  <div class="rounded-lg border p-3 {attrValues[attr.key]?.trim() ? '' : 'border-warning/40 bg-warning/5'}">
                    <div class="mb-2 flex flex-wrap items-center gap-2">
                      <code class="rounded bg-muted px-1.5 py-0.5 text-xs">{attr.key}</code>
                      <span class="text-xs text-muted-foreground">{attr.connectors.join(", ")}</span>
                      {#if attrValues[attr.key]?.trim()}
                        <Badge variant="success">set</Badge>
                      {:else}
                        <Badge variant="warning">needed</Badge>
                      {/if}
                    </div>
                    <input
                      name="attr_{attr.key}"
                      bind:value={attrValues[attr.key]}
                      placeholder={attr.label}
                      class="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    />
                    {#if attr.help}<p class="mt-1.5 text-xs text-muted-foreground">{attr.help}</p>{/if}
                    {#if attr.choices.length}
                      <div class="mt-2 flex flex-wrap gap-1.5">
                        {#each attr.choices.slice(0, 8) as choice (choice)}
                          <button
                            type="button"
                            onclick={() => (attrValues[attr.key] = choice)}
                            class="rounded-md border px-2 py-0.5 text-xs transition-colors hover:border-foreground/30 hover:bg-secondary"
                          >
                            {choice}
                          </button>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="text-sm text-muted-foreground">
                No channel-specific fields required. <a href="/dash/channels">Connect a marketplace</a> to see its requirements here.
              </p>
            {/if}

            <div class="border-t pt-5">
              <h3 class="mb-1 board-label text-[0.62rem] text-muted-foreground">
                Other attributes
              </h3>
              <p class="mb-3 text-xs text-muted-foreground">
                Optional extras — material, finish, care. They enrich listings everywhere.
              </p>
              <div class="space-y-2">
                {#each extras as extra, i (i)}
                  <div class="flex items-center gap-2">
                    <input name="extra_key" bind:value={extra.key} placeholder="material"
                      class="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm" />
                    <input name="extra_value" bind:value={extra.value} placeholder="Mulberry silk"
                      class="h-9 flex-1 rounded-md border border-input bg-transparent px-3 text-sm" />
                    <button
                      type="button"
                      onclick={() => extras.length > 1 && extras.splice(i, 1)}
                      class="grid size-9 place-items-center rounded-md text-muted-foreground hover:text-destructive"
                      aria-label="Remove attribute"
                      title="Remove attribute"
                    >
                      <Trash2 class="size-4" />
                    </button>
                  </div>
                {/each}
              </div>
              <Button type="button" variant="outline" size="sm" class="mt-2" onclick={() => extras.push({ key: "", value: "" })}>
                <Plus /> Add attribute
              </Button>
            </div>
          {/if}
        </CardContent>
      </Card>

      <div class="mt-4 flex gap-2">
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save and continue"}</Button>
        <Button href="/dash/products/{data.product.id}" variant="outline">Cancel</Button>
      </div>
    </form>
  {/if}
</div>
