import type { Principal } from "$server/auth";

declare global {
  namespace App {
    interface Locals {
      /** Resolved from the session cookie in hooks.server.ts, or null. */
      principal: Principal | null;
    }
  }
}

export {};
