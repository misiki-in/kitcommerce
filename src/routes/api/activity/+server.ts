import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { repo } from "$server/app";
import { brandMark } from "$server/connectors/brand";

/** Feeds the desktop activity drawer. Same data the /activity page loads. */
export const GET: RequestHandler = async ({ locals, url }) => {
  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) return json({ entries: [], counts: { all: 0, sync: 0, order: 0, change: 0, failed: 0 } });

  const filter = url.searchParams.get("filter") ?? "";
  const all = repo.activity(store.id, 200);

  const counts = {
    all: all.length,
    sync: all.filter((e) => e.kind === "sync").length,
    order: all.filter((e) => e.kind === "order").length,
    change: all.filter((e) => e.kind === "change").length,
    failed: all.filter((e) => e.status === "DEAD_LETTER" || e.status === "RETRYING").length,
  };

  const entries = all
    .filter((e) => {
      if (!filter) return true;
      if (filter === "failed") return e.status === "DEAD_LETTER" || e.status === "RETRYING";
      return e.kind === filter;
    })
    .slice(0, 60)
    .map((e) => ({
      ...e,
      mark: e.connector ? brandMark(e.connector, 26) : "",
      retryable: e.kind === "sync" && (e.status === "DEAD_LETTER" || e.status === "RETRYING"),
    }));

  return json({ entries, counts });
};
