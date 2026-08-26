<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  let { class: className, children, ...rest }: HTMLAttributes<HTMLElement> & { class?: string } = $props();
</script>
<th class={cn("h-10 px-2 text-left align-middle board-label text-[0.6rem] text-muted-foreground", className)} {...rest}>{@render children?.()}</th>
