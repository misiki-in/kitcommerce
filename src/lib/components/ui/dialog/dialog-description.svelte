<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { cn } from "$lib/utils";
  let { class: className, children }: { class?: string; children?: any } = $props();
</script>
<DialogPrimitive.Description class={cn("text-sm text-muted-foreground", className)}>
  {@render children?.()}
</DialogPrimitive.Description>
