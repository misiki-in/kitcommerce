<script lang="ts">
  import { cn } from "$lib/utils";
  let { class: className, children }: { class?: string; children?: any } = $props();
</script>
<div class={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)}>{@render children?.()}</div>
