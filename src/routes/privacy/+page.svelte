<script lang="ts">
  import LandingHeader from "$lib/components/landing/LandingHeader.svelte";
  import LandingFooter from "$lib/components/landing/LandingFooter.svelte";

  const REPO = "https://github.com/misiki-in/kitcommerce";
  const counts = { channels: 14, india: 6 };
</script>

<svelte:head>
  <title>Privacy Policy · OpenCommerce</title>
  <meta
    name="description"
    content="OpenCommerce Privacy Policy. Learn how your data, credentials, and catalog information are handled and protected."
  />
</svelte:head>

<div class="min-h-screen bg-peacock text-chalk antialiased selection:bg-gold selection:text-peacock-deep">
  <LandingHeader repo={REPO} />

  <main class="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
    <!-- Breadcrumb / Header -->
    <div class="mb-10 border-b border-white/10 pb-8">
      <div class="mb-3 inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
        <span>Security &amp; Data Protection</span>
      </div>
      <h1 class="board text-3xl font-bold tracking-tight text-chalk sm:text-4xl">
        Privacy Policy
      </h1>
      <p class="mt-3 text-base text-chalk/60">
        Last updated: September 2026 · OpenCommerce &amp; Misiki Handloom Private Limited
      </p>
    </div>

    <!-- Core Philosophy Banner -->
    <div class="mb-12 rounded-xl border border-white/15 bg-white/[0.03] p-6 sm:p-8 backdrop-blur-sm">
      <div class="flex items-start gap-4">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gold/15 text-gold">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
          </svg>
        </div>
        <div>
          <h2 class="text-lg font-semibold text-chalk">Zero Cloud Telemetry &amp; Self-Hosted Guarantee</h2>
          <p class="mt-2 text-sm leading-relaxed text-chalk/70">
            OpenCommerce is built from the ground up to respect merchant privacy. We do not track you, sell your customer data, or store your catalogue on centralized third-party analytics servers. Your data stays in your database and on your infrastructure.
          </p>
        </div>
      </div>
    </div>

    <!-- Privacy Details -->
    <div class="space-y-10 text-chalk/80 leading-relaxed">
      <!-- Section 1 -->
      <section class="space-y-3">
        <h2 class="text-xl font-semibold text-chalk flex items-center gap-2.5">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs text-gold">1</span>
          Information We Collect &amp; Store
        </h2>
        <p class="text-sm sm:text-base">
          When you use OpenCommerce to manage multi-channel commerce integrations, the application stores data necessary to fulfill its operations:
        </p>
        <ul class="list-disc space-y-2 pl-6 text-sm sm:text-base text-chalk/70">
          <li><strong>Account Information:</strong> Your name, email address, password hash (salted using Argon2id), and organization profile.</li>
          <li><strong>Catalogue &amp; Inventory:</strong> Products, SKUs, pricing rules, categories, media links, and stock allocation tables.</li>
          <li><strong>Channel Credentials:</strong> Marketplace API keys, client secrets, refresh tokens, and webhook secrets required for publishing and order synchronizations.</li>
          <li><strong>Sync Events &amp; Logs:</strong> Job queue history, outbox domain events, synchronization attempts, and error logs for debugging.</li>
        </ul>
      </section>

      <!-- Section 2 -->
      <section class="space-y-3">
        <h2 class="text-xl font-semibold text-chalk flex items-center gap-2.5">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs text-gold">2</span>
          How Your Credentials Are Protected
        </h2>
        <p class="text-sm sm:text-base">
          Marketplace API secrets and OAuth tokens are treated with strict confidentiality:
        </p>
        <div class="grid gap-4 sm:grid-cols-2 pt-2">
          <div class="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h3 class="font-medium text-chalk text-sm mb-1 text-gold">AES-256-GCM Encryption</h3>
            <p class="text-xs text-chalk/65 leading-normal">
              All credentials are encrypted at rest using AES-256-GCM with a unique 12-byte initialization vector (IV) prepended per record.
            </p>
          </div>
          <div class="rounded-lg border border-white/10 bg-white/[0.02] p-4">
            <h3 class="font-medium text-chalk text-sm mb-1 text-gold">Isolated Secret Access</h3>
            <p class="text-xs text-chalk/65 leading-normal">
              Credentials are never returned in public API payloads, never printed to execution logs, and strictly isolated to the background worker plane.
            </p>
          </div>
        </div>
      </section>

      <!-- Section 3 -->
      <section class="space-y-3">
        <h2 class="text-xl font-semibold text-chalk flex items-center gap-2.5">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs text-gold">3</span>
          Third-Party Marketplace Connectors
        </h2>
        <p class="text-sm sm:text-base">
          When you enable a marketplace connector (such as eBay, Etsy, Meta, TikTok, Flipkart, Meesho, or Amazon), OpenCommerce transmits only the necessary product listing, pricing, and inventory updates directly to those platform APIs as configured by you.
        </p>
        <p class="text-sm sm:text-base text-chalk/70">
          Data transmission is governed by each respective platform’s API terms and developer policies. OpenCommerce does not broker these requests through an intermediary SaaS cloud.
        </p>
      </section>

      <!-- Section 4 -->
      <section class="space-y-3">
        <h2 class="text-xl font-semibold text-chalk flex items-center gap-2.5">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs text-gold">4</span>
          Cookies &amp; Local Storage
        </h2>
        <p class="text-sm sm:text-base">
          We use strictly necessary first-party cookies and local storage tokens for authentication sessions and user interface preferences (such as light/dark theme selection and audio feedback toggles). No advertising cookies or third-party tracking scripts are used.
        </p>
      </section>

      <!-- Section 5 -->
      <section class="space-y-3">
        <h2 class="text-xl font-semibold text-chalk flex items-center gap-2.5">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs text-gold">5</span>
          Your Rights &amp; Data Deletion
        </h2>
        <p class="text-sm sm:text-base">
          You retain full ownership and control over your data:
        </p>
        <ul class="list-disc space-y-1.5 pl-6 text-sm sm:text-base text-chalk/70">
          <li>You can export, modify, or delete your catalogue and channel connections at any time via the dashboard.</li>
          <li>You can delete your database or reset your environment instantly using the native database commands.</li>
          <li>To request assistance or report security concerns, contact our team directly.</li>
        </ul>
      </section>

      <!-- Section 6 -->
      <section class="space-y-3">
        <h2 class="text-xl font-semibold text-chalk flex items-center gap-2.5">
          <span class="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs text-gold">6</span>
          Contact Us
        </h2>
        <p class="text-sm sm:text-base">
          If you have questions about this Privacy Policy or data security practices, please get in touch:
        </p>
        <div class="mt-3 rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm text-chalk/80">
          <p><strong>OpenCommerce / Misiki Handloom Private Limited</strong></p>
          <p class="mt-1 text-chalk/65">Email: <a href="mailto:support@opencommerce.dev" class="text-gold hover:underline">support@opencommerce.dev</a></p>
          <p class="text-chalk/65">Security Inquiries: <a href="mailto:security@opencommerce.dev" class="text-gold hover:underline">security@opencommerce.dev</a></p>
        </div>
      </section>
    </div>
  </main>

  <LandingFooter
    repo={REPO}
    {counts}
    brandIcon={brandIconSnippet}
  />
