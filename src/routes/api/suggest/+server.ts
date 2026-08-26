import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { repo } from "$server/app";
import { suggestAll } from "$server/suggest";

/**
 * Deterministic listing suggestions: SKU, categories, keywords, attributes.
 * No AI, no network call — safe to hit on every keystroke.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) return json({ error: "no store" }, { status: 400 });

  let input: Record<string, unknown> = {};
  try {
    input = await request.json();
  } catch {
    return json({ error: "expected a JSON body" }, { status: 400 });
  }
  return json(suggestAll(repo, store.id, input));
};
