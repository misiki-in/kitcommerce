/**
 * Optional AI listing drafts.
 *
 * Off by default and off in every default install. Two deliberate steps turn it
 * on — `bun add @anthropic-ai/sdk` and an ANTHROPIC_API_KEY — because the point
 * of this project is that a clone runs with no key, no account and no runtime
 * dependency. Neither step is taken for you, and with either one missing every
 * function here returns null and the deterministic suggester in ./suggest.ts is
 * what the product form uses.
 *
 * Where this is allowed to run:
 *
 *   design time only. A draft is a suggestion a human reads, edits and commits.
 *   The committed mapping is what executes.
 *
 * Where it is not:
 *
 *   the sync path, ever. Sync jobs carry an idempotency key, and a retry after
 *   a rate-limit has to rebuild byte-identical input. A model in that path
 *   could produce a different payload on the retry while the key still claims
 *   the two are the same request — which is precisely how one product becomes
 *   two listings on a marketplace. Nothing in $server/sync.ts imports this
 *   file, and nothing should.
 */
import { config } from "./config";

export interface ListingDraft {
  title: string;
  description: string;
  category: string;
  keywords: string[];
  attributes: Array<{ key: string; value: string }>;
}

export interface DraftInput {
  title?: string;
  brand?: string;
  category?: string;
  description?: string;
  /** Categories already used in this store, most common first. */
  knownCategories?: string[];
  /** Attribute keys already used in this store. */
  knownAttributes?: string[];
  /** Fields the target marketplaces require but the product is missing. */
  requiredFields?: string[];
}

/**
 * Strict tool use rather than free text: the model must answer through this
 * schema or not at all, so the route never has to parse prose or defend
 * against a shape it did not expect. `additionalProperties: false` plus a
 * complete `required` list is what `strict` needs to be enforceable.
 */
const DRAFT_TOOL = {
  name: "draft_listing",
  description:
    "Return a marketplace listing draft for the product described by the seller.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "Listing title, at most 120 characters. Lead with brand and product type. No ALL CAPS, no emoji, no promotional claims.",
      },
      description: {
        type: "string",
        description:
          "Two or three plain sentences describing what the product is and what it is made of. No marketing superlatives.",
      },
      category: {
        type: "string",
        description:
          "Best-fitting category. Reuse one of the seller's existing categories verbatim when one fits.",
      },
      keywords: {
        type: "array",
        description: "Six to ten search keywords, lowercase, no duplicates.",
        items: { type: "string" },
      },
      attributes: {
        type: "array",
        description:
          "Structured attributes a marketplace would require, such as material, colour, size or fabric. Reuse the seller's existing attribute keys where they apply.",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            value: { type: "string" },
          },
          required: ["key", "value"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "description", "category", "keywords", "attributes"],
    additionalProperties: false,
  },
} as const;

const SYSTEM = [
  "You draft marketplace product listings for a seller publishing one catalogue to many marketplaces.",
  "Work only from what the seller gave you. Do not invent measurements, materials, certifications, model numbers or country of origin — if a required attribute cannot be derived from the input, leave it out rather than guessing, because a wrong attribute is rejected at the marketplace and a fabricated one is a compliance problem for the seller.",
  "Match the seller's existing vocabulary when it fits: reusing a category and attribute key they already use keeps their catalogue consistent and their filters working.",
].join("\n\n");

/**
 * The SDK is an optional install, so it cannot be imported statically — a type
 * import would break `bun run build` for everyone who has not opted in. This
 * covers the fields actually read below; the SDK's own types are richer.
 */
type ToolUseBlock = { type: string; name?: string; input?: unknown };
type DraftResponse = { content?: ToolUseBlock[]; stop_reason?: string };

function prompt(input: DraftInput): string {
  const lines = [
    input.title ? `Product: ${input.title}` : "",
    input.brand ? `Brand: ${input.brand}` : "",
    input.category ? `Seller's category: ${input.category}` : "",
    input.description ? `Seller's notes: ${input.description}` : "",
    input.knownCategories?.length
      ? `Categories already in this catalogue: ${input.knownCategories.join(", ")}`
      : "",
    input.knownAttributes?.length
      ? `Attribute keys already in this catalogue: ${input.knownAttributes.join(", ")}`
      : "",
    input.requiredFields?.length
      ? `Fields the target marketplaces require: ${input.requiredFields.join(", ")}`
      : "",
  ].filter(Boolean);

  return `${lines.join("\n")}\n\nDraft the listing.`;
}

/**
 * Returns a draft, or null when the feature is off, the SDK is not installed,
 * or the call failed.
 *
 * Null rather than a throw: a listing draft is an assist on a form the seller
 * can fill in themselves, so a model being unreachable is a missing
 * convenience, not an error worth failing their page load over.
 */
export async function draftListing(input: DraftInput): Promise<ListingDraft | null> {
  if (!config.ai.enabled) return null;

  let Anthropic: new (opts: { apiKey: string }) => {
    messages: { create(body: Record<string, unknown>): Promise<DraftResponse> };
  };
  try {
    ({ default: Anthropic } = (await import("@anthropic-ai/sdk")) as never);
  } catch {
    // Key set but package absent — a half-finished opt-in. Stay quiet and let
    // the deterministic suggester answer.
    return null;
  }

  try {
    const client = new Anthropic({ apiKey: config.ai.apiKey });

    const response = await client.messages.create({
      model: config.ai.model,
      // Generous because thinking tokens count against it, not because the
      // draft is long. You are billed for what is generated, not the ceiling.
      max_tokens: 8000,
      // Drafting a listing from given facts is not a reasoning problem, and
      // this runs while a seller waits on a form. Adaptive thinking stays on
      // (disabling it on Opus 5 has its own failure modes); effort is what
      // buys the latency back.
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: [DRAFT_TOOL],
      tool_choice: { type: "tool", name: DRAFT_TOOL.name },
      messages: [{ role: "user", content: prompt(input) }],
    });

    if (response.stop_reason === "refusal") return null;

    const block = response.content?.find(
      (b) => b.type === "tool_use" && b.name === DRAFT_TOOL.name,
    );
    if (!block?.input) return null;

    return normalize(block.input as Record<string, unknown>);
  } catch {
    // Rate limit, bad key, network, a schema the SDK rejected: all of them mean
    // the same thing to the caller.
    return null;
  }
}

/**
 * The schema constrains shape, not sanity. Length caps and de-duplication are
 * ours to apply — a 300-character title validates fine and is still rejected by
 * every marketplace that caps at 200.
 */
function normalize(raw: Record<string, unknown>): ListingDraft {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);

  const keywords = [
    ...new Set(arr(raw.keywords).map(str).filter(Boolean).map((k) => k.toLowerCase())),
  ].slice(0, 10);

  const attributes = arr(raw.attributes)
    .map((a) => {
      const rec = (a ?? {}) as Record<string, unknown>;
      return { key: str(rec.key), value: str(rec.value) };
    })
    .filter((a) => a.key && a.value)
    .slice(0, 20);

  return {
    title: str(raw.title).slice(0, 120),
    description: str(raw.description).slice(0, 2000),
    category: str(raw.category).slice(0, 80),
    keywords,
    attributes,
  };
}
