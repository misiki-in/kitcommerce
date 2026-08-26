<script lang="ts">
  import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
  import { cn } from "$lib/utils";
  let { class: className, destructive = false, children, ...rest }:
    { class?: string; destructive?: boolean; children?: any } & Record<string, any> = $props();
</script>
<DropdownMenuPrimitive.Item
  class={cn(
    "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
    "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
    destructive && "text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive",
    className,
  )}
  {...rest}
>
  {@render children?.()}
</DropdownMenuPrimitive.Item>
