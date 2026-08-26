<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  let { class: className, children, ...rest }: HTMLAttributes<HTMLElement> & { class?: string } = $props();
</script>
<td class={cn("p-2 align-middle", className)} {...rest}>{@render children?.()}</td>
