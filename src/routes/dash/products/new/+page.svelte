<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import Field from "$lib/components/field.svelte";
  import Steps from "$lib/components/steps.svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();

  let title = $state("");
  let brand = $state("");
  let category = $state("");
  let sku = $state(data.suggestedSku);
  let skuTouched = $state(false);
  let saving = $state(false);
  let categorySuggestions = $state<string[]>([]);
  let keywords = $state<string[]>([]);

  let timer: ReturnType<typeof setTimeout>;

  /**
   * Suggestions are deterministic and computed server-side with no AI and no
   * network call, so they are safe to request on every keystroke.
   */
  function refresh(force = false) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!title.trim()) return;
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, brand, category, sku: skuTouched && !force ? sku : "" }),
      });
      if (!res.ok) return;
      const d = await res.json();
      if (!skuTouched || force) sku = d.sku;
      categorySuggestions = d.categories.map((c: { category: string }) => c.category);
      keywords = d.keywords;
    }, 250);
  }
</script>

<svelte:head><title>Add product · OpenCommerce</title></svelte:head>

<div class="mx-auto max-w-2xl">
  <a href="/dash/products" class="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
    <ChevronLeft class="size-4" /> Products
  </a>

  <Steps
    current="basics"
    steps={[
      { key: "basics", label: "Basics" },
      { key: "pricing", label: "Pricing" },
      { key: "images", label: "Images" },
      { key: "attributes", label: "Channel details" },
      { key: "review", label: "Review" },
    ]}
  />

  <div class="mb-6">
    <h1 class="board text-[1.6rem]">What are you selling?</h1>
    <p class="mt-1 text-sm text-muted-foreground">
      Start with the title — everything else can be suggested from it, and all of it is editable later.
    </p>
  </div>

  {#if form?.error}
    <Alert variant="destructive" class="mb-4"><AlertDescription>{form.error}</AlertDescription></Alert>
  {/if}

  <Card>
    <CardContent class="pt-6">
      <form
        method="POST"
        class="space-y-5"
        use:enhance={() => {
          saving = true;
          return async ({ update }) => {
            await update();
            saving = false;
          };
        }}
      >
        <Field
          label="Product title"
          name="title"
          required
          bind:value={title}
          oninput={() => refresh()}
          placeholder="Handwoven Mysore Silk Saree — Peacock Blue"
          help="Include material, type and colour. This is what buyers search for."
        />

        <div class="grid gap-4 sm:grid-cols-2">
          <Field label="Brand" name="brand" bind:value={brand} oninput={() => refresh()} placeholder="Misiki" />
          <Field label="Category" name="category" bind:value={category} placeholder="Sarees" />
        </div>

        {#if categorySuggestions.length}
          <div>
            <p class="mb-1.5 text-xs font-medium text-muted-foreground">Suggested categories</p>
            <div class="flex flex-wrap gap-1.5">
              {#each categorySuggestions as suggestion (suggestion)}
                <button
                  type="button"
                  onclick={() => (category = suggestion)}
                  class="rounded-md border px-2 py-1 text-xs transition-colors hover:border-foreground/30 hover:bg-secondary"
                >
                  {suggestion}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div class="flex items-end gap-2">
          <Field
            label="SKU"
            name="sku"
            required
            class="flex-1"
            bind:value={sku}
            oninput={() => (skuTouched = true)}
            help="Your unique code, used as the key on every marketplace."
          />
          <Button type="button" variant="outline" size="sm" class="mb-6" onclick={() => refresh(true)}>
            <Sparkles /> Suggest
          </Button>
        </div>

        <div class="grid gap-4 sm:grid-cols-3">
          <Field label="Price ({data.currency})" name="price" type="number" step="0.01" required />
          <Field label="MRP ({data.currency})" name="mrp" type="number" step="0.01" />
          <Field label="Stock" name="stock" type="number" required />
        </div>

        <Field
          label="Image URL"
          name="image_url"
          placeholder="https://…/photo.jpg"
          help="Or upload files on the next screens."
        />

        <Field label="Description" name="description" textarea rows={4} />

        {#if keywords.length}
          <div>
            <p class="mb-1.5 text-xs font-medium text-muted-foreground">Detected keywords</p>
            <div class="flex flex-wrap gap-1.5">
              {#each keywords as keyword (keyword)}
                <span class="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground">
                  {keyword}
                </span>
              {/each}
            </div>
            <p class="mt-1.5 text-xs text-muted-foreground">
              These are the terms marketplaces index. Missing something important? Add it to the title.
            </p>
          </div>
        {/if}

        <div class="flex gap-2 pt-2">
          <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create and continue"}</Button>
          <Button href="/dash/products" variant="outline">Cancel</Button>
        </div>
      </form>
    </CardContent>
  </Card>
</div>
