<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import X from "@lucide/svelte/icons/x";
  import { cn } from "$lib/utils";

  let { class: className, children, ...rest }: { class?: string; children?: any } & Record<string, any> = $props();
</script>

<!--
  bits-ui is what makes every dialog in the app behave the same: focus moves
  in on open and returns on close, Escape and the overlay close it, the rest
  of the page is inert, and it is announced to screen readers. Hand-rolled
  modals drift apart on exactly those details.
-->
<DialogPrimitive.Portal>
  <DialogPrimitive.Overlay
    class="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out"
  />
  <DialogPrimitive.Content
    class={cn(
      "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4",
      "border bg-background p-6 shadow-lg sm:rounded-lg",
      "max-h-[90vh] overflow-y-auto",
      className,
    )}
    {...rest}
  >
    {@render children?.()}
    <DialogPrimitive.Close
      class="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
    >
      <X class="size-4" />
      <span class="sr-only">Close</span>
    </DialogPrimitive.Close>
  </DialogPrimitive.Content>
</DialogPrimitive.Portal>
