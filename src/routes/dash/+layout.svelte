<script lang="ts">
  import { page, navigating } from "$app/state";
  import { fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { Avatar } from "$lib/components/ui/avatar";
  import ActivityDrawer from "$lib/components/activity-drawer.svelte";
  import ActivityPanel from "$lib/components/activity-panel.svelte";
  import ThemeSwitch from "$lib/components/theme-switch.svelte";
  import House from "@lucide/svelte/icons/house";
  import Package from "@lucide/svelte/icons/package";
  import ArrowLeftRight from "@lucide/svelte/icons/arrow-left-right";
  import ShoppingBag from "@lucide/svelte/icons/shopping-bag";
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Store from "@lucide/svelte/icons/store";
  import Plug from "@lucide/svelte/icons/plug";
  import LogOut from "@lucide/svelte/icons/log-out";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import { releaseNotice } from "$lib/release-notice.svelte";
  import type { LayoutServerData } from "./$types";

  /**
   * The signed-in app.
   *
   * Everything below /dash is behind the session check in hooks.server.ts, so
   * this layout never has to ask whether it should be drawing chrome — that
   * question is answered by which side of /dash the route lives on.
   */
  let { data, children }: { data: LayoutServerData; children?: any } = $props();

  /**
   * Places you go. Activity is not one of them — it is something you glance
   * at, so it lives in the rail and behind the header button beside the
   * account menu rather than in a row reserved for destinations. Channels and
   * Store are setup screens you visit occasionally, so they sit in the account
   * menu instead of competing for space with the things you open every day.
   */
  const NAV = [
    { href: "/dash", label: "Overview", icon: House },
    { href: "/dash/products", label: "Products", icon: Package },
    { href: "/dash/orders", label: "Orders", icon: ShoppingBag },
    { href: "/dash/channels", label: "Channels", icon: Plug },
  ];

  let activityOpen = $state(false);

  // Overview is the index, so it matches exactly; everything else owns its
  // subtree. Prefix-matching the index would light it up on every page.
  const isActive = (href: string) =>
    href === "/dash" ? page.url.pathname === "/dash" : page.url.pathname.startsWith(href);

  /**
   * Transitions are keyed on the pathname so Svelte tears down and rebuilds
   * the block on navigation. Kept deliberately small — 8px and 150ms — because
   * this is a tool people use all day: enough to signal "the page changed",
   * not enough to wait for. Anything longer starts to feel like latency.
   */
  const MOTION = { duration: 150, y: 8, easing: cubicOut };

  /** Respect the OS setting; no motion at all when it is set. */
  let reduced = $state(false);
  $effect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reduced = mq.matches;
    const onChange = (e: MediaQueryListEvent) => (reduced = e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  });

  /** Store initial, falling back to the account email. */
  const initials = $derived(
    (data.store?.name ?? data.user.name ?? data.user.email ?? "?").trim().charAt(0).toUpperCase(),
  );
</script>

