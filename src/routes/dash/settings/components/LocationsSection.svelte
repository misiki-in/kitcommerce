<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import ConfirmButton from "$lib/components/confirm-button.svelte";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Plus from "@lucide/svelte/icons/plus";

  let {
    locations,
    onAdd,
    onEdit,
  }: {
    locations: any[];
    onAdd: () => void;
    onEdit: (loc: any) => void;
  } = $props();

  function addressOf(l: any): string {
    return [l.address_line1, l.address_line2, l.city, l.state, l.postal_code, l.country]
      .filter(Boolean)
      .join(", ");
  }
</script>

<Card>
  <CardHeader class="flex-row items-start justify-between space-y-0">
    <div>
      <CardTitle class="text-base">Pickup locations</CardTitle>
      <CardDescription>Where couriers collect. A seller often has more than one.</CardDescription>
    </div>
    <Button variant="outline" size="sm" onclick={onAdd}><Plus /> Add location</Button>
  </CardHeader>
  <CardContent>
    {#if locations.length}
      <ul class="divide-y">
        {#each locations as location (location.id)}
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
              <Button variant="outline" size="sm" onclick={() => onEdit(location)}>Edit</Button>
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
