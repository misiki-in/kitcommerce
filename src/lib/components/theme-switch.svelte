<script lang="ts">
  import Sun from "@lucide/svelte/icons/sun";
  import Moon from "@lucide/svelte/icons/moon";
  import Monitor from "@lucide/svelte/icons/monitor";
  import { theme, type ThemePref } from "$lib/theme.svelte";

  /**
   * The theme control.
   *
   * A segmented control rather than three menu rows or a two-way switch. All
   * three states are visible at once, the current one is obvious without
   * reading, and any of them is one click away — which matters because this is
   * a setting people flick back and forth at dusk, not one they set once.
   *
   * Kept deliberately small. It sits in an account menu between Store settings
   * and Sign out, where it is the least important thing on offer; an earlier
   * pass stacked the icon above the label and gave the control more height than
   * the two links it sits between, which is the wrong order of importance for a
   * preference nobody opens this menu to change. One row, small type, and the
   * resolved value tucked up beside the heading instead of on its own line.
   *
   * The selected segment fills with gold. That is the one colour in the palette
   * that does not change between the two themes, so the control that switches
   * them is marked in the thing that stays put.
   *
   * Plain names on purpose. The palette calls these limewash and peacock and
   * the label could too, but nobody scanning a menu for the dark-mode switch
   * would recognise either word. A label labels.
   */
  const OPTIONS: Array<{ value: ThemePref; label: string; icon: typeof Sun }> = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  let buttons = $state<HTMLButtonElement[]>([]);

  /**
   * Left and right move within the control; up and down still belong to the
   * menu around it. Without stopPropagation the arrow key would do both —
   * change the theme and jump the menu's highlight to Sign out.
   */
  function onKeydown(event: KeyboardEvent, index: number) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();

    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    theme.set(OPTIONS[next]!.value);
    buttons[next]?.focus();
  }
</script>

<div class="px-2 py-1">
  <div class="mb-1 flex items-baseline justify-between gap-2">
    <p class="board-label text-[0.5rem] text-muted-foreground">Theme</p>
    <!--
      What "System" currently resolves to. Beside the heading rather than on a
      line of its own: it is a footnote, and a footnote should not cost the
      control a third of its height.
    -->
    {#if theme.pref === "system"}
      <span class="text-[0.58rem] leading-none text-muted-foreground/70">
        {theme.resolved}
      </span>
    {/if}
  </div>

  <div
    role="radiogroup"
    aria-label="Theme"
    class="grid grid-cols-3 gap-px rounded bg-muted p-px"
  >
    {#each OPTIONS as option, i (option.value)}
      {@const active = theme.pref === option.value}
      <button
        bind:this={buttons[i]}
        type="button"
        role="radio"
        aria-checked={active}
        tabindex={active ? 0 : -1}
        onclick={() => theme.set(option.value)}
        onkeydown={(e) => onKeydown(e, i)}
        class="flex items-center justify-center gap-1 rounded-[3px] px-1 py-1 text-[0.6rem] font-medium leading-none transition-colors
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
               focus-visible:ring-offset-popover
               {active
                 ? 'bg-primary text-primary-foreground'
                 : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}"
      >
        <option.icon class="size-3 shrink-0" />
        {option.label}
      </button>
    {/each}
  </div>
</div>
