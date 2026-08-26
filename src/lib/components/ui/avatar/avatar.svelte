<script lang="ts">
  import { cn } from "$lib/utils";

  /**
   * Image with an initials fallback. The fallback is not a loading state — it
   * is the answer when there is no image, which for a fresh store is most of
   * the time.
   */
  let {
    src = "",
    alt = "",
    fallback = "?",
    class: className,
  }: { src?: string; alt?: string; fallback?: string; class?: string } = $props();

  let failed = $state(false);
</script>

<span
  class={cn(
    "relative flex size-8 shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-medium text-secondary-foreground",
    className,
  )}
>
  {#if src && !failed}
    <img {src} {alt} class="size-full object-cover" onerror={() => (failed = true)} />
  {:else}
    {fallback}
  {/if}
</span>
