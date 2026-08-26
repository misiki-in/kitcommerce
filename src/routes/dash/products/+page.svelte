<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { Input } from "$lib/components/ui/input";
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "$lib/components/ui/table";
  import Package from "@lucide/svelte/icons/package";
  import Search from "@lucide/svelte/icons/search";
  import { money, statusLabel, statusVariant, timeAgo } from "$lib/format";
  import type { PageServerData } from "./$types";

  let { data }: { data: PageServerData } = $props();

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
      <Input name="q" value={data.q} placeholder="Search products…" class="w-56 pl-8" />
    </form>
    <Button href="/dash/products/new">Add product</Button>
  </div>
</div>

{#if data.products.length === 0}
  <Card>
    <CardContent class="flex flex-col items-center gap-4 py-16 text-center">
      <Package class="size-8 text-muted-foreground" />
      <p class="text-sm text-muted-foreground">
        {data.q ? "No products match that search." : "No products yet."}
      </p>
      <Button href="/dash/products/new">Add your first product</Button>
    </CardContent>
  </Card>
{:else}
  <Card>
    <CardContent class="p-0">
      <Table>
        <TableHeader>
          <TableRow>
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
            <TableRow>
              <TableCell class="pl-4">
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
