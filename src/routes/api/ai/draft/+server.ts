import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { config, repo } from "$server/app";
import { draftListing } from "$server/ai";

/**
 * AI listing draft. Opt-in, and separate from /api/suggest on purpose.
 *
 * /api/suggest is deterministic and free, so the form calls it on every
 * keystroke. This one costs money and takes a second or two, so it is only
 * ever reached by an explicit click. Keeping them as two routes is what stops
 * the expensive one from being wired into an input handler by accident.
 *
 * 503 rather than 404 when disabled: the route exists, the capability is not
 * configured, and the client should say so rather than treat it as a bug.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!config.ai.enabled) {
    return json(
      { error: "ai not configured", hint: "set ANTHROPIC_API_KEY and install @anthropic-ai/sdk" },
      { status: 503 },
    );
  }

  const store = repo.storesForOrg(locals.principal!.organizationId)[0];
  if (!store) return json({ error: "no store" }, { status: 400 });

  let input: Record<string, unknown> = {};
  try {
    input = await request.json();
  } catch {
    return json({ error: "expected a JSON body" }, { status: 400 });
  }

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) return json({ error: "a title is required to draft from" }, { status: 400 });

  /*
   * The seller's own vocabulary, passed as context so a draft reuses the
   * categories and attribute keys their catalogue already has instead of
   * inventing a parallel taxonomy that breaks their filters.
   */
  const products = repo.listProducts(store.id, 500);
  const categories = new Map<string, number>();
  const attributeKeys = new Set<string>();
  for (const p of products) {
    if (p.category) categories.set(p.category, (categories.get(p.category) ?? 0) + 1);
    try {
      for (const k of Object.keys(JSON.parse(p.attributes || "{}"))) attributeKeys.add(k);
    } catch {
      /* one malformed row must not cost the seller their draft */
    }
  }

  const draft = await draftListing({
    title,
    brand: typeof input.brand === "string" ? input.brand : undefined,
    category: typeof input.category === "string" ? input.category : undefined,
    description: typeof input.description === "string" ? input.description : undefined,
    knownCategories: [...categories.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([c]) => c),
    knownAttributes: [...attributeKeys].sort().slice(0, 30),
  });

  if (!draft) return json({ error: "draft unavailable" }, { status: 502 });

  return json({ draft });
};
