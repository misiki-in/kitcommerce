<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils";
  let { class: className, sideOffset = 6, align = "end", children, ...rest }:
    { class?: string; sideOffset?: number; align?: "start" | "center" | "end"; children?: any } &
    Record<string, any> = $props();
</script>

<!--
  bits-ui gives this menu the behaviour every menu should share: arrow-key
  roving focus, type-ahead, Escape to close, focus returned to the trigger,
  and collision-aware placement.
-->
<DropdownMenuPrimitive.Portal>
  <DropdownMenuPrimitive.Content
    {sideOffset}
    {align}
    class={cn(
      "z-50 min-w-56 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      className,
    )}
    {...rest}
  >
    {@render children?.()}
  </DropdownMenuPrimitive.Content>
</DropdownMenuPrimitive.Portal>
