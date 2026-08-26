<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  let { class: className, children, ...rest }: HTMLAttributes<HTMLElement> & { class?: string } = $props();
</script>
<tbody class={cn("[&_tr:last-child]:border-0", className)} {...rest}>{@render children?.()}</tbody>
