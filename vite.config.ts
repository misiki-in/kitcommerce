import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // 3000 to match where this project has always run. Binding 127.0.0.1
  // explicitly rather than "localhost": on Windows that name can resolve to
  // ::1 only, which leaves IPv4 clients (curl, scripts, some tooling) unable
  // to reach a server the browser can see.
  server: { port: 3000, strictPort: false, host: true },
  preview: { port: 3000, host: true },
});
