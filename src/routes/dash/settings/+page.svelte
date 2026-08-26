<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Label } from "$lib/components/ui/label";
  import * as Dialog from "$lib/components/ui/dialog";
  import Field from "$lib/components/field.svelte";
  import ConfirmButton from "$lib/components/confirm-button.svelte";
  import { toast } from "$lib/toast.svelte";
  import Lock from "@lucide/svelte/icons/lock";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Plus from "@lucide/svelte/icons/plus";
  import Check from "@lucide/svelte/icons/check";
  import Download from "@lucide/svelte/icons/download";
  import BookOpen from "@lucide/svelte/icons/book-open";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();

  type Location = PageServerData["locations"][number];

  let importing = $state(false);

  // Surface every action result as a toast.
  $effect(() => {
    if (form?.saved) toast.success(SAVED_LABEL[form.saved] ?? "Saved");
    else if (form?.error) toast.error(form.error);
  });

  const SAVED_LABEL: Record<string, string> = {
    storefront: "Storefront saved",
    company: "Company details saved",
    location: "Pickup location saved",
    litekart: "Catalogue source updated",
  };
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

  const BUSINESS_TYPES = [
    { value: "", label: "Select…" },
    { value: "sole_proprietorship", label: "Sole proprietorship" },
    { value: "partnership", label: "Partnership" },
    { value: "llp", label: "LLP" },
    { value: "private_limited", label: "Private limited" },
    { value: "public_limited", label: "Public limited" },
    { value: "individual", label: "Individual" },
  ];

  const CURRENCIES = [
    { value: "INR", label: "INR — Indian Rupee" },
    { value: "USD", label: "USD — US Dollar" },
    { value: "GBP", label: "GBP — Pound Sterling" },
    { value: "EUR", label: "EUR — Euro" },
    { value: "AED", label: "AED — UAE Dirham" },
  ];

  type SectionKey = "storefront" | "company" | "locations" | "source";
  let section = $state<SectionKey>("storefront");

  /**
   * Which sections are actually finished. Shown as a dot in the sidebar so a
   * seller can see at a glance what still blocks a marketplace listing,
   * instead of scrolling three long forms to find out.
   */
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

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  function addressOf(l: Location): string {
    return [l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country]
      .filter(Boolean)
      .join(", ");
  }
</script>

<svelte:head><title>Store · OpenCommerce</title></svelte:head>

<div class="mb-6">
  <h1 class="board text-[1.6rem]">Store</h1>
  <p class="text-sm text-muted-foreground">
    Your storefront, company identity and dispatch addresses
  </p>
</div>

<!-- Save feedback is a toast now: a banner at the top of a long settings
     page appears where you are not looking and pushes the form down. -->

