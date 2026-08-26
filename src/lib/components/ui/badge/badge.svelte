<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  import { badgeVariants, type BadgeVariant } from "./index";
  let {
    class: className, variant = "default", children, ...rest
  }: HTMLAttributes<HTMLSpanElement> & { class?: string; variant?: BadgeVariant } = $props();
</script>
<span class={cn(badgeVariants({ variant }), className)} {...rest}>{@render children?.()}</span>
