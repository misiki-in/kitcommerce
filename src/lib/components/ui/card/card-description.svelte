<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  let { class: className, children, ...rest }: HTMLAttributes<HTMLElement> & { class?: string } = $props();
</script>
<p class={cn("text-sm text-muted-foreground", className)} {...rest}>{@render children?.()}</p>
