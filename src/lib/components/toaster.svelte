<script lang="ts">
  import { fly } from "svelte/transition";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import Info from "@lucide/svelte/icons/info";
  import X from "@lucide/svelte/icons/x";
  import { dismiss, toasts } from "$lib/toast.svelte";

  const items = $derived(toasts());
</script>

<!-- aria-live so the message is announced, not just shown. -->
<div
  class="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
  aria-live="polite"
  aria-atomic="false"
>
  {#each items as item (item.id)}
    <div
      in:fly={{ y: 12, duration: 180 }}
      out:fly={{ x: 12, duration: 140 }}
      class="pointer-events-auto flex items-start gap-2.5 rounded-lg border p-3 shadow-lg backdrop-blur
             {item.kind === 'success'
               ? 'border-success/30 bg-success/10 text-success'
               : item.kind === 'error'
                 ? 'border-destructive/30 bg-destructive/10 text-destructive'
                 : 'bg-popover text-popover-foreground'}"
      role={item.kind === "error" ? "alert" : "status"}
    >
      {#if item.kind === "success"}
        <CircleCheck class="mt-0.5 size-4 shrink-0" />
      {:else if item.kind === "error"}
        <CircleAlert class="mt-0.5 size-4 shrink-0" />
      {:else}
        <Info class="mt-0.5 size-4 shrink-0" />
      {/if}

      <p class="min-w-0 flex-1 text-sm">{item.message}</p>

      <button
        type="button"
        onclick={() => dismiss(item.id)}
        class="shrink-0 opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
        title="Dismiss"
      >
        <X class="size-3.5" />
      </button>
    </div>
  {/each}
</div>
