import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn's `cn`: merge conditional classes, with later Tailwind utilities
 * beating earlier ones of the same kind. This is what lets a caller pass
 * `class="w-full"` and have it actually win over a component default.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
  ref?: U | null;
};
