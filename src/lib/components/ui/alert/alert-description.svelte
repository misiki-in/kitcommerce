<script lang="ts">
  import { cn } from "$lib/utils";
  let { class: className, children }: { class?: string; children?: any } = $props();
</script>
<div class={cn("text-sm [&_p]:leading-relaxed", className)}>{@render children?.()}</div>