</div>

{#snippet brandIconSnippet(name: string)}
  {#if name === "github"}
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" class="shrink-0">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
    </svg>
  {:else if name === "discord"}
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" class="shrink-0">
      <path d="M13.545 2.907a13.227 13.227 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.19 12.19 0 0 0-3.658 0 8.258 8.258 0 0 0-.412-.833.051.051 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.041.041 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032c.001.014.01.028.021.037a13.276 13.276 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019c.308-.42.582-.863.818-1.329a.05.05 0 0 0-.01-.059.051.051 0 0 0-.018-.011 8.875 8.875 0 0 1-1.248-.595.05.05 0 0 1-.02-.066.051.051 0 0 1 .015-.019c.084-.063.168-.129.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.052.052 0 0 1 .053.007c.08.066.164.132.248.195a.051.051 0 0 1-.004.085 8.254 8.254 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.235 13.235 0 0 0 4.001-2.02.049.049 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.034.034 0 0 0-.02-.019Zm-8.198 7.307c-.789 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612Zm5.316 0c-.788 0-1.438-.724-1.438-1.612 0-.889.637-1.613 1.438-1.613.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612Z"/>
    </svg>
  {:else if name === "telegram"}
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" class="shrink-0">
      <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0ZM8.287 5.906c-.778.324-2.334.994-4.666 2.01-.389.154-.602.302-.638.443-.062.24.238.334.646.463l.16.051c.4.13.938.284 1.218.29.255.006.544-.099.866-.314 2.196-1.482 3.33-2.232 3.402-2.25.051-.013.123-.03.172.013.048.043.043.124.038.147-.03.14-.65 1.706-.973 2.508l-.05.123c-.22.544-.44 1.088.338 1.6 1.084.713 1.748 1.157 2.05 1.355.334.22.656.333.948.305.348-.033.438-.344.475-.487l.006-.027c.216-.89.736-3.808 1.055-5.467.068-.352.02-.622-.116-.762-.158-.162-.404-.194-.52-.196-.34-.007-.866.16-3.411 1.216Z"/>
    </svg>
  {:else if name === "x"}
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" class="shrink-0">
      <path d="M12.6 1h2.2l-4.8 5.5L15.6 15h-4.4L7.7 10.5 3.8 15H1.6l5.1-5.9L1 1h4.5l3.2 4.2L12.6 1zm-.8 12.7h1.2L4.6 2.2H3.3l8.5 11.5z"/>
    </svg>
  {/if}
{/snippet}
