<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  let { class: className, children, ...rest }: HTMLAttributes<HTMLElement> & { class?: string } = $props();
</script>
<tr class={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)} {...rest}>{@render children?.()}</tr>