<div class="flex flex-col gap-8 lg:flex-row">
  <!-- Sidebar: one section at a time beats three long forms stacked, and the
       dots say what is still incomplete without opening anything. -->
  <nav class="w-full shrink-0 lg:w-56">
    <ul class="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {#each SECTIONS as item (item.key)}
        <li class="shrink-0 lg:shrink">
          <button
            type="button"
            onclick={() => (section = item.key)}
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

  <div class="min-w-0 flex-1 space-y-6">
  <!-- ── storefront ───────────────────────────────────────────────────── -->
  {#if section === "storefront"}
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Storefront</CardTitle>
      <CardDescription>How buyers see you.</CardDescription>
    </CardHeader>
    <CardContent>
      <form method="POST" action="?/storefront" enctype="multipart/form-data" class="space-y-4" use:enhance>
        <Field label="Store name" name="name" required value={data.store.name} />
        <Field
          label="Description"
          name="description"
          textarea
          rows={3}
          value={data.store.description}
          help="Used as your seller blurb where marketplaces show one."
        />

        <div>
          <Label class="mb-2 block">Store logo</Label>
          <div class="flex items-center gap-4">
            {#if data.store.logo_url}
              <img src={data.store.logo_url} alt="" class="size-14 rounded-xl border object-cover" />
            {:else}
              <span class="size-14 rounded-xl border border-dashed"></span>
            {/if}
            <input
              type="file"
              name="logo_file"
              accept="image/*"
              class="text-sm file:mr-3 file:rounded-md file:border file:bg-secondary file:px-3 file:py-1.5 file:text-sm"
            />
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <Field label="Support email" name="support_email" type="email" value={data.store.support_email} />
          <Field label="Support phone" name="support_phone" value={data.store.support_phone} />
        </div>
        <Field label="Website" name="website" value={data.store.website} placeholder="https://" />

        <Button type="submit">Save storefront</Button>
      </form>
    </CardContent>
  </Card>
  {/if}

  <!-- ── company: identity + registered address + bank ────────────────── -->
  {#if section === "company"}
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Company</CardTitle>
      <CardDescription>
        Marketplaces verify this against your tax registration before a listing goes live.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <form method="POST" action="?/company" class="space-y-4" use:enhance>
        <Field
          label="Registered legal name"
          name="legal_name"
          value={data.store.legal_name}
          help="Must match your GST or tax registration exactly"
        />

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <Label for="business_type" class="mb-1.5 block">Business type</Label>
            <select id="business_type" name="business_type" class={selectClass}>
              {#each BUSINESS_TYPES as opt (opt.value)}
                <option value={opt.value} selected={opt.value === data.store.business_type}>
                  {opt.label}
                </option>
              {/each}
            </select>
          </div>
          <div>
            <Label for="currency" class="mb-1.5 block">Currency</Label>
            <select id="currency" name="currency" class={selectClass}>
              {#each CURRENCIES as opt (opt.value)}
                <option value={opt.value} selected={opt.value === data.store.currency}>{opt.label}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <Field label="Tax ID / GSTIN" name="tax_id" value={data.store.tax_id} placeholder="29AABCM1234R1ZX" />
          <Field label="Registration no." name="registration_no" value={data.store.registration_no} placeholder="CIN / UDYAM" />
        </div>

        <!-- registered address -->
        <fieldset class="rounded-lg border bg-muted/40 p-4">
          <legend class="px-1.5 board-label text-[0.62rem] text-muted-foreground">
            Registered address
          </legend>
          <p class="mb-4 text-xs text-muted-foreground">
            The address on your incorporation or GST certificate. Goods are collected from a pickup
            location, not from here.
          </p>
          <div class="space-y-4">
            <Field label="Address line 1" name="address_line1" value={data.store.address_line1} />
            <Field label="Address line 2" name="address_line2" value={data.store.address_line2} />
            <div class="grid gap-4 sm:grid-cols-3">
              <Field label="City" name="city" value={data.store.city} />
              <Field label="State" name="state" value={data.store.state} />
              <Field label="Postal code" name="postal_code" value={data.store.postal_code} />
            </div>
            <Field label="Country" name="country" value={data.store.country || "IN"} />
          </div>
        </fieldset>

        <!-- bank -->
        <fieldset class="rounded-lg border bg-muted/40 p-4">
          <legend class="flex items-center gap-2 px-1.5">
            <span class="board-label text-[0.62rem] text-muted-foreground">
              Bank account
            </span>
            <Badge variant="success"><Lock class="mr-1 size-3" /> encrypted</Badge>
          </legend>
          <p class="mb-4 text-xs text-muted-foreground">
            Where marketplaces settle your payouts. Sealed with the same AES-256-GCM encryption as
            your marketplace API keys and never returned by the API — the account number is masked
            even for you.
          </p>
          <div class="space-y-4">
            <Field label="Account holder name" name="bank_account_name" value={data.bank.account_name} />
            <div class="grid gap-4 sm:grid-cols-2">
              <Field label="Bank name" name="bank_name" value={data.bank.bank_name} />
              <Field label="Branch" name="bank_branch" value={data.bank.branch} />
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <Field
                label="Account number"
                name="bank_account_number"
                autocomplete="off"
                placeholder={data.bank.accountMask}
                help={data.bank.accountMask ? "Stored. Type a new number to replace it." : ""}
              />
              <Field label="IFSC / SWIFT" name="bank_ifsc" autocomplete="off" value={data.bank.ifsc} />
            </div>
            <Field label="UPI ID" name="bank_upi" value={data.bank.upi} placeholder="name@bank" />
          </div>
        </fieldset>

        <Button type="submit">Save company details</Button>
      </form>
    </CardContent>
  </Card>
  {/if}

  <!-- ── pickup locations ─────────────────────────────────────────────── -->
  {#if section === "locations"}
  <Card>
    <CardHeader class="flex-row items-start justify-between space-y-0">
      <div>
        <CardTitle class="text-base">Pickup locations</CardTitle>
        <CardDescription>Where couriers collect. A seller often has more than one.</CardDescription>
      </div>
      <Button variant="outline" size="sm" onclick={newLocation}><Plus /> Add location</Button>
    </CardHeader>
    <CardContent>
      {#if data.locations.length}
        <ul class="divide-y">
          {#each data.locations as location (location.id)}
            <li class="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
              <MapPin class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium">{location.label}</span>
                  {#if location.is_default}<Badge variant="success">default</Badge>{/if}
                </div>
                <p class="text-xs text-muted-foreground">{addressOf(location)}</p>
                {#if location.contact_name || location.contact_phone}
                  <p class="text-xs text-muted-foreground">
                    {[location.contact_name, location.contact_phone].filter(Boolean).join(" · ")}
                  </p>
                {/if}
              </div>
              <div class="flex shrink-0 gap-1.5">
                <Button variant="outline" size="sm" onclick={() => editLocation(location)}>Edit</Button>
                <ConfirmButton
                  action="?/deleteLocation"
                  title="Remove {location.label}?"
                  consequence={location.is_default
                    ? "This is your default pickup location. Marketplaces that do not name one will have nowhere to send a courier until you set another."
                    : "Couriers will no longer be routed to this address."}
                  confirmLabel="Remove location"
                  fields={{ id: location.id }}
                />
              </div>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="py-8 text-center text-sm text-muted-foreground">
          No pickup location yet. Marketplaces need one before they will schedule a courier.
        </p>
      {/if}
    </CardContent>
  </Card>
  {/if}

  <!-- ── catalogue source (Litekart) ──────────────────────────────────── -->
  {#if section === "source"}
  <Card>
    <CardHeader>
      <CardTitle class="text-base">Catalogue source</CardTitle>
      <CardDescription>
        Import products from an existing store instead of typing them in. Litekart is a
        <strong>platform adapter</strong>, not a sales channel — products flow <em>in</em> from it,
        then out to your marketplaces.
      </CardDescription>
    </CardHeader>
    <CardContent>
      {#if data.litekart.connected}
        <div class="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
          <Check class="size-4 shrink-0 text-success" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">Connected to Litekart</p>
            <p class="truncate font-mono text-xs text-muted-foreground">{data.litekart.baseUrl}</p>
          </div>
          <Badge variant="secondary">
            {data.litekart.importedCount} product{data.litekart.importedCount === 1 ? "" : "s"} imported
          </Badge>
        </div>

        <div class="mb-6 flex flex-wrap gap-2">
          <form
            method="POST"
            action="?/importLitekart"
            use:enhance={() => {
              importing = true;
              return async ({ update }) => {
                await update();
                importing = false;
              };
            }}
          >
            <Button type="submit" disabled={importing}>
              {#if importing}<LoaderCircle class="animate-spin" />{:else}<Download />{/if}
              {importing ? "Importing…" : "Import catalogue"}
            </Button>
          </form>
          <ConfirmButton
            action="?/disconnectLitekart"
            label="Disconnect"
            size="default"
            title="Disconnect Litekart?"
            consequence="Already-imported products stay in your catalogue. Only the stored connection is removed, so further imports stop until you reconnect."
            confirmLabel="Disconnect"
          />
        </div>

        {#if form?.imported}
          <Alert variant="success" class="mb-6">
            <AlertDescription>
              {form.imported.created} created · {form.imported.updated} updated ·
              {form.imported.unchanged} unchanged. Imported products land as
              <strong>drafts</strong> — review them, then publish.
            </AlertDescription>
          </Alert>
        {/if}
      {/if}

      <!-- instructions live beside the fields, not behind a docs link -->
      <div class="mb-5 rounded-lg border bg-muted/40 p-4">
        <p class="mb-3 flex items-center gap-2 board-label text-[0.62rem] text-muted-foreground">
          <BookOpen class="size-3.5" /> Where to find these
        </p>
        <ol class="space-y-2 text-sm">
          <li class="flex gap-2.5">
            <span class="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">1</span>
            <span>Sign in to your Litekart admin.</span>
          </li>
          <li class="flex gap-2.5">
            <span class="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">2</span>
            <span>
              Open <strong>Settings → API</strong> and create an API key with read access to
              products. A read-only key is enough — OpenCommerce never writes back to Litekart.
            </span>
          </li>
          <li class="flex gap-2.5">
            <span class="grid size-5 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">3</span>
            <span>
              Copy your store URL (the admin origin, e.g. <code class="rounded bg-background px-1 py-0.5 text-xs">https://yourstore.litekart.in</code>)
              and paste both below.
            </span>
          </li>
        </ol>
        <p class="mt-3 text-xs text-muted-foreground">
          The key is sealed with AES-256-GCM before it is stored, exactly like your marketplace
          credentials, and is never returned by the API. We verify the connection before saving,
          so a wrong URL or key fails here rather than silently at the first import.
        </p>
      </div>

      <form method="POST" action="?/connectLitekart" class="space-y-4" use:enhance>
        <Field
          label="Store URL"
          name="base_url"
          required
          value={data.litekart.baseUrl}
          placeholder="https://yourstore.litekart.in"
          help="The origin only — no trailing path."
        />
        <Field
          label="API key"
          name="api_token"
          type="password"
          autocomplete="off"
          placeholder={data.litekart.hasToken ? "•••••••••••• stored" : ""}
          help={data.litekart.hasToken ? "Stored. Leave blank to keep it, or type a new key." : ""}
        />
        <Button type="submit">
          {data.litekart.connected ? "Update connection" : "Connect Litekart"}
        </Button>
      </form>
    </CardContent>
  </Card>
  {/if}
  </div>
</div>

<!-- one dialog, reused for add and edit -->
<Dialog.Root bind:open={dialogOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>{editing ? "Edit pickup location" : "Add pickup location"}</Dialog.Title>
      <Dialog.Description>Couriers collect from here.</Dialog.Description>
    </Dialog.Header>

    <form
      method="POST"
      action="?/location"
      class="space-y-4"
      use:enhance={() => {
        return async ({ update }) => {
          await update();
          dialogOpen = false;
        };
      }}
    >
      {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
      <Field label="Label" name="label" required value={editing?.label ?? ""} placeholder="Main warehouse" />
      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Contact name" name="contact_name" value={editing?.contact_name ?? ""} />
        <Field label="Contact phone" name="contact_phone" value={editing?.contact_phone ?? ""} />
      </div>
      <Field label="Address line 1" name="address_line1" required value={editing?.address_line1 ?? ""} />
      <Field label="Address line 2" name="address_line2" value={editing?.address_line2 ?? ""} />
      <div class="grid gap-4 sm:grid-cols-3">
        <Field label="City" name="city" value={editing?.city ?? ""} />
        <Field label="State" name="state" value={editing?.state ?? ""} />
        <Field label="Postal code" name="postal_code" value={editing?.postal_code ?? ""} />
      </div>
      <Field label="Country" name="country" value={editing?.country ?? "IN"} />

      <label class="flex cursor-pointer items-start gap-2.5 rounded-lg border p-3">
        <input type="checkbox" name="is_default" value="1" checked={!!editing?.is_default} class="mt-0.5" />
        <span>
          <span class="block text-sm font-medium">Default pickup location</span>
          <span class="block text-xs text-muted-foreground">
            Used whenever a marketplace does not specify one.
          </span>
        </span>
      </label>

      <Dialog.Footer>
        <Button type="button" variant="outline" onclick={() => (dialogOpen = false)}>Cancel</Button>
        <Button type="submit">{editing ? "Save location" : "Add location"}</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
