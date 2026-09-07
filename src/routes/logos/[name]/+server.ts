import { error } from "@sveltejs/kit";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RequestHandler } from "./$types";
import { config } from "$server/app";
import { channelLogoFile, logoOverrideFile } from "$server/connectors/brand";

const TYPES: Record<string, string> = {
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
};

/**
 * Serves marketplace artwork from static/channels/ or dropped into data/logos/ by `bun logos`.
 * Connectors with no file there fall back to the drawn mark in brand.ts, so
 * this route is allowed to 404.
 */
export const GET: RequestHandler = async ({ params }) => {
  const channelFile = channelLogoFile(params.name);
  if (channelFile) {
    const channelPath = join(process.cwd(), "static", "channels", channelFile);
    if (existsSync(channelPath)) {
      const ext = channelFile.slice(channelFile.lastIndexOf(".") + 1).toLowerCase();
      return new Response(Bun.file(channelPath), {
        headers: {
          "Content-Type": TYPES[ext] ?? "application/octet-stream",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }
  }

  const file = logoOverrideFile(params.name);
  if (!file) error(404, "not found");

  const path = join(config.dataDir, "logos", file);
  if (!existsSync(path)) error(404, "not found");

  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  return new Response(Bun.file(path), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
