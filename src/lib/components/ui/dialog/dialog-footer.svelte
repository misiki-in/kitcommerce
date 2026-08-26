<script lang="ts">
  import { cn } from "$lib/utils";
  let { class: className, children }: { class?: string; children?: any } = $props();
</script>
<div class={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}>{@render children?.()}</div>
