<script lang="ts">
  import { cn } from "$lib/utils";
  let { class: className, children }: { class?: string; children?: any } = $props();
</script>
<div class={cn("px-2 py-1.5", className)}>{@render children?.()}</div>
