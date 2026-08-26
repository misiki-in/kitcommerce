<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { cn } from "$lib/utils";
  let { class: className, children }: { class?: string; children?: any } = $props();
</script>
<DialogPrimitive.Title class={cn("text-lg font-semibold leading-none tracking-tight", className)}>
  {@render children?.()}
</DialogPrimitive.Title>
