<script lang="ts">
  import type { HTMLAttributes } from "svelte/elements";
  import { cn } from "$lib/utils";
  import { tv, type VariantProps } from "tailwind-variants";
  const alertVariants = tv({
    base: "relative w-full rounded-lg border px-4 py-3 text-sm [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7",
    variants: {
      variant: {
        default: "bg-card text-card-foreground",
        destructive: "border-destructive/40 bg-destructive/5 text-destructive [&>svg]:text-destructive",
        success: "border-success/40 bg-success/5 text-success [&>svg]:text-success",
        warning: "border-warning/40 bg-warning/5 text-warning [&>svg]:text-warning",
      },
    },
    defaultVariants: { variant: "default" },
  });
  type Variant = VariantProps<typeof alertVariants>["variant"];
  let { class: className, variant = "default", children, ...rest }:
    HTMLAttributes<HTMLDivElement> & { class?: string; variant?: Variant } = $props();
</script>
<div role="alert" class={cn(alertVariants({ variant }), className)} {...rest}>{@render children?.()}</div>
