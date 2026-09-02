<script lang="ts">
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { toast } from "$lib/toast.svelte";
  import StorefrontSection from "./components/StorefrontSection.svelte";
  import CompanySection from "./components/CompanySection.svelte";
  import LocationsSection from "./components/LocationsSection.svelte";
  import LocationDialog from "./components/LocationDialog.svelte";
  import SourceSection from "./components/SourceSection.svelte";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();

  type Location = PageServerData["locations"][number];
  type SectionKey = "storefront" | "company" | "locations" | "source";

  const SAVED_LABEL: Record<string, string> = {
    storefront: "Storefront saved",
    company: "Company details saved",
    location: "Pickup location saved",
    litekart: "Catalogue source updated",
  };

  // Surface action results as toasts.
  $effect(() => {
    if (form?.saved) toast.success(SAVED_LABEL[form.saved] ?? "Saved");
    else if (form?.error) toast.error(form.error);
  });

  const queryTab = page.url.searchParams.get("tab") as SectionKey | null;
  let section = $state<SectionKey>(
    queryTab && ["storefront", "company", "locations", "source"].includes(queryTab)
      ? queryTab
      : "storefront",
  );

  function setSection(key: SectionKey) {
    section = key;
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    goto(url.toString(), { replaceState: true, noScroll: true, keepFocus: true });
  }

  let editing = $state<Location | null>(null);
  let dialogOpen = $state(false);

  function newLocation() {
    editing = null;
    dialogOpen = true;
  }

  function editLocation(l: Location) {
    editing = l;
    dialogOpen = true;
  }

  const done = $derived({
    storefront: Boolean(data.store.name && data.store.support_email),
    company: Boolean(
      data.store.legal_name && data.store.tax_id && data.store.address_line1 && data.store.city,
    ),
    locations: data.locations.length > 0,
    source: data.litekart.connected,
  });

  const SECTIONS: Array<{ key: SectionKey; label: string; hint: string }> = [
    { key: "storefront", label: "Storefront", hint: "How buyers see you" },
    { key: "company", label: "Company", hint: "Identity, address, payouts" },
    { key: "locations", label: "Pickup locations", hint: "Where couriers collect" },
    { key: "source", label: "Catalogue source", hint: "Import from Litekart" },
  ];
</script>

<svelte:head><title>Store · OpenCommerce</title></svelte:head>

<div class="mb-6">
  <h1 class="board text-[1.6rem]">Store</h1>
  <p class="text-sm text-muted-foreground">
    Your storefront, company identity and dispatch addresses
  </p>
</div>

<div class="flex flex-col gap-8 lg:flex-row">
  <!-- Sidebar -->
  <nav class="w-full shrink-0 lg:w-56">
    <ul class="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {#each SECTIONS as item (item.key)}
        <li class="shrink-0 lg:shrink">
          <button
            type="button"
            onclick={() => setSection(item.key)}
            class="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors
                   {section === item.key ? 'bg-secondary' : 'hover:bg-secondary/60'}"
          >
            <span
              class="size-1.5 shrink-0 rounded-full {done[item.key]
                ? 'bg-success'
                : item.key === 'source'
                  ? 'bg-muted-foreground/30'
                  : 'bg-warning'}"
              title={done[item.key]
                ? 'Connected'
                : item.key === 'source'
                  ? 'Optional'
                  : 'Incomplete'}
            ></span>
            <span class="min-w-0">
              <span class="block text-sm font-medium">{item.label}</span>
              <span class="hidden text-xs text-muted-foreground lg:block">{item.hint}</span>
            </span>
          </button>
        </li>
      {/each}
    </ul>
  </nav>

  <!-- Content Section -->
  <div class="min-w-0 flex-1 space-y-6">
    {#if section === "storefront"}
      <StorefrontSection store={data.store} />
    {:else if section === "company"}
      <CompanySection store={data.store} bank={data.bank} />
    {:else if section === "locations"}
      <LocationsSection
        locations={data.locations}
        onAdd={newLocation}
        onEdit={editLocation}
      />
    {:else if section === "source"}
      <SourceSection litekart={data.litekart} {form} />
    {/if}
  </div>
</div>

<LocationDialog bind:open={dialogOpen} {editing} />
