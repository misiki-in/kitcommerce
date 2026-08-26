<script lang="ts">
  import { Dialog as SheetPrimitive } from "bits-ui";
  import X from "@lucide/svelte/icons/x";
  import { cn } from "$lib/utils";

  let {
    class: className,
    side = "right",
    children,
    ...rest
  }: { class?: string; side?: "right" | "left"; children?: any } & Record<string, any> = $props();
</script>

<!--
  A sheet is a Dialog pinned to an edge. Built on the same bits-ui primitive as
  the modal so focus handling, Escape, the overlay and inert-background
  behaviour are identical — a drawer that traps focus differently from a modal
  is the kind of inconsistency nobody notices until it bites.
-->
<SheetPrimitive.Portal>
  <SheetPrimitive.Overlay class="fixed inset-0 z-50 bg-black/50" />
  <SheetPrimitive.Content
    class={cn(
      "fixed inset-y-0 z-50 flex w-full flex-col border-l bg-background shadow-lg sm:max-w-md",
      side === "right" ? "right-0" : "left-0 border-l-0 border-r",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      className,
    )}
    {...rest}
  >
    {@render children?.()}
    <SheetPrimitive.Close
      class="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
    >
      <X class="size-4" />
      <span class="sr-only">Close</span>
    </SheetPrimitive.Close>
  </SheetPrimitive.Content>
</SheetPrimitive.Portal>