<div class="min-h-screen">
  <header class="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
    <div class="flex h-14 items-center gap-4 px-4 sm:gap-6 sm:px-6">
      <a href="/dash" class="flex shrink-0 items-center gap-2 font-semibold">
        <img src="/logo.svg" alt="" width="26" height="26" />
        <span class="board hidden text-[1rem] sm:inline">OpenCommerce</span>
      </a>

      <!-- Desktop only: on a phone this row is the first thing to overflow,
           so navigation moves to a bottom bar instead. -->
      <nav class="hidden flex-1 items-center gap-1 sm:flex">
        {#each NAV as item (item.href)}
          {@const active = isActive(item.href)}
          <a
            href={item.href}
            class="rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors {active
              ? 'bg-secondary text-secondary-foreground'
              : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'}"
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </a>
        {/each}
      </nav>

      <!-- ml-auto rather than leaning on the flex-1 above: below sm that nav
           is display:none, and without this the account menu would collapse
           back against the logo. -->
      <div class="ml-auto flex shrink-0 items-center gap-1">
        <!--
          Activity, one click from anywhere. From xl up the rail is already
          on screen, so the button retires rather than opening a second copy
          of what you are already looking at.
        -->
        <button
          type="button"
          onclick={() => (activityOpen = true)}
          class="grid size-9 place-items-center rounded-full text-muted-foreground transition-colors
                 hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2
                 focus-visible:ring-ring focus-visible:ring-offset-2 xl:hidden"
          aria-label="Activity"
          title="Activity"
          aria-haspopup="dialog"
          aria-expanded={activityOpen}
        >
          <ArrowLeftRight class="size-4.5" />
        </button>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class="flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-secondary
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="Account menu"
            title="Account menu"
          >
            <!--
              The badge rides the avatar because the menu is the only way to
              reach the notes, and a dot inside a closed menu notifies nobody.
              It is a presentation detail on a control that already has a
              label, so it is aria-hidden — the menu item itself carries the
              announcement.
            -->
            <span class="relative">
              <Avatar src={data.store?.logoUrl ?? ""} alt="" fallback={initials} />
              {#if releaseNotice.unread}
                <span
                  class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-primary"
                  aria-hidden="true"
                ></span>
              {/if}
            </span>
            <ChevronDown class="size-3.5 text-muted-foreground" />
          </DropdownMenu.Trigger>

          <DropdownMenu.Content>
            <DropdownMenu.Label>
              <span class="block truncate text-sm font-medium">
                {data.store?.name ?? (data.user.name || "Your store")}
              </span>
              <span class="block truncate text-xs font-normal text-muted-foreground">
                {data.user.email}
              </span>
            </DropdownMenu.Label>
            <DropdownMenu.Separator />

            <DropdownMenu.Item>
              {#snippet child({ props })}
                <a href="/dash/channels" {...props}><Plug /> Channels</a>
              {/snippet}
            </DropdownMenu.Item>
            <DropdownMenu.Item>
              {#snippet child({ props })}
                <a href="/dash/settings" {...props}><Store /> Store settings</a>
              {/snippet}
            </DropdownMenu.Item>
            <DropdownMenu.Item>
              {#snippet child({ props })}
                <a href="/dash/releases" {...props}>
                  <Sparkles /> Releases
                  {#if releaseNotice.unread}
                    <!-- The version, not the word "new": it answers what
                         changed and which build you are on in one token, and
                         it is what someone reports when they file a bug. -->
                    <span
                      class="ml-auto rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary-foreground"
                    >
                      {releaseNotice.version}
                    </span>
                  {/if}
                </a>
              {/snippet}
            </DropdownMenu.Item>

            <DropdownMenu.Separator />

            <!--
              Not a DropdownMenu.Item: an item closes the menu on select, and
              closing the menu is exactly wrong here — you want to see the theme
              change while the control is still under your cursor.
            -->
            <ThemeSwitch />

            <DropdownMenu.Separator />

            <DropdownMenu.Item destructive>
              {#snippet child({ props })}
                <!-- Sign-out stays a POST: a GET link would let any page log you out. -->
                <form method="POST" action="/logout" class="contents">
                  <button type="submit" {...props}><LogOut /> Sign out</button>
                </form>
              {/snippet}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    </div>
  </header>

  <!--
    A thin progress bar for navigations slow enough to notice. SvelteKit
    resolves most of these in a few ms, so it only ever appears when there is
    real waiting to explain.
  -->
  {#if navigating.to}
    <div
      class="fixed inset-x-0 top-0 z-50 h-0.5 origin-left animate-[nav-progress_1.2s_ease-out_forwards] bg-primary"
    ></div>
  {/if}

  <!--
    Full-width shell. On xl and above the activity feed is a permanent rail
    rather than a drawer: it is the thing you glance at while working, so it
    should not need opening. Below xl the same panel arrives as a sheet.
  -->
  <div class="flex">
    <!-- pb-24 clears the fixed bottom bar on phones. -->
    <main class="min-w-0 flex-1 px-4 pb-24 pt-6 sm:px-6 sm:py-8">
      {#key page.url.pathname}
        <div
          in:fly={{
            y: reduced ? 0 : MOTION.y,
            duration: reduced ? 0 : MOTION.duration,
            easing: MOTION.easing,
          }}
        >
          {@render children?.()}
        </div>
      {/key}
    </main>

    <aside
      class="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-80 shrink-0 flex-col border-l bg-card/40 xl:flex"
      aria-label="Activity"
    >
      <ActivityPanel autoRefreshOnNavigate />
    </aside>
  </div>

  <!--
    Mobile navigation. A bottom bar is reachable by thumb and, unlike a
    horizontally scrolling top row, cannot push the page sideways.
  -->
  <nav
    class="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur sm:hidden"
    style="padding-bottom: env(safe-area-inset-bottom)"
  >
    <ul class="grid grid-cols-4">
      {#each NAV as item (item.href)}
        {@const active = isActive(item.href)}
        <li>
          <a
            href={item.href}
            class="flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors hover:no-underline
                   {active ? 'text-foreground' : 'text-muted-foreground'}"
            aria-current={active ? "page" : undefined}
          >
            <item.icon class="size-5" />
            {item.label}
          </a>
        </li>
      {/each}
    </ul>
  </nav>

  <ActivityDrawer bind:open={activityOpen} />
</div>
