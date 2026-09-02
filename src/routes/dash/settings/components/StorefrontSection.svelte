<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Label } from "$lib/components/ui/label";
  import Field from "$lib/components/field.svelte";

  let { store }: { store: any } = $props();
</script>

<Card>
  <CardHeader>
    <CardTitle class="text-base">Storefront</CardTitle>
    <CardDescription>How buyers see you.</CardDescription>
  </CardHeader>
  <CardContent>
    <form method="POST" action="?/storefront" enctype="multipart/form-data" class="space-y-4" use:enhance>
      <Field label="Store name" name="name" required value={store.name} />
      <Field
        label="Description"
        name="description"
        textarea
        rows={3}
        value={store.description}
        help="Used as your seller blurb where marketplaces show one."
      />

      <div>
        <Label class="mb-2 block">Store logo</Label>
        <div class="flex items-center gap-4">
          {#if store.logo_url}
            <img src={store.logo_url} alt="" class="size-14 rounded-xl border object-cover" />
          {:else}
            <span class="size-14 rounded-xl border border-dashed"></span>
          {/if}
          <input
            type="file"
            name="logo_file"
            accept="image/*"
            class="text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
          />
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Support email" name="support_email" type="email" value={store.support_email} />
        <Field label="Support phone" name="support_phone" value={store.support_phone} />
      </div>
      <Field label="Website" name="website" value={store.website} placeholder="https://" />

      <Button type="submit">Save storefront</Button>
    </form>
  </CardContent>
</Card>
