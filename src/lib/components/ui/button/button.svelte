<script lang="ts">
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  import { buttonVariants, type ButtonSize, type ButtonVariant } from "./index";

  type Props = (HTMLButtonAttributes & HTMLAnchorAttributes) & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    href?: string;
    class?: string;
  };

  let {
    class: className,
    variant = "default",
    size = "default",
    href = undefined,
    type = "button",
    children,
    ...rest
  }: Props = $props();
</script>

<!--
  One component renders both the <a> and the <button> form, so a link that
  looks like a button and a real button are guaranteed to share every state:
  hover, focus ring, disabled, icon sizing.
-->
{#if href}
  <a {href} class={cn(buttonVariants({ variant, size }), className)} {...rest}>
    {@render children?.()}
  </a>
{:else}
  <button {type} class={cn(buttonVariants({ variant, size }), className)} {...rest}>
    {@render children?.()}
  </button>
{/if}
