<script lang="ts">
  import "../app.css";
  import Toaster from "$lib/components/toaster.svelte";
  import { theme } from "$lib/theme.svelte";

  let { children }: { children?: any } = $props();

  /**
   * Follow the OS setting while the app is open, not just at load. Someone on
   * "system" whose machine flips to dark at sunset should see the app flip with
   * it rather than on their next navigation. Torn down with the layout, which
   * is to say never in practice — but it is not this file's business to assume
   * that.
   */
  $effect(() => theme.watchSystem());
</script>

<!--
  The document shell, and nothing else.
  The signed-in app carries its own chrome under /dash; /login has none by
  design. Keeping this layer empty is what lets both stop inspecting the
  pathname to work out which of the two they are.
-->
{@render children?.()}

<!-- Global on purpose: a toast can outlive the page that raised it. -->
<Toaster />
