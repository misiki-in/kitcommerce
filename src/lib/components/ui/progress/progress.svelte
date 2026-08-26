<script lang="ts">
  import { cn } from "$lib/utils";
  let {
    value = 0,
    max = 100,
    class: className,
    indicatorClass = "",
  }: { value?: number; max?: number; class?: string; indicatorClass?: string } = $props();

  const pct = $derived(max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0);
</script>

<div
  role="progressbar"
  aria-valuenow={value}
  aria-valuemin={0}
  aria-valuemax={max}
  class={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-secondary", className)}
>
  <div
    class={cn("h-full rounded-full bg-primary transition-[width] duration-500", indicatorClass)}
    style="width: {pct}%"
  ></div>
</div>
