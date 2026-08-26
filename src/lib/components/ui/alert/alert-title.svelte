<script lang="ts">
  import { cn } from "$lib/utils";
  let { class: className, children }: { class?: string; children?: any } = $props();
</script>
<h5 class={cn("mb-1 font-medium leading-none tracking-tight", className)}>{@render children?.()}</h5>
