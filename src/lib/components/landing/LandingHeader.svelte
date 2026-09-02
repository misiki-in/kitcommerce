<script lang="ts">
  let { repo }: { repo: string } = $props();
</script>

<header class="mx-auto flex max-w-6xl items-center gap-4 px-5 py-5 sm:px-8">
  <a href="/" class="flex items-center gap-2.5 hover:no-underline">
    <img src="/logo.svg" alt="" width="30" height="30" />
    <span class="board text-[1.05rem] text-chalk">OpenCommerce</span>
  </a>

  <nav class="ml-auto flex items-center gap-1.5">
    <a
      href={repo}
      target="_blank"
      rel="noreferrer noopener"
      class="flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-sm text-chalk/75
             transition-colors hover:border-white/30 hover:bg-white/5 hover:text-chalk hover:no-underline
             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2
             focus-visible:ring-offset-peacock-deep"
    >
      <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true" class="shrink-0">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
        />
      </svg>
      <span>Star<span class="hidden sm:inline">&nbsp;on GitHub</span></span>
    </a>
    <a
      href="/login"
      class="rounded-md border border-white/20 px-3.5 py-1.5 text-sm font-medium text-chalk transition-colors hover:border-white/40 hover:text-white hover:no-underline"
    >
      Sign in
    </a>
    <a
      href="/signup"
      class="rounded-md bg-gold px-3.5 py-1.5 text-sm font-semibold text-peacock-deep transition-opacity hover:opacity-90 hover:no-underline"
    >
      Sign up
    </a>
  </nav>
</header>
