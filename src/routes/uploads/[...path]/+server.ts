import { error } from "@sveltejs/kit";
import { existsSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { RequestHandler } from "./$types";
import { config } from "$server/app";

/** Product images and store logos written by the fs blob driver. */
export const GET: RequestHandler = async ({ params }) => {
  // resolve() collapses any ".." before the prefix check, so a traversal
  // attempt lands outside uploadsDir and is rejected rather than sanitised.
  const root = resolve(config.uploadsDir);
  const path = resolve(root, params.path ?? "");
  if (!path.startsWith(root + sep) || !existsSync(path)) error(404, "not found");
  return new Response(Bun.file(path), {
    headers: { "Cache-Control": "public, max-age=86400" },
  });
};
