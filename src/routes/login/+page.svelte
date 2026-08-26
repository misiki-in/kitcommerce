<script lang="ts">
  import { enhance } from "$app/forms";
  import { Button } from "$lib/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "$lib/components/ui/card";
  import { Alert, AlertDescription } from "$lib/components/ui/alert";
  import Field from "$lib/components/field.svelte";
  import type { ActionData, PageServerData } from "./$types";

  let { data, form }: { data: PageServerData; form: ActionData } = $props();
  let submitting = $state(false);
</script>

<svelte:head><title>Sign in · OpenCommerce</title></svelte:head>

<div class="grid min-h-screen place-items-center px-4 py-12">
  <Card class="w-full max-w-sm">
    <CardHeader>
      <div class="mb-2 flex items-center gap-2">
        <img src="/logo.svg" alt="" width="28" height="28" />
        <span class="font-semibold">OpenCommerce</span>
      </div>
      <CardTitle>Sign in</CardTitle>
      <CardDescription>Welcome back.</CardDescription>
    </CardHeader>

    <CardContent>
      {#if form?.error}
        <Alert variant="destructive" class="mb-4">
          <AlertDescription>{form.error}</AlertDescription>
        </Alert>
      {/if}

      {#if data.demo}
        <Alert variant="success" class="mb-4">
          <AlertDescription>
            Demo account prefilled — just press <strong>Sign in</strong>.
            <div class="mt-1 font-mono text-xs opacity-80">{data.demo.email} / {data.demo.password}</div>
          </AlertDescription>
        </Alert>
      {/if}

      <form
        method="POST"
        class="space-y-4"
        autocomplete={data.demo ? "off" : undefined}
        use:enhance={() => {
          submitting = true;
          return async ({ update }) => {
            await update();
            submitting = false;
          };
        }}
      >
        <Field
          label="Email"
          name="email"
          type="email"
          required
          value={form?.email ?? data.demo?.email ?? ""}
          autocomplete={data.demo ? "off" : "username"}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          required
          value={data.demo?.password ?? ""}
          autocomplete={data.demo ? "new-password" : "current-password"}
        />
        <Button type="submit" class="w-full" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p class="mt-4 text-center text-sm text-muted-foreground">
        New here? <a href="/signup">Create an account</a>
      </p>
    </CardContent>
  </Card>
</div>
