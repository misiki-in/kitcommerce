<script lang="ts">
  import * as Sheet from "$lib/components/ui/sheet";
  import ActivityPanel from "$lib/components/activity-panel.svelte";

  let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<!-- Below the sidebar breakpoint there is nowhere to pin the panel, so it
     arrives as a sheet instead. Same body either way. -->
<Sheet.Root bind:open>
  <Sheet.Content class="p-0">
    <Sheet.Title class="sr-only">Activity</Sheet.Title>
    <Sheet.Description class="sr-only">Every sync, order and change</Sheet.Description>
    <ActivityPanel />
  </Sheet.Content>
</Sheet.Root>
