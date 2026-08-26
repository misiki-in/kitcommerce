<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import * as Dialog from "$lib/components/ui/dialog";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";

  /**
   * A destructive action behind a confirmation.
   *
   * One component rather than a `confirm()` call per button: the dialog is
   * styled like the rest of the app, the confirm button always names the
   * actual consequence ("Remove Flipkart"), and every destructive action in
   * the app therefore behaves identically. A native confirm() would look
   * different on every OS and say nothing useful.
   */
  let {
    action,
    label = "Remove",
    title,
    description = "",
    consequence = "",
    confirmLabel,
    fields = {},
    size = "sm",
  }: {
    action: string;
    label?: string;
    title: string;
    description?: string;
    /** What is lost, spelled out. Rendered in the warning box. */
    consequence?: string;
    confirmLabel?: string;
    fields?: Record<string, string>;
    size?: "sm" | "default";
  } = $props();

  let open = $state(false);
  let working = $state(false);
</script>

<Button variant="ghost" {size} class="text-destructive hover:bg-destructive/10" onclick={() => (open = true)}>
  {label}
</Button>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{title}</Dialog.Title>
      {#if description}
        <Dialog.Description>{description}</Dialog.Description>
      {/if}
    </Dialog.Header>

    {#if consequence}
      <div class="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
        <p class="text-sm text-destructive">{consequence}</p>
      </div>
    {/if}

    <form
      method="POST"
      {action}
      use:enhance={() => {
        working = true;
        return async ({ update }) => {
          await update();
          working = false;
          open = false;
        };
      }}
    >
      {#each Object.entries(fields) as [key, value] (key)}
        <input type="hidden" name={key} {value} />
      {/each}

      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={working}>
          {working ? "Removing…" : (confirmLabel ?? label)}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
