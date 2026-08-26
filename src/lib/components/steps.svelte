<script lang="ts">
  import Check from "@lucide/svelte/icons/check";
  import { cn } from "$lib/utils";

  type Step = { key: string; label: string; href?: string };
  let { steps, current, class: className }: { steps: Step[]; current: string; class?: string } = $props();

  const idx = $derived(steps.findIndex((s) => s.key === current));
</script>

<!--
  Every step with an href is clickable in both directions. The record already
  exists by this point and each step is a partial save, so jumping ahead is
  safe — and linking only completed steps made the later ones look enabled
  while doing nothing.
-->
<ol class={cn("mb-6 flex flex-wrap items-center gap-1.5", className)}>
  {#each steps as step, i (step.key)}
    {@const state = i < idx ? "done" : i === idx ? "on" : "todo"}
    <li>
      <svelte:element
        this={step.href && i !== idx ? "a" : "span"}
        href={step.href}
        aria-current={state === "on" ? "step" : undefined}
        class="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors
               {state === 'on'
                 ? 'bg-primary text-primary-foreground'
                 : state === 'done'
                   ? 'text-success hover:bg-secondary'
                   : 'text-muted-foreground'}
               {step.href && i !== idx ? 'hover:no-underline' : ''}"
      >
        <span
          class="grid size-4 place-items-center rounded-full text-[10px]
                 {state === 'on'
                   ? 'bg-primary-foreground text-primary'
                   : state === 'done'
                     ? 'bg-success text-success-foreground'
                     : 'border'}"
        >
          {#if state === "done"}<Check class="size-2.5" />{:else}{i + 1}{/if}
        </span>
        {step.label}
      </svelte:element>
    </li>
    {#if i < steps.length - 1}
      <li aria-hidden="true" class="h-px w-4 bg-border"></li>
    {/if}
  {/each}
</ol>
