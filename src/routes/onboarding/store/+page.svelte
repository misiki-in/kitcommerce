<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import { Label } from "$lib/components/ui/label";
  import Field from "$lib/components/field.svelte";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Store from "@lucide/svelte/icons/store";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();
  let submitting = $state(false);

  const CURRENCIES = [
    { value: "INR", label: "INR — Indian Rupee (₹)" },
    { value: "USD", label: "USD — US Dollar ($)" },
    { value: "GBP", label: "GBP — British Pound (£)" },
    { value: "EUR", label: "EUR — Euro (€)" },
    { value: "AED", label: "AED — UAE Dirham (د.إ)" },
  ];

  const BUSINESS_TYPES = [
    { value: "sole_proprietorship", label: "Sole proprietorship" },
    { value: "partnership", label: "Partnership" },
    { value: "llp", label: "LLP" },
    { value: "private_limited", label: "Private limited" },
    { value: "public_limited", label: "Public limited" },
    { value: "individual", label: "Individual / Creator" },
  ];

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
</script>

<svelte:head><title>Set up your store · OpenCommerce</title></svelte:head>

<div class="grid min-h-screen place-items-center px-4 py-12">
  <Card class="w-full max-w-lg shadow-xl">
    <CardHeader>
      <div class="mb-3 flex items-center gap-2.5">
        <div class="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Store class="size-5" />
        </div>
        <div>
          <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Welcome to OpenCommerce</span>
          <CardTitle class="text-xl font-bold">Set up your first store</CardTitle>
        </div>
      </div>
      <CardDescription>
        Hello {data.userName || "there"}! Let's configure your store's primary details so you can start publishing products across channels.
      </CardDescription>
    </CardHeader>

    <CardContent>
      {#if form?.error}
        <Alert variant="destructive" class="mb-5">
          <AlertDescription>{form.error}</AlertDescription>
        </Alert>
      {/if}

      <form
        method="POST"
        class="space-y-5"
        use:enhance={() => {
          submitting = true;
          return async ({ update }) => {
            await update();
            submitting = false;
          };
        }}
      >
        <Field
          label="Store Name"
          name="name"
          required
          placeholder="e.g. Acme Apparel, Urban Kraft"
          help="The public or brand name of your business."
        />

        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <Label for="currency" class="mb-1.5 block">Store Currency</Label>
            <select id="currency" name="currency" class={selectClass}>
              {#each CURRENCIES as opt (opt.value)}
                <option value={opt.value} selected={opt.value === "INR"}>
                  {opt.label}
                </option>
              {/each}
            </select>
          </div>

          <div>
            <Label for="business_type" class="mb-1.5 block">Business Structure</Label>
            <select id="business_type" name="business_type" class={selectClass}>
              {#each BUSINESS_TYPES as opt (opt.value)}
                <option value={opt.value} selected={opt.value === "private_limited"}>
                  {opt.label}
                </option>
              {/each}
            </select>
          </div>
        </div>

        <Field
          label="Country code"
          name="country"
          value="IN"
          placeholder="IN"
          help="Two-letter ISO country code (e.g. IN, US, GB)."
        />

        <Field
          label="Store Description (optional)"
          name="description"
          textarea
          rows={3}
          placeholder="A brief overview of your catalogue and products..."
          help="Used as your seller blurb where marketplaces display one."
        />

        <Button type="submit" class="w-full gap-2" disabled={submitting}>
          {submitting ? "Setting up store…" : "Continue to Dashboard"}
          <ArrowRight class="size-4" />
        </Button>
      </form>
    </CardContent>
  </Card>
</div>
