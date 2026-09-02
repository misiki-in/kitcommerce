<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import Field from "$lib/components/field.svelte";
  import type { ActionData } from "./$types";

  let { form }: { form: ActionData } = $props();
  let submitting = $state(false);
</script>

<svelte:head><title>Create an account · OpenCommerce</title></svelte:head>

<div class="grid min-h-screen place-items-center px-4 py-12">
  <Card class="w-full max-w-sm">
    <CardHeader>
      <div class="mb-2 flex items-center gap-2">
        <img src="/logo.svg" alt="" width="28" height="28" />
        <span class="font-semibold">OpenCommerce</span>
      </div>
      <CardTitle>Create an account</CardTitle>
      <CardDescription>Get started with your multi-channel store catalogue.</CardDescription>
    </CardHeader>

    <CardContent>
      {#if form?.error}
        <Alert variant="destructive" class="mb-4">
          <AlertDescription>{form.error}</AlertDescription>
        </Alert>
      {/if}

      <form
        method="POST"
        class="space-y-4"
        use:enhance={() => {
          submitting = true;
          return async ({ update }) => {
            await update();
            submitting = false;
          };
        }}
      >
        <Field
          label="Full name"
          name="name"
          type="text"
          required
          value={form?.name ?? ""}
          autocomplete="name"
          placeholder="Ayush Sharma"
        />
        <Field
          label="Email"
          name="email"
          type="email"
          required
          value={form?.email ?? ""}
          autocomplete="email"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          name="password"
          type="password"
          required
          autocomplete="new-password"
          placeholder="At least 8 characters"
        />
        <Button type="submit" class="w-full" disabled={submitting}>
          {submitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p class="mt-4 text-center text-sm text-muted-foreground">
        Already have an account? <a href="/login" class="font-medium text-primary hover:underline">Sign in</a>
      </p>
    </CardContent>
  </Card>
</div>
