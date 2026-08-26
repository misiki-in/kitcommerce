<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Card, CardContent } from "$lib/components/ui/card";
  import { RELEASES, CURRENT_VERSION } from "$lib/releases";
  import { releaseNotice } from "$lib/release-notice.svelte";

  /**
   * Opening the page is the acknowledgement. There is no dismiss button
   * because there is nothing to dismiss — you either came to read what
   * changed, in which case you have, or you never opened it and the badge is
   * still doing its job.
   */
  $effect(() => {
    releaseNotice.markRead();
  });

  const dateLabel = (iso?: string) =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "unreleased";
</script>

<svelte:head><title>Releases · OpenCommerce</title></svelte:head>

<div class="mb-6">
  <h1 class="text-2xl font-semibold tracking-tight">Releases</h1>
  <p class="text-sm text-muted-foreground">
    What changed, newest first. These notes ship with the code, so they describe
    the commit you actually have checked out.
  </p>
</div>

<ol class="space-y-4">
  {#each RELEASES as release (release.version)}
    {@const current = release.version === CURRENT_VERSION}
    <li>
      <Card>
        <CardContent class="p-0">
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3">
            <h2 class="text-base font-semibold tabular-nums tracking-tight">
              {release.version}
            </h2>
            {#if current}
              <!-- Which one you are on matters more than which one is newest,
                   and on a self-hosted tool they are not always the same. -->
              <Badge variant="success">running now</Badge>
            {/if}
            <span class="text-sm text-muted-foreground">{release.title}</span>
            <span class="ml-auto text-xs tabular-nums text-muted-foreground">
              {dateLabel(release.date)}
            </span>
          </div>

          <ul class="divide-y">
            {#each release.notes as note (note)}
              <li class="flex items-start gap-3 px-4 py-2.5">
                <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/40"></span>
                <span class="text-sm leading-relaxed">{note}</span>
              </li>
            {/each}
          </ul>
        </CardContent>
      </Card>
    </li>
  {/each}
</ol>

<p class="mt-6 text-xs text-muted-foreground">
  Update with <span class="font-mono">git pull</span>. This page is generated
  from the code you are running, not fetched from anywhere.
</p>
