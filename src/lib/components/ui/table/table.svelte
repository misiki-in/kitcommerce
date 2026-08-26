<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  let { class: className, children, ...rest }: HTMLAttributes<HTMLTableElement> & { class?: string } = $props();
</script>
<!-- Wrapped so a wide table scrolls inside itself instead of the whole page. -->
<div class="relative w-full overflow-x-auto">
  <table class={cn("w-full caption-bottom text-sm", className)} {...rest}>{@render children?.()}</table>
</div>
