<script lang="ts">
  import { enhance, deserialize } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "$lib/components/ui/dialog";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import Package from "@lucide/svelte/icons/package";
  import Search from "@lucide/svelte/icons/search";
  import UploadCloud from "@lucide/svelte/icons/upload-cloud";
  import Plus from "@lucide/svelte/icons/plus";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import AlertTriangle from "@lucide/svelte/icons/alert-triangle";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import { money, statusLabel, statusVariant, timeAgo } from "$lib/format";
  import UploadSheetModal from "./components/UploadSheetModal.svelte";
  import type { PageServerData } from "./$types";

  let { data }: { data: PageServerData } = $props();

  let uploadModalOpen = $state(false);

  // ── Selection state ─────────────────────────────────────────────────────────
  let selectedIds = $state<Set<string>>(new Set());
  const allSelected = $derived(
    data.products.length > 0 && selectedIds.size === data.products.length
  );

  function toggleAll() {
    if (allSelected) {
      selectedIds = new Set();
    } else {
      selectedIds = new Set(data.products.map((p) => p.id));
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  // ── Delete dialog state ──────────────────────────────────────────────────────
  let deleteDialogOpen = $state(false);
  let selectedChannelIds = $state<Set<string>>(new Set());
  let deleteFromAll = $state(false);
  let deleting = $state(false);
  let deleteError = $state("");

  function openDeleteDialog() {
    selectedChannelIds = new Set();
    deleteFromAll = false;
    deleteError = "";
    deleteDialogOpen = true;
  }

  function toggleChannel(id: string) {
    const next = new Set(selectedChannelIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedChannelIds = next;
    if (next.size > 0) deleteFromAll = false;
  }

  // Channels that have at least one mapping in the selected products
  const relevantChannels = $derived(() => {
    const channelIdSet = new Set<string>();
    for (const p of data.products) {
      if (!selectedIds.has(p.id)) continue;
      for (const m of p.mappings) {
        if (m.channelId) channelIdSet.add(m.channelId);
      }
    }
    return data.channels.filter((ch) => channelIdSet.has(ch.id));
  });

  async function confirmDelete() {
    const channels = relevantChannels();
    // If no channel mappings exist, always delete from local DB
    if (channels.length === 0) deleteFromAll = true;

    if (!deleteFromAll && selectedChannelIds.size === 0) {
      deleteError = "Select at least one channel to delete from, or choose 'Delete everywhere'.";
      return;
    }
    deleting = true;
    deleteError = "";

    const form = new FormData();
    form.set("product_ids", [...selectedIds].join(","));
    form.set("channel_ids", deleteFromAll ? "" : [...selectedChannelIds].join(","));
    form.set("delete_from_all", deleteFromAll ? "true" : "false");

    try {
      const res = await fetch("?/deleteProducts", { method: "POST", body: form });
      const text = await res.text();
      let parsed: any = null;
      try {
        const result = deserialize(text);
        if (result.type === "success" && (result as any).data) {
          parsed = (result as any).data;
        } else if (result.type === "failure" && (result as any).data) {
          parsed = (result as any).data;
        }
      } catch {
        try {
          parsed = JSON.parse(text);
          if (parsed?.data) parsed = JSON.parse(parsed.data)?.[0];
        } catch {}
      }

      if (!res.ok || parsed?.error) {
        deleteError = parsed?.error ?? "Deletion failed on remote marketplace.";
      } else if (parsed?.errors?.length > 0) {
        deleteError = `Partial failure: ${parsed.errors.join("; ")}`;
        await invalidateAll();
      } else {
        deleteDialogOpen = false;
        selectedIds = new Set();
        await invalidateAll();
      }
    } catch (err: any) {
      deleteError = err.message || "Unexpected error during deletion.";
    } finally {
      deleting = false;
    }
  }

  /** INCOMPLETE mappings are the ones a merchant has to act on. */
  const mappingTone = (status: string) =>
    status === "INCOMPLETE" ? "opacity-100 ring-1 ring-warning/50 rounded" : "opacity-100";
</script>

<svelte:head><title>Products · OpenCommerce</title></svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="board text-[1.6rem]">Products</h1>
    <p class="text-sm text-muted-foreground">
      {data.products.length} product{data.products.length === 1 ? "" : "s"} in {data.storeName}
    </p>
  </div>
  <div class="flex items-center gap-2">
    <form method="GET" class="relative">
      <Search class="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input name="q" value={data.q} placeholder="Search products…" class="w-52 pl-8" />
    </form>
    <Button
      variant="outline"
      onclick={() => (uploadModalOpen = true)}
      class="gap-2"
    >
      <UploadCloud class="size-4" />
      Import Sheet
    </Button>
    <Button href="/dash/products/new" class="gap-1.5">
      <Plus class="size-4" />
      Add product
    </Button>
  </div>
</div>

<!-- Bulk action toolbar — appears when items are selected -->
{#if selectedIds.size > 0}
  <div class="mb-4 flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2.5">
    <span class="text-sm font-medium text-destructive">
      {selectedIds.size} product{selectedIds.size === 1 ? "" : "s"} selected
    </span>
    <div class="ml-auto flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        class="text-xs"
        onclick={() => (selectedIds = new Set())}
      >
        Clear selection
      </Button>
      <Button
        variant="destructive"
        size="sm"
        class="gap-1.5 text-xs"
        onclick={openDeleteDialog}
      >
        <Trash2 class="size-3.5" />
        Delete selected
      </Button>
    </div>
  </div>
{/if}

{#if data.products.length === 0}
  <Card>
    <CardContent class="flex flex-col items-center gap-4 py-16 text-center">
      <Package class="size-8 text-muted-foreground" />
      <p class="text-sm text-muted-foreground">
        {data.q ? "No products match that search." : "No products yet."}
      </p>
      <div class="flex items-center gap-3">
        <Button
          variant="outline"
          onclick={() => (uploadModalOpen = true)}
          class="gap-2"
        >
          <UploadCloud class="size-4" />
          Upload Import Sheet
        </Button>
        <Button href="/dash/products/new">Add your first product</Button>
      </div>
    </CardContent>
  </Card>
{:else}
  <Card>
    <CardContent class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-10 pl-4">
              <input
                type="checkbox"
                id="select_all"
                checked={allSelected}
                onchange={toggleAll}
                class="size-4 cursor-pointer rounded border-input"
              />
            </TableHead>
            <TableHead class="w-14"></TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="text-right">Price</TableHead>
            <TableHead class="text-right">Stock</TableHead>
            <TableHead class="text-right">Variants</TableHead>
            <TableHead>Channels</TableHead>
            <TableHead class="text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {#each data.products as product (product.id)}
            <TableRow class={selectedIds.has(product.id) ? "bg-primary/5" : ""}>
              <TableCell class="pl-4">
                <input
                  type="checkbox"
                  id="sel_{product.id}"
                  checked={selectedIds.has(product.id)}
                  onchange={() => toggleOne(product.id)}
                  class="size-4 cursor-pointer rounded border-input"
                />
              </TableCell>
              <TableCell class="pl-2">
                {#if product.image}
                  <img src={product.image} alt="" class="size-9 rounded-md border object-cover" />
                {:else}
                  <span class="block size-9 rounded-md border border-dashed"></span>
                {/if}
              </TableCell>
              <TableCell>
                <a href="/dash/products/{product.id}" class="font-medium">{product.title}</a>
                <div class="text-xs text-muted-foreground">
                  <span class="machine">{product.sku}</span>{product.brand ? ` · ${product.brand}` : ""}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={statusVariant(product.status)}>{statusLabel(product.status)}</Badge>
              </TableCell>
              <TableCell class="text-right whitespace-nowrap">
                {product.priceCents ? money(product.priceCents, product.currency) : "—"}
              </TableCell>
              <TableCell class="text-right">{product.stock}</TableCell>
              <TableCell class="text-right">{product.variants}</TableCell>
              <TableCell>
                {#if product.mappings.length}
                  <span class="flex flex-wrap items-center gap-1">
                    {#each product.mappings as m (m.connector)}
                      <span
                        class={mappingTone(m.status)}
                        title="{m.connector}: {statusLabel(m.status)}"
                      >{@html m.mark}</span>
                    {/each}
                  </span>
                {:else}
                  <span class="text-xs text-muted-foreground">not listed</span>
                {/if}
              </TableCell>
              <TableCell class="text-right text-xs whitespace-nowrap text-muted-foreground">
                {timeAgo(product.updatedAt)}
              </TableCell>
            </TableRow>
          {/each}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
{/if}

<UploadSheetModal
  bind:open={uploadModalOpen}
/>

<!-- ── Delete confirmation dialog ──────────────────────────────────────────── -->
<Dialog bind:open={deleteDialogOpen}>
  <DialogContent class="max-w-md">
    <DialogHeader>
      <div class="mb-2 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle class="size-5" />
      </div>
      <DialogTitle>Delete {selectedIds.size} product{selectedIds.size === 1 ? "" : "s"}</DialogTitle>
      <DialogDescription>
        Choose which channels to remove these products from. If no channel mappings remain, the product will also be permanently removed from your local database.
      </DialogDescription>
    </DialogHeader>

    <div class="space-y-4 py-2">
      <!-- Channel selector -->
      {#if relevantChannels().length > 0}
        <div class="space-y-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remove from channels</p>
          <div class="space-y-2 rounded-lg border p-3">
            {#each relevantChannels() as ch (ch.id)}
              <label class="flex cursor-pointer items-center gap-3 rounded-md p-1.5 hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={selectedChannelIds.has(ch.id)}
                  onchange={() => toggleChannel(ch.id)}
                  disabled={deleteFromAll}
                  class="size-4 cursor-pointer rounded border-input"
                />
                <span class="shrink-0">{@html ch.mark}</span>
                <span class="text-sm font-medium">{ch.name}</span>
                <Badge variant="outline" class="ml-auto text-[0.62rem] uppercase">{ch.connector}</Badge>
              </label>
            {/each}
          </div>
        </div>

        <div class="flex items-center gap-2 border-t pt-3">
          <input
            type="checkbox"
            id="delete_from_all"
            bind:checked={deleteFromAll}
            onchange={() => { if (deleteFromAll) selectedChannelIds = new Set(); }}
            class="size-4 cursor-pointer rounded border-input"
          />
          <label for="delete_from_all" class="cursor-pointer text-sm font-medium text-destructive">
            Delete everywhere (all channels + local database)
          </label>
        </div>
      {:else}
        <!-- No channel mappings — will delete from local DB only -->
        <Alert class="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle class="size-4" />
          <AlertDescription class="text-xs">
            These products have no marketplace listings. They will be permanently deleted from your local catalogue.
          </AlertDescription>
        </Alert>
      {/if}

      {#if deleteError}
        <Alert variant="destructive" class="text-xs">
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      {/if}
    </div>

    <DialogFooter class="gap-2">
      <Button
        variant="outline"
        onclick={() => (deleteDialogOpen = false)}
        disabled={deleting}
      >
        Cancel
      </Button>
      <Button
        variant="destructive"
        onclick={confirmDelete}
        disabled={deleting || (!deleteFromAll && selectedChannelIds.size === 0 && relevantChannels().length > 0)}
        class="gap-1.5"
      >
        {#if deleting}
          <LoaderCircle class="size-4 animate-spin" />
          Deleting…
        {:else}
          <Trash2 class="size-4" />
          Confirm Delete
        {/if}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
