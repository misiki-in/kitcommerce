<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import Field from "$lib/components/field.svelte";

  let {
    open = $bindable(false),
    editing = null,
  }: {
    open: boolean;
    editing: any;
  } = $props();
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{editing ? "Edit pickup location" : "Add pickup location"}</Dialog.Title>
      <Dialog.Description>Couriers collect from here.</Dialog.Description>
    </Dialog.Header>

    <form
      method="POST"
      action="?/location"
      class="space-y-4"
      use:enhance={() => {
        return async ({ update }) => {
          await update();
          open = false;
        };
      }}
    >
      {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
      <Field label="Label" name="label" required value={editing?.label ?? ""} placeholder="Main warehouse" />
      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Contact name" name="contact_name" value={editing?.contact_name ?? ""} />
        <Field label="Contact phone" name="contact_phone" value={editing?.contact_phone ?? ""} />
      </div>
      <Field label="Address line 1" name="address_line1" required value={editing?.address_line1 ?? ""} />
      <Field label="Address line 2" name="address_line2" value={editing?.address_line2 ?? ""} />
      <div class="grid gap-4 sm:grid-cols-3">
        <Field label="City" name="city" value={editing?.city ?? ""} />
        <Field label="State" name="state" value={editing?.state ?? ""} />
        <Field label="Postal code" name="postal_code" value={editing?.postal_code ?? ""} />
      </div>
      <Field label="Country" name="country" value={editing?.country ?? "IN"} />

      <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
        <input type="checkbox" name="is_default" value="1" checked={!!editing?.is_default} class="mt-0.5" />
        <span>
          <span class="block text-sm font-medium">Default pickup location</span>
          <span class="block text-xs text-muted-foreground">
            Used whenever a marketplace does not specify one.
          </span>
        </span>
      </label>

      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button type="submit">{editing ? "Save location" : "Add location"}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
