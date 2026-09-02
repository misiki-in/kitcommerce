<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Label } from "$lib/components/ui/label";
  import Field from "$lib/components/field.svelte";
  import Lock from "@lucide/svelte/icons/lock";

  let { store, bank }: { store: any; bank: any } = $props();

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

  const selectClass =
    "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm " +
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
</script>

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
        value={store.legal_name}
        help="Must match your GST or tax registration exactly"
      />

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <Label for="business_type" class="mb-1.5 block">Business type</Label>
          <select id="business_type" name="business_type" class={selectClass}>
            {#each BUSINESS_TYPES as opt (opt.value)}
              <option value={opt.value} selected={opt.value === store.business_type}>
                {opt.label}
              </option>
            {/each}
          </select>
        </div>
        <div>
          <Label for="currency" class="mb-1.5 block">Currency</Label>
          <select id="currency" name="currency" class={selectClass}>
            {#each CURRENCIES as opt (opt.value)}
              <option value={opt.value} selected={opt.value === store.currency}>{opt.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Tax ID / GSTIN" name="tax_id" value={store.tax_id} placeholder="29AABCM1234R1ZX" />
        <Field label="Registration no." name="registration_no" value={store.registration_no} placeholder="CIN / UDYAM" />
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
          <Field label="Address line 1" name="address_line1" value={store.address_line1} />
          <Field label="Address line 2" name="address_line2" value={store.address_line2} />
          <div class="grid gap-4 sm:grid-cols-3">
            <Field label="City" name="city" value={store.city} />
            <Field label="State" name="state" value={store.state} />
            <Field label="Postal code" name="postal_code" value={store.postal_code} />
          </div>
          <Field label="Country" name="country" value={store.country || "IN"} />
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
          <Field label="Account holder name" name="bank_account_name" value={bank.account_name} />
          <div class="grid gap-4 sm:grid-cols-2">
            <Field label="Bank name" name="bank_name" value={bank.bank_name} />
            <Field label="Branch" name="bank_branch" value={bank.branch} />
          </div>
          <div class="grid gap-4 sm:grid-cols-2">
            <Field
              label="Account number"
              name="bank_account_number"
              autocomplete="off"
              placeholder={bank.accountMask}
              help={bank.accountMask ? "Stored. Type a new number to replace it." : ""}
            />
            <Field label="IFSC / SWIFT" name="bank_ifsc" autocomplete="off" value={bank.ifsc} />
          </div>
          <Field label="UPI ID" name="bank_upi" value={bank.upi} placeholder="name@bank" />
        </div>
      </fieldset>

      <Button type="submit">Save company details</Button>
    </form>
  </CardContent>
</Card>
