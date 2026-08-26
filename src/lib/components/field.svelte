<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { cn } from "$lib/utils";

  /**
   * The one field component every form uses.
   *
   * Having a single component is what makes "all components behave the same"
   * true rather than aspirational: label association, the required marker,
   * help text, error state and the floating-label motion are defined once
   * here, so no form can drift.
   */
  type Props = HTMLInputAttributes & {
    label: string;
    name: string;
    help?: string;
    error?: string;
    textarea?: boolean;
    rows?: number;
    class?: string;
  };

  let {
    label,
    name,
    help = "",
    error = "",
    textarea = false,
    rows = 4,
    required = false,
    value = $bindable(""),
    class: className,
    ...rest
  }: Props = $props();

  const id = `f-${name.replace(/[^a-z0-9]/gi, "-")}`;
</script>

<div class={cn("group relative", className)}>
  {#if textarea}
    <textarea
      {id}
      {name}
      {required}
      {rows}
      bind:value
      placeholder=" "
      class={cn(
        "peer flex w-full rounded-md border bg-transparent px-3 pb-1.5 pt-5 text-sm shadow-sm transition-colors",
        "placeholder:text-transparent focus:placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        error ? "border-destructive" : "border-input",
      )}
      {...rest}
    ></textarea>
  {:else}
    <Input
      {id}
      {name}
      {required}
      bind:value
      placeholder=" "
      class={cn(
        "peer h-auto pb-1.5 pt-5",
        "placeholder:text-transparent focus:placeholder:text-muted-foreground",
        error && "border-destructive",
      )}
      {...rest}
    />
  {/if}

  <!--
    The label floats out of the control on focus or once there is a value.
    :placeholder-shown is what detects "empty", which is why every control
    above carries placeholder=" ".
  -->
  <Label
    for={id}
    class="pointer-events-none absolute left-3 top-3.5 origin-top-left text-sm font-normal text-muted-foreground
           transition-transform duration-150 ease-out
           peer-focus:-translate-y-2.5 peer-focus:scale-[0.78] peer-focus:text-foreground
           peer-[:not(:placeholder-shown)]:-translate-y-2.5 peer-[:not(:placeholder-shown)]:scale-[0.78]
           peer-autofill:-translate-y-2.5 peer-autofill:scale-[0.78]"
  >
    {label}{#if required}<span class="ml-0.5 text-destructive">*</span>{/if}
  </Label>

  {#if error}
    <p class="mt-1.5 text-xs text-destructive">{error}</p>
  {:else if help}
    <p class="mt-1.5 text-xs text-muted-foreground">{help}</p>
  {/if}
</div>
