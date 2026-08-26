import { tv, type VariantProps } from "tailwind-variants";
import Root from "./badge.svelte";

export const badgeVariants = tv({
  base: "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground shadow",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      destructive: "border-transparent bg-destructive/10 text-destructive",
      success: "border-transparent bg-success/10 text-success",
      warning: "border-transparent bg-warning/10 text-warning",
      outline: "text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});
export type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];
export { Root, Root as Badge };
