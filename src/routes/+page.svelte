<script lang="ts">
  import { fuzzyRank } from "$lib/fuzzy";
  import { ROADMAP, ROADMAP_COUNT } from "$lib/roadmap";
  import type { PageServerData } from "./$types";

  let { data }: { data: PageServerData } = $props();

  /**
   * The public repository.
   *
   * One constant because it is the header link and the clone line in the
   * install block, and those two disagreeing is the kind of thing nobody
   * notices until someone copies a command that does not work.
   */
  const REPO = "https://github.com/misiki-in/kitcommerce";

  /**
   * Everything the footer points at.
   *
   * Split into two halves on purpose. The first half is derived from REPO and
   * is correct the moment that constant is: issues and discussions are GitHub
   * features every repo has, and both docs files exist in the tree today.
   *
   * The second half has nothing behind it yet. They keep the same obviously-
   * fake `your-…` shape as REPO so a reader can tell at a glance which links
   * are real, and so `grep -r "your-" src/` finds every one that still needs
   * filling in. A footer that links to a Discord nobody has created is the
   * exact kind of thing the rest of this page refuses to do — so either point
   * these at something real or delete the row.
   */
  const LINKS = {
    github: REPO,
    issues: `${REPO}/issues`,
    discussions: `${REPO}/discussions`,
    building: `${REPO}/blob/main/docs/connector-development.md`,
    roadmap: `${REPO}/blob/main/docs/connector-roadmap.md`,
    /*
     * There is no LICENSE file in the tree yet, though the README and this
     * page both say MIT. Adding one is the fix; until then this link 404s.
     */
    license: `${REPO}/blob/main/LICENSE`,
    /*
     * For self-hosted MIT software the licence *is* the agreement — there is
     * no service to have terms of. If you ever run a hosted OpenCommerce,
     * repoint this at a real terms page.
     */
    terms: `${REPO}/blob/main/LICENSE`,
    discord: "https://discord.gg/your-invite",
    telegram: "https://t.me/your-channel",
    x: "https://x.com/your-handle",
    contact: "mailto:you@your-domain.example",
    security: "mailto:security@your-domain.example",
  };

  /**
   * Footer columns.
   *
   * Icons appear only where the destination is an external branded platform,
   * never on our own pages or docs. That split is doing work: the icon is the
   * cue that the link leaves the site for somewhere you already have an
   * account, which is exactly the set of rows a reader scans a footer for.
   */
  const FOOTER: Array<{
    title: string;
    links: Array<{ label: string; href: string; icon?: "github" | "discord" | "telegram" | "x" }>;
  }> = [
    {
      title: "Explore",
      links: [
        { label: "Dashboard", href: "#dashboard" },
        { label: "Features", href: "#features" },
        { label: "Connectors", href: "#connectors" },
        { label: "The stack", href: "#stack" },
      ],
    },
    {
      title: "Source",
      links: [
        { label: "GitHub", href: LINKS.github, icon: "github" },
        { label: "Issues", href: LINKS.issues },
        { label: "Adding a connector", href: LINKS.building },
        { label: "Connector roadmap", href: LINKS.roadmap },
      ],
    },
    {
      title: "Community",
      links: [
        { label: "Discord", href: LINKS.discord, icon: "discord" },
        { label: "Telegram", href: LINKS.telegram, icon: "telegram" },
        { label: "X", href: LINKS.x, icon: "x" },
        { label: "Discussions", href: LINKS.discussions },
      ],
    },
    {
      title: "Legal",
      links: [
        { label: "License (MIT)", href: LINKS.license },
        { label: "Terms", href: LINKS.terms },
        { label: "How your data is handled", href: "#privacy" },
        { label: "Report a vulnerability", href: LINKS.security },
        { label: "Contact", href: LINKS.contact },
      ],
    },
  ];

  /** Anchors and mailto: stay in the tab; anything on the web opens beside it. */
  const isExternal = (href: string) => href.startsWith("http");

  /**
   * The headline figure, as digits — a numeral stops the eye where a spelled
   * out word reads as prose.
   *
   * Set by hand rather than counted off the registry, because the number worth
   * printing is the number a seller can use, not the number of files in
   * connectors/. The "+" only stays honest while it understates: raise this
   * when more are genuinely usable, never above what is.
   */
  const platformsPlus = "6+";

  /**
   * Notes that belong to a whole group rather than to one connector. Only the
   * social group has one, and it earns it: the two Meta surfaces are not
   * independent, and TikTok is the single channel here a seller in India
   * cannot use at all.
   */
  const GROUP_NOTE: Record<string, string> = {
    Social:
      "Instagram and Facebook publish to the same Meta catalogue, so connecting both writes one product feed twice. Neither returns orders outside Meta's native checkout. TikTok Shop does not operate in India.",
  };

  /**
   * The fan.
   *
   * One origin on the left, one curve per channel to the right — the peacock's
   * tail in the logo, and the thing the product actually does, drawn once at
   * full size. Geometry is computed rather than hand-drawn so it stays correct
   * when a connector is added: the day someone adds a line to the registry,
   * the fan grows a blade.
   */
  const ROW_H = 34;
  const FAN_W = 56;
  const boardH = $derived(data.channels.length * ROW_H);
  const originY = $derived(boardH / 2);

  /** Curve from the single origin to the vertical centre of row `i`. */
  const curve = (i: number) => {
    const y = i * ROW_H + ROW_H / 2;
    return `M2 ${originY} C ${FAN_W * 0.55} ${originY}, ${FAN_W * 0.45} ${y}, ${FAN_W} ${y}`;
  };

  /**
   * Demo states for the board.
   *
   * Not all green. A board of nothing but successes would be a worse
   * advertisement than one showing what the engine is for: a queued job, a
   * retry mid-ladder, and a listing held back because a required field is
   * missing. Assigned by position rather than chosen per marketplace — this is
   * simulator output, labelled as such, not a claim about anyone's API.
   */
  type State = { kind: "listed" | "queued" | "retrying" | "incomplete"; note?: string };
  const stateFor = (i: number): State => {
    if (i === 8) return { kind: "incomplete", note: "needs ingredients" };
    if (i === 9) return { kind: "retrying", note: "attempt 2 of 5" };
    if (i === 12) return { kind: "queued" };
    return { kind: "listed" };
  };

  const TONE: Record<State["kind"], string> = {
    listed: "text-verdigris",
    queued: "text-chalk/45",
    retrying: "text-gold",
    incomplete: "text-rust",
  };

  /** The pipeline. A real sequence, so it is numbered. */
  const PIPELINE = [
    {
      title: "Validate",
      body: "Every channel declares the fields it requires. A product missing one becomes a visible INCOMPLETE mapping here, instead of five failed jobs there.",
    },
    {
      title: "Plan",
      body: "One job per channel that can actually accept the product. The engine never calls an operation a connector says it does not support.",
    },
    {
      title: "Execute",
      body: "Each job carries an idempotency key. Retrying produces the same remote ID as the first attempt, so a retry is never a second listing.",
    },
    {
      title: "Record",
      body: "Every attempt, payload and error lands in the audit trail. Nothing about a sync is inferred after the fact.",
    },
  ];

  /** Ports and their default drivers — the reason `bun dev` needs nothing. */
  const PORTS = [
    { port: "db", now: "SQLite (bun:sqlite)", later: "Postgres" },
    { port: "queue", now: "the database itself", later: "Redis Streams, BullMQ, NATS, SQS" },
    { port: "events", now: "transactional outbox", later: "Kafka, NATS, Redis" },
    { port: "search", now: "SQL LIKE", later: "Meilisearch, Typesense" },
    { port: "notify", now: "noop (log)", later: "Resend, SendGrid, SMTP" },
    { port: "blob", now: "local disk", later: "S3, R2" },
    { port: "secrets", now: "AES-256-GCM, local key", later: "Vault, KMS" },
  ];

  const INSTALL = `git clone ${REPO}\ncd opencommerce\nbun i\nbun seed\nbun dev`;
  /**
   * A prompt for generating the photo set a marketplace listing needs, from
   * one reference photo of the real product.
   *
   * This is not part of OpenCommerce and calls nothing here — it is text, and
   * it is on this page because every seller hits the same wall at the same
   * moment: the listing is written, the catalogue is connected, and there is
   * one phone snapshot where thirteen shots are wanted.
   *
   * The shot list is common marketplace practice, not something the connector
   * registry declares. Connectors here only assert "at least one image", with
   * Amazon adding a 1000px floor and Meesho recommending three; everything
   * below that line is convention, and the page says so rather than implying
   * the list was derived from the manifests.
   *
   * The do-not-invent rule is the load-bearing part. An image model asked for
   * a back view of a product it has only seen from the front will cheerfully
   * produce a plausible one, and a plausible-but-wrong back view is a returned
   * order and a marketplace strike, not a cosmetic defect.
   */
  const IMAGE_PROMPT = `You are producing marketplace product photography.
The attached photo is the reference and the only source of truth for this product.

RULES THAT OVERRIDE EVERYTHING ELSE
- Do not change the product. Shape, proportions, colour, pattern, material, stitching, hardware, branding and any printed text must match the reference exactly.
- Never invent a detail you cannot see. If a surface, side or feature is not visible in the reference, skip that shot rather than guessing at it.
- No added text, logos, watermarks, borders, badges or promotional graphics. The brand named below is context for tone only: reproduce the branding exactly where it already appears in the reference, and never letter it onto a surface that is blank in the reference.
- Photorealistic studio photography. Not an illustration, not a 3D render.
- sRGB, square 1:1 unless stated, at least 2000x2000px.

PRODUCE ONE IMAGE FOR EACH
1. MAIN - product centred on pure white #FFFFFF, filling about 85% of the frame, soft even light, subtle contact shadow only, no props. Amazon, Flipkart and Meesho all reject a main image that is not on white.
2. FRONT - straight-on elevation, white background.
3. BACK - straight-on rear, white background.
4. SIDE - 90 degree profile, white background.
5. THREE-QUARTER - 45 degree angle, white background.
6. TOP - directly overhead flat lay, white background.
7. DETAIL - macro of the primary material filling the frame: weave, grain, stitching or finish.
8. HARDWARE - close-up of the zip, button, clasp, seam, handle or spout, if the product has one.
9. SCALE - beside a common reference object such as a hand, a coin or an A4 sheet, on a neutral surface.
10. IN USE - in a realistic setting, used as intended, natural light.
11. ON MODEL - worn or held by a person with the whole product visible, neutral background. Skip if the product is neither wearable nor handheld.
12. PACKAGING - the product with its box or wrapping, everything included laid out.
13. VARIANTS - repeat shot 1 once per colourway listed below.
14. FASHION CROP - repeat shots 1 and 11 at 3:4 portrait, which is what Flipkart, Myntra and AJIO expect.

PRODUCT
Brand: [your brand name]
Title: [your product title]
Material: [what it is made of]
Dimensions: [size or weight]
Colourways: [list every colour you sell]`;

  /**
   * Channel search.
   *
   * One box over two lists, because "is Nykaa here" and "is Zalando here" are
   * the same question and a seller should not have to know which list to look
   * in to get an answer. The built connectors rank first and the wanted-list
   * follows, so the reply is either "yes, connected", "yes, wanted" or nothing
   * — and nothing is a real answer too.
   */
  let channelQuery = $state("");

  const builtGroups = $derived(
    data.byGroup
      .map((g) => ({ ...g, channels: fuzzyRank(g.channels, channelQuery, (c) => c.displayName) }))
      .filter((g) => g.channels.length > 0),
  );

  const wantedGroups = $derived(
    ROADMAP.map((g) => ({ ...g, channels: fuzzyRank(g.channels, channelQuery, (c) => c) })).filter(
      (g) => g.channels.length > 0,
    ),
  );

  const builtHits = $derived(builtGroups.reduce((n, g) => n + g.channels.length, 0));
  const wantedHits = $derived(wantedGroups.reduce((n, g) => n + g.channels.length, 0));

  let copiedKey = $state("");
  let copyTimer: ReturnType<typeof setTimeout>;

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copiedKey = key;
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedKey = ""), 2000);
    } catch {
      // Clipboard blocked (insecure origin, denied permission). The text is on
      // screen and selectable, so there is nothing to recover from.
      copiedKey = "";
    }
  }

  /**
   * What ships, stated as features rather than as a stack. Each line is
   * something the running system does today — nothing here is on a roadmap,
   * which is the whole reason the footer keeps a list of what is deliberately
   * absent.
   *
   * One glyph and one sentence each, the same trade the AI section made: nine
   * two-sentence bodies read as a wall, and the second sentence was usually
   * restating the first. What a line cannot say in one sentence belongs in the
   * docs, not on the landing page.
   */
  const FEATURES = [
    { icon: "channels", title: "Marketplaces and social", body: "Twelve channels built for India, two global marketplaces, and Instagram, Facebook and TikTok Shop." },
    { icon: "retry", title: "Durable sync engine", body: "Per-channel jobs, exponential backoff, error classification, dead-letter and manual retry." },
    { icon: "key", title: "Idempotent writes", body: "Every job carries a key, so a retry can never become a second listing." },
    { icon: "preflight", title: "Pre-flight validation", body: "Checked against each marketplace's declared required fields before a job is queued." },
    { icon: "log", title: "Full audit trail", body: "Every attempt, payload and error is recorded." },
    { icon: "import", title: "Order import", body: "Pulled back from each channel and deduplicated on source and external ID." },
    { icon: "lock", title: "Encrypted credentials", body: "AES-256-GCM before the first write. No API handler reads the table." },
    { icon: "braces", title: "REST API", body: "Anything the dashboard does, you can do — it is one client, not a privileged one." },
    { icon: "flask", title: "Mock mode", body: "Every connector ships a simulator, so the pipeline runs with no seller account." },
  ];

  /**
   * The repository, drawn.
   *
   * "Nothing is held back for a hosted version" was three sentences of prose
   * making a claim about absence, which is the hardest thing to state and the
   * easiest thing to draw. Four filled compartments and one empty one say it
   * without asking anyone to take a paragraph on trust.
   */
  const REPO_PARTS = [
    { icon: "retry", label: "Engine", note: "jobs, retries, dead-letter" },
    { icon: "plug", label: "Connectors", note: "every channel, one interface" },
    { icon: "braces", label: "API", note: "REST, unprivileged" },
    { icon: "window", label: "Dashboard", note: "one client of the API" },
  ];

  /**
   * Where your data actually is. Phrased as places and files rather than as
   * promises, because "we respect your privacy" is what everyone says and a
   * path on your own disk is checkable.
   */
  /** What the optional AI feature is and is not. */
  /**
   * The drafting path, left of the line.
   *
   * Three steps because the middle one is the only place a model runs, and
   * seeing it bracketed by a human on each side is the argument. Icons rather
   * than sentences: this is a diagram of who does what, and prose was making
   * readers work to extract a shape.
   */
  const DRAFT_STEPS = [
    { icon: "type", label: "You type", note: "a few words about the product" },
    { icon: "spark", label: "A draft appears", note: "title, category, attributes" },
    { icon: "check", label: "You edit and commit", note: "the committed mapping is what executes" },
  ];

  /**
   * What survives after the six-card version.
   *
   * Two of the original points — "drafts, not decisions" and "never in the sync
   * path" — became the diagram above, which states them better than a
   * paragraph could. These four are the ones a diagram cannot carry, and each
   * is now one sentence with a glyph instead of three without one.
   */
  const AI_POINTS = [
    { icon: "power", title: "Off until you turn it on", body: "No key ships and none is asked for. Without one the deterministic suggester answers and nothing calls out." },
    { icon: "blank", title: "It leaves gaps rather than guessing", body: "Measurements, materials and country of origin stay empty when they cannot be derived. A made-up attribute is a rejected listing at best." },
    { icon: "layers", title: "Your catalogue is the context", body: "Drafts reuse the categories and attribute keys you already use, instead of starting a second taxonomy beside the first." },
    { icon: "plug", title: "Swap it or delete it", body: "One driver behind one config block. Point it at another model, or remove the key and the feature is gone." },
  ];

  /**
   * Line icons, drawn here rather than imported.
   *
   * This page pulls in no icon library on purpose — @lucide/svelte is a
   * dashboard dependency and nothing on the marketing page should be able to
   * drag a package into the bundle. Every glyph is a 24x24 stroke path so they
   * share one weight, and they inherit currentColor so a card that changes
   * tone takes its icon with it.
   */
  const ICONS: Record<string, string[]> = {
    server: [
      "M4 4.5h16v6H4z",
      "M4 13.5h16v6H4z",
      "M7.5 7.5h.01",
      "M7.5 16.5h.01",
    ],
    noVendor: [
      "M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-4A3.5 3.5 0 0 0 4 18.5V20",
      "M9.5 11.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5z",
      "m16.5 7.5 4 4",
      "m20.5 7.5-4 4",
    ],
    noSignal: [
      "M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
      "M8.3 15.7a5.25 5.25 0 0 1 0-7.4",
      "M15.7 8.3a5.25 5.25 0 0 1 0 7.4",
      "M5.5 18.5a9.25 9.25 0 0 1 0-13",
      "M18.5 5.5a9.25 9.25 0 0 1 0 13",
      "m3 3 18 18",
    ],
    database: [
      "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z",
      "M20 6v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6",
      "M20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3",
    ],
    lock: [
      "M6 11h12v9H6z",
      "M9 11V7.5a3 3 0 0 1 6 0V11",
      "M12 14.5v2.5",
    ],
    noGlobe: [
      "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
      "M3.5 9h17",
      "M3.5 15h17",
      "M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z",
      "m3 3 18 18",
    ],
    shield: [
      "M12 3 5 5.8v5.7c0 4.6 3 7.9 7 9.5 4-1.6 7-4.9 7-9.5V5.8z",
      "m9 12 2 2 4-4",
    ],
    ban: [
      "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
      "m5.6 5.6 12.8 12.8",
    ],
    power: [
      "M12 3.5v7.5",
      "M7.6 6.6a6.5 6.5 0 1 0 8.8 0",
    ],
    // Lines of text, shortening: what you actually type is a few words.
    type: [
      "M4 6.5h16",
      "M4 12h9",
      "M4 17.5h6",
    ],
    spark: [
      "m11 5 1.5 3.9 3.9 1.5-3.9 1.5L11 15.8l-1.5-3.9L5.6 10.4l3.9-1.5z",
      "m18 14 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z",
    ],
    check: [
      "m4.5 12.5 5 5 10-11",
    ],
    // A field with a dash in it: the attribute it could not derive, left empty.
    blank: [
      "M4 7.5h16v9H4z",
      "M8.5 12h4",
    ],
    layers: [
      "m12 3.2 8.5 4.8-8.5 4.8L3.5 8z",
      "m3.5 12.6 8.5 4.8 8.5-4.8",
    ],
    plug: [
      "M9 3.5V8",
      "M15 3.5V8",
      "M6.8 8h10.4v2.6a5.2 5.2 0 0 1-10.4 0z",
      "M12 15.8v4.7",
    ],
    // One catalogue, three ways out.
    // Each spoke starts exactly on the hub's circumference and stops short of
    // its terminal node, so the shape reads as a graph. An earlier version had
    // the spokes floating off a smaller hub and it read as a stick figure.
    channels: [
      "M12 16.1a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2z",
      "M12 10.9V7.1",
      "M12 7.1a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z",
      "m14.25 14.8 3.07 1.76",
      "M18.8 19.1a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z",
      "m9.75 14.8-3.07 1.76",
      "M5.2 19.1a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z",
    ],
    // The ladder's shape as a single glyph: it comes back round.
    retry: [
      "M20 12a8 8 0 1 1-2.4-5.7",
      "M20.2 4.2v4.6h-4.6",
    ],
    // The idempotency key, which is the thing that stops a second listing.
    key: [
      "M8 15.6a4.1 4.1 0 1 0 0-8.2 4.1 4.1 0 0 0 0 8.2z",
      "M12 11.5h8.6",
      "M18 11.5v3",
      "M15.2 11.5v2.2",
    ],
    // Checked against the list before it is allowed to leave.
    preflight: [
      "M9.2 4.6H7.6A1.6 1.6 0 0 0 6 6.2v12.9a1.6 1.6 0 0 0 1.6 1.6h8.8a1.6 1.6 0 0 0 1.6-1.6V6.2a1.6 1.6 0 0 0-1.6-1.6h-1.6",
      "M9.2 3h5.6v3.2H9.2z",
      "m9.6 13.2 1.9 1.9 3.3-3.9",
    ],
    // The record of every attempt, kept rather than reconstructed.
    log: [
      "M6 3.4h12v17.2H6z",
      "M9 8.4h6",
      "M9 12h6",
      "M9 15.6h3.2",
    ],
    // Orders arriving: down, and into the tray.
    import: [
      "M12 3.6v9.8",
      "m8.2 9.8 3.8 3.8 3.8-3.8",
      "M4.6 16.9v2.6a1.1 1.1 0 0 0 1.1 1.1h12.6a1.1 1.1 0 0 0 1.1-1.1v-2.6",
    ],
    braces: [
      "M9.2 3.4c-2 0-2.6 1-2.6 2.5v3c0 1.5-.8 2.5-2.5 3.1 1.7.5 2.5 1.6 2.5 3.1v3c0 1.5.6 2.5 2.6 2.5",
      "M14.8 3.4c2 0 2.6 1 2.6 2.5v3c0 1.5.8 2.5 2.5 3.1-1.7.5-2.5 1.6-2.5 3.1v3c0 1.5-.6 2.5-2.6 2.5",
    ],
    // Mock mode: the same pipeline, run in glassware.
    flask: [
      "M9.4 3.4h5.2",
      "M10.6 3.4v6.1L5.3 18.2a1.6 1.6 0 0 0 1.4 2.4h10.6a1.6 1.6 0 0 0 1.4-2.4l-5.3-8.7V3.4",
      "M7.7 14.6h8.6",
    ],
    window: [
      "M3.6 5h16.8v14H3.6z",
      "M3.6 9.2h16.8",
      "M9.4 9.2V19",
    ],
  };

  const PRIVACY = [
    { icon: "noVendor", title: "No account, no vendor", body: "There is nothing to sign up for. bun dev runs the whole system on your laptop or your own server." },
    { icon: "noSignal", title: "No telemetry", body: "Nothing is phoned home. There is no analytics endpoint to find and disable, because none was written." },
    { icon: "database", title: "Your data is one file", body: "A SQLite database under data/. Back it up by copying it. Delete it by deleting it." },
    { icon: "lock", title: "Keys stay local", body: "The encryption key is generated on your machine on first boot and never leaves it." },
    { icon: "noGlobe", title: "No runtime calls out", body: "Fonts and marketplace artwork are served from your own disk. The one command that reaches the internet is bun logos, and it is opt-in." },
    { icon: "shield", title: "Your credentials, your server", body: "Marketplace credentials are encrypted at rest and used only to talk to that marketplace." },
  ];
</script>

<svelte:head>
  <title>OpenCommerce · free, open-source, self-hosted commerce sync</title>
  <meta
    name="description"
    content="Free, open-source, self-hosted commerce infrastructure. Publish one catalogue to {data.counts.channels} marketplaces and social channels with retries, idempotency and a full audit trail. MIT licensed, no paid tier, no telemetry — it runs on your own machine."
  />
</svelte:head>

<!--
  The landing page commits to the peacock ground in both themes. It is a brand
  surface rather than a tool, and the app behind it is where the light theme
  earns its keep; a marketing page that changes identity with an OS setting has
  no identity. Colours here are the theme-independent brand tokens, never the
  semantic ones, which is why nothing below reads `bg-background`.
-->
{#snippet glyph(name: string, size: string)}
  <svg
    viewBox="0 0 24 24"
    class={size}
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {#each ICONS[name] ?? [] as d (d)}
      <path {d} />
    {/each}
  </svg>
{/snippet}

<div class="min-h-screen bg-peacock-deep text-chalk">
  <!-- ── header ───────────────────────────────────────────────────────── -->
  <header class="mx-auto flex max-w-6xl items-center gap-4 px-5 py-5 sm:px-8">
    <a href="/" class="flex items-center gap-2.5 hover:no-underline">
      <img src="/logo.svg" alt="" width="30" height="30" />
      <span class="board text-[1.05rem] text-chalk">OpenCommerce</span>
    </a>

    <nav class="ml-auto flex items-center gap-1.5">
      <!--
        A link, not a count. Rendering the number would mean calling github.com
        on every page load — the exact thing the Privacy section below promises
        this page does not do.
      -->
      <a
        href={REPO}
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
        <!-- &nbsp; rather than a plain space: Svelte trims the leading
             whitespace of the inner span's text node, which ran the two words
             together as "Staron GitHub" once the span became inline. -->
        <span>Star<span class="hidden sm:inline">&nbsp;on GitHub</span></span>
      </a>
      <a
        href="/login"
        class="rounded-md bg-gold px-3.5 py-1.5 text-sm font-semibold text-peacock-deep transition-opacity hover:opacity-90 hover:no-underline"
      >
        Sign in
      </a>
    </nav>
  </header>

  <!-- ── hero ─────────────────────────────────────────────────────────── -->
  <section class="mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14 lg:pb-24 lg:pt-16">
    <div class="min-w-0 self-center">
      <!--
        The three words the product is sold on, and each one is checkable
        rather than a mood: free means there is no paid tier, open source means
        MIT and the whole repository, private means it runs on your machine and
        phones nothing home. Every one of them has a section further down that
        backs it.

        This used to read "MIT · zero runtime dependencies", which stopped
        being true the day the dashboard became SvelteKit — the built server
        resolves @sveltejs/kit and about forty other packages. Leaving a false
        claim in the first line of a page whose whole argument is that it does
        not overclaim was the worst possible place to have one.
      -->
      <p class="board-label mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.7rem] text-gold">
        <span>Free</span>
        <span class="text-gold/35" aria-hidden="true">·</span>
        <span>Open source</span>
        <span class="text-gold/35" aria-hidden="true">·</span>
        <span>Runs on your machine</span>
      </p>

      <h1 class="board text-[clamp(2.4rem,6.2vw,4rem)] text-chalk">
        Publish <span class="text-gold">one</span> catalogue to
        <span class="text-gold">{platformsPlus}</span> ecommerce platforms.
      </h1>

      <p class="mt-6 max-w-lg text-[1.05rem] leading-relaxed text-chalk/70">
        Free and open-source commerce infrastructure for marketplaces and social
        selling. Retries, idempotency and a full audit trail — from a single
        command, on your own machine. No account, no vendor, nothing phoned
        home.
      </p>

      <!--
        The install block is the call to action. For a self-hosted tool the
        thing a visitor should do next is run it, so the commands get the
        weight a "Get started" button would otherwise take.
      -->
      <div class="mt-8 max-w-md overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
        <div class="flex items-center justify-between gap-3 border-b border-white/10 px-3.5 py-2">
          <span class="board-label text-[0.62rem] text-chalk/40">Run it</span>
          <button
            type="button"
            onclick={() => copy("install", INSTALL)}
            class="machine rounded px-2 py-0.5 text-[0.7rem] text-chalk/55 transition-colors hover:bg-white/10 hover:text-chalk
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-peacock-deep"
          >
            {copiedKey === "install" ? "copied" : "copy"}
          </button>
        </div>
        <pre class="machine overflow-x-auto px-3.5 py-3 text-[0.82rem] leading-relaxed text-chalk/90"><span class="select-none text-gold">$ </span>git clone {REPO}
<span class="select-none text-gold">$ </span>cd opencommerce
<span class="select-none text-gold">$ </span>bun i
<span class="select-none text-gold">$ </span>bun seed
<span class="select-none text-gold">$ </span>bun dev</pre>
      </div>

      <p class="machine mt-3 text-[0.75rem] text-chalk/40">
        demo@opencommerce.dev · demo1234
      </p>
    </div>

    <!-- ── the board: the signature ──────────────────────────────────── -->
    <!--
      One SKU on the left, every channel it reaches on the right. This is the
      README's fan-out diagram, drawn with the real registry and real IDs.
    -->
    <div class="min-w-0 self-center">
      <div class="overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/10 px-4 py-3">
          <div class="min-w-0">
            <p class="board-label text-[0.62rem] text-chalk/40">Consignment</p>
            <p class="machine mt-1 truncate text-[0.9rem] font-semibold text-chalk">
              {data.sku}
            </p>
          </div>
          <p class="machine shrink-0 text-[0.7rem] text-chalk/40">mock mode</p>
        </div>

        <div class="flex px-4 py-3">
          <!-- Decorative: the same information is in the rows beside it. -->
          <svg
            class="fan shrink-0"
            width={FAN_W}
            height={boardH}
            viewBox="0 0 {FAN_W} {boardH}"
            fill="none"
            aria-hidden="true"
          >
            {#each data.channels as _, i (i)}
              <path
                d={curve(i)}
                pathLength="1"
                stroke="currentColor"
                class="text-verdigris/45"
                stroke-width="1"
                style="animation-delay: {i * 45}ms"
              />
            {/each}
            <circle cx="2" cy={originY} r="3" class="fill-gold" />
          </svg>

          <ul class="min-w-0 flex-1">
            {#each data.channels as channel, i (channel.name)}
              {@const s = stateFor(i)}
              <li
                class="row flex items-center gap-2.5"
                style="height: {ROW_H}px; animation-delay: {i * 45 + 120}ms"
              >
                <!-- Desaturated unless the connector is usable today. The
                     board is simulator output either way, but it should not
                     read as seventeen live integrations. -->
                <span class="shrink-0 leading-none {channel.ready ? '' : 'opacity-45 grayscale'}">
                  {@html channel.mark}
                </span>

                <span
                  class="min-w-0 flex-1 truncate text-[0.82rem] {channel.ready
                    ? 'text-chalk/90'
                    : 'text-chalk/45'}"
                >
                  {channel.displayName}
                </span>

                <span class="machine hidden shrink-0 text-[0.7rem] text-chalk/35 sm:inline">
                  {s.kind === "listed" ? channel.remoteId : (s.note ?? "—")}
                </span>

                <span class="board-label w-[4.6rem] shrink-0 text-right text-[0.58rem] {TONE[s.kind]}">
                  {s.kind}
                </span>
              </li>
            {/each}
          </ul>
        </div>
      </div>

      <p class="mt-3 text-[0.78rem] leading-relaxed text-chalk/40">
        Simulator output. Every connector ships a mock path, so the whole
        pipeline runs on a fresh clone with no seller account.
      </p>
    </div>
  </section>

  <!-- ── start small, grow ────────────────────────────────────────────── -->
  <!--
    The positioning line, sat directly under the hero: the hero says what the
    product does, this says what happens when you outgrow the version of it you
    started with. Two columns, because the claim has two halves and putting them
    side by side is the argument — the same catalogue, the same core, one
    command at the start and real infrastructure at the end.

    Both figures are read from the page's own data rather than typed, so the
    "grow" half cannot quietly become a smaller promise than the product.
  -->
  <section class="border-t border-white/10 bg-peacock-lift">
    <div class="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-16">
      <h2 class="board max-w-3xl text-[clamp(1.5rem,3.2vw,2.1rem)] text-chalk">
        Start in one command. Grow without a rewrite.
      </h2>

      <div class="mt-9 grid gap-8 sm:grid-cols-2 sm:gap-12 lg:gap-16">
        <div class="min-w-0">
          <p class="board-label mb-3 text-[0.6rem] text-gold">Day one</p>
          <p class="machine text-[0.95rem] font-semibold text-chalk">bun dev</p>
          <p class="mt-2.5 text-[0.86rem] leading-relaxed text-chalk/60">
            No database to install, no broker, no API keys, no config file.
            Bun's built-in SQLite is both the database and the job queue, and
            the encryption key is generated on first boot.
          </p>
        </div>

        <!--
          The rule is the join, not decoration: it marks the same system on
          both sides of the change. Horizontal on a phone where the columns
          stack, vertical once they sit beside each other.
        -->
        <div class="min-w-0 border-t border-white/12 pt-8 sm:border-l sm:border-t-0 sm:pl-12 sm:pt-0 lg:pl-16">
          <p class="board-label mb-3 text-[0.6rem] text-gold">When you outgrow it</p>
          <p class="machine text-[0.95rem] font-semibold text-chalk">
            {data.counts.channels} connectors · {PORTS.length} swappable ports
          </p>
          <p class="mt-2.5 text-[0.86rem] leading-relaxed text-chalk/60">
            A new marketplace is one file and one line in the registry. Postgres,
            Redis, Kafka, S3 or Vault is a driver swap. Neither is a migration,
            and neither touches the core — which is why the ceiling here is the
            infrastructure you choose, not the thing you started on.
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- ── the dashboard ────────────────────────────────────────────────── -->
  <!--
    Real screenshots of the running app on seeded demo data, not mockups, and
    not restyled to match this page.

    Dark, because the app has a real dark theme and this page is permanently
    peacock — a light panel here reads as a hole punched in the section, and
    nobody arriving on a dark page wants to be flashbanged by the product.
    Nothing is being oversold by the choice: light, dark and system all ship,
    system is the default, and the switch is in the account menu.

    Each sits in a frame with a title bar so it reads as a screen rather than
    as a section that happens to have a slightly different background.
  -->
  <section id="dashboard" class="scroll-mt-4 border-t border-white/10 bg-peacock">
    <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
      <div class="max-w-2xl">
        <p class="board-label mb-4 text-[0.66rem] text-gold">The dashboard</p>
        <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
          One client of the API, with no privileges of its own.
        </h2>
        <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
          Everything below happens over the same REST API you can call yourself.
          Nothing here is a mockup — this is <span class="machine">bun seed</span>
          data on a fresh clone, in mock mode, with no seller account.
        </p>
      </div>

      <div class="mt-10 space-y-8">
        {#each [
          { src: "/shots/overview-dark.jpg", w: 1510, h: 812, title: "Overview",
            alt: "The OpenCommerce overview screen: catalogue, live listings, order and out-of-stock figures, a needs-attention list, and a card per connected channel showing how much of the catalogue is live.",
            cap: "What is broken first, then the numbers, then the channels, then the day's trade." },
          { src: "/shots/channels-dark.jpg", w: 1510, h: 812, title: "Channels",
            alt: "The channels screen: a table of connected marketplace accounts with health, mode and listing counts, above a grid of available connectors grouped by market.",
            cap: "Every connector, grouped by market. Each one tests its credentials without leaving the page." },
        ] as shot (shot.src)}
          <figure class="min-w-0">
            <div class="overflow-hidden rounded-xl border border-white/12 bg-white/[0.04] shadow-2xl shadow-black/40">
              <!-- A window bar. The screenshot and the section are now close
                   enough in value that without one the image would bleed into
                   the page and stop reading as a screen at all. -->
              <div class="flex items-center gap-2 border-b border-white/10 px-3.5 py-2.5">
                <span class="size-2 rounded-full bg-rust/70"></span>
                <span class="size-2 rounded-full bg-gold/70"></span>
                <span class="size-2 rounded-full bg-verdigris/70"></span>
                <span class="board-label ml-2 text-[0.58rem] text-chalk/35">{shot.title}</span>
              </div>
              <img
                src={shot.src}
                alt={shot.alt}
                width={shot.w}
                height={shot.h}
                loading="lazy"
                decoding="async"
                class="block h-auto w-full"
              />
            </div>
            <figcaption class="mt-3 text-[0.8rem] leading-relaxed text-chalk/45">
              {shot.cap}
            </figcaption>
          </figure>
        {/each}
      </div>
    </div>
  </section>

  <!-- ── pipeline ─────────────────────────────────────────────────────── -->
  <section class="border-t border-white/10 bg-peacock">
    <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
      <h2 class="board max-w-2xl text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
        A product is entered once. The engine works out the rest.
      </h2>

      <ol class="mt-10 grid gap-x-8 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
        {#each PIPELINE as step, i (step.title)}
          <li class="border-t border-white/12 pt-4">
            <!--
              Numbered because this genuinely is a sequence: validation has to
              precede planning, and recording follows execution. The numbers
              carry order the reader needs, rather than decorating four
              unrelated cards.
            -->
            <div class="mb-2.5 flex items-baseline gap-2.5">
              <span class="machine text-[0.72rem] text-gold">{i + 1}</span>
              <h3 class="board text-[1.05rem] text-chalk">{step.title}</h3>
            </div>
            <p class="text-[0.85rem] leading-relaxed text-chalk/60">{step.body}</p>
          </li>
        {/each}
      </ol>
    </div>
  </section>

  <!-- ── retry ladder ─────────────────────────────────────────────────── -->
  <section class="border-t border-white/10">
    <div class="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-16 lg:py-20">
      <div>
        <p class="board-label mb-4 text-[0.66rem] text-gold">The retry ladder</p>
        <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
          A failed job is not a lost job.
        </h2>
        <p class="mt-5 max-w-md text-[0.92rem] leading-relaxed text-chalk/65">
          Errors are classified before they are retried. A rate limit backs off
          and comes back; a malformed payload does not, because trying it four
          more times cannot help. Anything that exhausts the ladder is
          dead-lettered with its last error intact, and can be retried by hand
          once the cause is fixed.
        </p>
      </div>

      <!--
        The ladder is read from BACKOFF_MS, so the page cannot claim a schedule
        the queue does not run. Each rung is taller than the last: the shape of
        the wait is the point.
      -->
      <div class="self-end">
        <ol class="flex items-end gap-1.5 sm:gap-2.5">
          {#each data.ladder as delay, i (delay)}
            <li class="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span class="machine text-[0.68rem] text-chalk/55 sm:text-[0.78rem]">{delay}</span>
              <span
                class="w-full rounded-t-sm bg-gold/85"
                style="height: {14 + i * 17}px"
              ></span>
              <span class="machine text-[0.62rem] text-chalk/30">{i + 1}</span>
            </li>
          {/each}

          <li class="flex min-w-0 flex-1 flex-col items-center gap-2">
            <span class="machine text-[0.68rem] text-rust sm:text-[0.78rem]">dead</span>
            <span class="w-full rounded-t-sm bg-rust/60" style="height: {14 + 5 * 17}px"></span>
            <span class="machine text-[0.62rem] text-chalk/30">—</span>
          </li>
        </ol>
        <p class="mt-4 text-[0.78rem] text-chalk/40">
          Five attempts over roughly forty minutes, then the dead-letter queue.
        </p>
      </div>
    </div>
  </section>

  <!-- ── open source ──────────────────────────────────────────────────── -->
  <section id="features" class="scroll-mt-4 border-t border-white/10 bg-peacock">
    <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
      <div class="max-w-2xl">
        <p class="board-label mb-4 text-[0.66rem] text-gold">Open source</p>
        <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
          MIT licensed. There is no paid tier.
        </h2>
        <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
          Fork it, read it, change the parts that do not fit your catalogue.
        </p>
      </div>

      <!--
        The claim, drawn.
        One box, not two, because the argument is that there is only one thing
        to have: the four parts sit inside the same container, and the strip
        along the bottom is the compartment a hosted tier would keep for
        itself. It is drawn empty, at the same weight as the others, so the
        absence is something you see rather than something you are told.
      -->
      <div class="mt-10 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
        <div class="p-5 sm:p-7">
          <p class="board-label mb-5 text-[0.58rem] text-gold">What the repository contains</p>
          <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {#each REPO_PARTS as part (part.label)}
              <li class="rounded-lg border border-gold/25 bg-gold/[0.06] p-4">
                <div class="mb-2.5 flex items-center gap-2.5">
                  <span class="shrink-0 text-gold">
                    {@render glyph(part.icon, "size-[1.15rem]")}
                  </span>
                  <span class="board text-[0.95rem] text-chalk">{part.label}</span>
                </div>
                <p class="machine text-[0.72rem] leading-snug text-chalk/45">{part.note}</p>
              </li>
            {/each}
          </ul>
        </div>

        <div
          class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/10 bg-rust/[0.06]
                 px-5 py-4 sm:px-7"
        >
          <span class="shrink-0 text-rust">{@render glyph("ban", "size-[1.15rem]")}</span>
          <p class="board-label text-[0.58rem] text-chalk/40">Held back for a paid tier</p>
          <span class="machine ml-auto text-[0.85rem] text-rust">nothing</span>
        </div>
      </div>

      <ul class="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
        {#each FEATURES as f (f.title)}
          <li class="border-t border-white/12 pt-4">
            <div class="mb-2 flex items-center gap-2.5">
              <span class="shrink-0 text-gold/75">{@render glyph(f.icon, "size-[1.1rem]")}</span>
              <h3 class="board text-[1rem] text-chalk">{f.title}</h3>
            </div>
            <p class="text-[0.85rem] leading-relaxed text-chalk/60">{f.body}</p>
          </li>
        {/each}
      </ul>
    </div>
  </section>

  <!-- ── privacy / self-hosted ────────────────────────────────────────── -->
  <section id="privacy" class="scroll-mt-4 border-t border-white/10">
    <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
      <div class="max-w-2xl">
        <p class="board-label mb-4 text-[0.66rem] text-gold">Private by default</p>
        <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
          You are not giving your data to another business.
        </h2>
        <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
          This is not a service with a privacy policy. It is software you run,
          on your own PC or your own server. There is no account, no vendor
          backend and no middleman — the only parties to your catalogue are you
          and the marketplaces you deliberately publish to.
        </p>
      </div>

      <!--
        The claim, drawn.
        Laid out as flex rather than a hand-plotted SVG so it reflows on a
        phone: the two boxes stack, the arrow turns to point down, and nothing
        needs a viewBox recalculated to stay legible.
      -->
      <div class="mt-10 rounded-xl border border-white/10 bg-white/[0.03] p-5 sm:p-7">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-stretch">
          <div class="flex-1 rounded-lg border border-gold/25 bg-gold/[0.06] p-4">
            <div class="mb-2.5 flex items-center gap-2.5 text-gold">
              {@render glyph("server", "size-[1.15rem] shrink-0")}
              <span class="board text-[0.95rem] text-chalk">Your machine</span>
            </div>
            <p class="text-[0.82rem] leading-relaxed text-chalk/60">
              The app, the SQLite file and the encryption key. All three are on
              disk where you put them.
            </p>
          </div>

          <!-- Rotated a quarter turn on wide screens, so one glyph serves both
               the stacked and the side-by-side layout. -->
          <div class="flex items-center justify-center gap-2 lg:w-28 lg:flex-col">
            <svg viewBox="0 0 48 24" class="w-12 rotate-90 text-gold/60 lg:rotate-0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M2 12h42" />
              <path d="m36 6 8 6-8 6" />
            </svg>
            <span class="board-label text-[0.58rem] text-chalk/40">direct</span>
          </div>

          <div class="flex-1 rounded-lg border border-white/12 p-4">
            <div class="mb-2.5 flex items-center gap-2.5">
              {@render glyph("shield", "size-[1.15rem] shrink-0 text-verdigris")}
              <span class="board text-[0.95rem] text-chalk">Marketplaces you chose</span>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              {#each data.channels.slice(0, 9) as c (c.name)}
                <span class="shrink-0 leading-none opacity-90">{@html c.mark}</span>
              {/each}
            </div>
          </div>
        </div>

        <!--
          The absent middleman. Naming what is not in the path does more work
          than another line about what is, because it is the row a reader is
          already scanning for.
        -->
        <div class="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-white/12 px-4 py-3">
          <span class="shrink-0 text-rust/70">{@render glyph("ban", "size-[1.05rem]")}</span>
          <span class="text-[0.84rem] text-chalk/35 line-through decoration-rust/50">
            Analytics · vendor cloud · data broker · a server of ours
          </span>
          <span class="board-label ml-auto shrink-0 text-[0.58rem] text-gold/70">
            not in the path
          </span>
        </div>
      </div>

      <ul class="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
        {#each PRIVACY as p (p.title)}
          <li class="rounded-xl border border-white/10 p-4">
            <div class="mb-2 flex items-center gap-2.5">
              <span class="shrink-0 text-gold/75">{@render glyph(p.icon, "size-[1.1rem]")}</span>
              <h3 class="board text-[0.95rem] text-chalk">{p.title}</h3>
            </div>
            <p class="text-[0.85rem] leading-relaxed text-chalk/60">{p.body}</p>
          </li>
        {/each}
      </ul>

      <!--
        Stated here rather than left for someone to discover under the AI
        section. "Private by default" is only worth printing if the two things
        that are not private by default are printed beside it.
      -->
      <p class="mt-8 max-w-3xl text-[0.82rem] leading-relaxed text-chalk/45">
        <span class="text-chalk/70">Two exceptions, both opt-in, both yours.</span>
        Turn on AI drafting and the product text you are drafting goes to
        Anthropic. Use the image prompt below and your photo goes to whichever
        model you paste it into. Neither is on by default, neither is needed to
        publish anything, and in both cases the data goes to the vendor you
        chose — never to us, because there is no us for it to reach.
      </p>
    </div>
  </section>

  <!-- ── connectors, honestly ─────────────────────────────────────────── -->

  <!-- ── optional AI ──────────────────────────────────────────────────── -->
  <!--
    Placed after Privacy deliberately. "We added AI" is the sentence that
    undoes a self-hosted promise, so the answer to what it costs you sits in
    the reader's mind from the section immediately above.
  -->
  <section id="ai" class="scroll-mt-4 border-t border-white/10 bg-peacock">
    <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
      <div class="max-w-2xl">
        <p class="board-label mb-4 text-[0.66rem] text-gold">Optional</p>
        <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
          AI that drafts listings. Not one that publishes them.
        </h2>
        <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
          Writing the same title, description and twelve attributes for every
          product is the slow part of listing a catalogue. Bring your own key
          and a draft arrives on the form. Leave it unset and none of this
          exists.
        </p>
      </div>

      <!--
        The line.
        ---------
        This section used to argue its case in three paragraphs and six cards.
        The case is a boundary — a model may help you fill a form, and may
        never touch the path that publishes it — and a boundary is a picture,
        not an essay. Everything left of the rule is assistive and reversible;
        everything right of it has to be byte-identical on a retry.

        The asymmetry is deliberate. The left side has glyphs because people
        act there. The right side is bare machine type and numbers, because
        nothing on it is anybody's judgement call.
      -->
      <div class="mt-10 overflow-hidden rounded-xl border border-white/10 bg-white/[0.03]">
        <div class="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div class="p-6 sm:p-7">
            <p class="board-label mb-5 text-[0.58rem] text-gold">Where a model may run</p>
            <ol class="space-y-4">
              {#each DRAFT_STEPS as step (step.label)}
                <li class="flex items-start gap-3">
                  <span class="mt-px shrink-0 text-gold/80">
                    {@render glyph(step.icon, "size-[1.15rem]")}
                  </span>
                  <span class="min-w-0">
                    <span class="block text-[0.9rem] leading-snug text-chalk">{step.label}</span>
                    <span class="block text-[0.78rem] leading-snug text-chalk/45">{step.note}</span>
                  </span>
                </li>
              {/each}
            </ol>
          </div>

          <!-- The rule, with the refusal sitting on it. -->
          <div
            class="relative flex items-center justify-center border-y border-white/10 bg-rust/[0.06] px-6 py-5
                   lg:border-x lg:border-y-0 lg:px-7 lg:py-8"
          >
            <span class="h-px w-full bg-rust/30 lg:h-full lg:w-px"></span>
            <span
              class="absolute grid size-9 place-items-center rounded-full border border-rust/45 bg-peacock text-rust"
            >
              {@render glyph("ban", "size-[1.05rem]")}
            </span>
          </div>

          <div class="p-6 sm:p-7">
            <p class="board-label mb-5 text-[0.58rem] text-chalk/40">Where it never does</p>
            <!--
              The same four steps the pipeline section names, read from that
              array so the two can never describe the engine differently.
            -->
            <ol class="machine space-y-2.5 text-[0.85rem] text-chalk/85">
              {#each PIPELINE as step, i (step.title)}
                <li class="flex items-baseline gap-2.5">
                  <span class="text-[0.72rem] text-chalk/25">{i + 1}</span>
                  {step.title.toLowerCase()}
                </li>
              {/each}
            </ol>
            <p class="mt-5 text-[0.78rem] leading-relaxed text-chalk/45">
              A retry has to rebuild byte-identical input. A model here could
              differ on the second attempt while the idempotency key still
              swears the two match — which is how one product becomes two
              listings.
            </p>
          </div>
        </div>
      </div>

      <ul class="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2">
        {#each AI_POINTS as p (p.title)}
          <li class="rounded-xl border border-white/10 p-4">
            <div class="mb-2 flex items-center gap-2.5">
              <span class="shrink-0 text-gold/75">{@render glyph(p.icon, "size-[1.1rem]")}</span>
              <h3 class="board text-[0.95rem] text-chalk">{p.title}</h3>
            </div>
            <p class="text-[0.85rem] leading-relaxed text-chalk/60">{p.body}</p>
          </li>
        {/each}
      </ul>

      <!--
        Deliberately not sold as a feature. It is a prompt, it runs in someone
        else's tool, and pretending otherwise would be the kind of AI claim the
        section above is at pains not to make.
      -->
      <div class="mt-12 border-t border-white/10 pt-10">
        <div class="max-w-2xl">
          <h3 class="board text-[1.15rem] text-chalk">
            And the photographs, from one snapshot.
          </h3>
          <p class="mt-3 text-[0.9rem] leading-relaxed text-chalk/65">
            Most sellers have one photo, taken on a phone. A listing wants a
            dozen. Paste this into any image model that accepts a reference
            picture, attach the photo, and it produces the set — nothing here
            calls OpenCommerce, so it works whether or not you run this project.
          </p>
        </div>

        <!--
          The shot list, shown rather than listed in a sentence. One photo in,
          a dozen out: the same one-to-many the fan at the top of the page is
          about, at the scale of a single product.
        -->
        <div class="mt-6 flex flex-wrap items-center gap-x-2 gap-y-2 text-[0.72rem]">
          <span class="machine rounded-md border border-gold/40 bg-gold/10 px-2.5 py-1 text-gold">
            1 phone photo
          </span>
          <span class="text-chalk/25" aria-hidden="true">→</span>
          {#each ["on white", "back", "side", "detail", "in scale", "in use", "packaging", "+5 more"] as shot (shot)}
            <span class="machine rounded-md border border-white/10 px-2.5 py-1 text-chalk/55">
              {shot}
            </span>
          {/each}
        </div>

        <p class="mt-4 max-w-2xl text-[0.8rem] leading-relaxed text-chalk/45">
          The shot list is marketplace convention, not something the connectors
          declare — they require one image, and Amazon adds a 1000px floor. The
          prompt tells the model never to invent a side it cannot see, and that
          is the instruction worth checking every result against.
        </p>

        <div class="mt-6 max-w-2xl overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
          <div class="flex items-center justify-between gap-3 border-b border-white/10 px-3.5 py-2">
            <span class="board-label text-[0.62rem] text-chalk/40">Image prompt</span>
            <button
              type="button"
              onclick={() => copy("images", IMAGE_PROMPT)}
              class="machine rounded px-2 py-0.5 text-[0.7rem] text-chalk/55 transition-colors hover:bg-white/10 hover:text-chalk
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-peacock-deep"
            >
              {copiedKey === "images" ? "copied" : "copy"}
            </button>
          </div>
          <!-- Capped and scrollable: at full height this is most of a screen,
               and it is meant to be copied rather than read straight through. -->
          <pre class="machine max-h-72 overflow-auto whitespace-pre-wrap px-3.5 py-3 text-[0.76rem] leading-relaxed text-chalk/80">{IMAGE_PROMPT}</pre>
        </div>
      </div>

      <div class="mt-10 max-w-md overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
        <div class="border-b border-white/10 px-3.5 py-2">
          <span class="board-label text-[0.62rem] text-chalk/40">Turn it on</span>
        </div>
        <pre class="machine overflow-x-auto px-3.5 py-3 text-[0.82rem] leading-relaxed text-chalk/90"><span class="select-none text-gold">$ </span>bun add @anthropic-ai/sdk
<span class="select-none text-gold">$ </span>export ANTHROPIC_API_KEY=sk-ant-...</pre>
      </div>
    </div>
  </section>

  <section id="connectors" class="scroll-mt-4 border-t border-white/10 bg-peacock">
    <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
      <div class="max-w-2xl">
        <p class="board-label mb-4 text-[0.66rem] text-gold">Connectors</p>
        <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
          {data.counts.ready} ready to use.
          {data.counts.channels - data.counts.ready} still in development.
        </h2>
        <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
          Only {data.counts.ready} of these marketplaces publish an API anyone can
          register for, and those are the ones you can point a real catalogue at
          today. The other {data.counts.channels - data.counts.ready} are written —
          each declares its fields, runs in mock mode and moves through the same
          pipeline — but their APIs are partner-gated, so none has been proven
          against a live account. They are greyed out below, and they stay greyed
          out until that changes.
        </p>
      </div>

      <!--
        Grouped by market rather than split ready/in-development. The split was
        the honest thing to lead with but a poor way to *find* a marketplace —
        a seller arrives asking "is Nykaa here", not "which three are provable".
        Verification survives as a mark on the connectors that earned it, with
        the legend directly under the heading so it is read before the grid.
      -->
      <p class="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[0.78rem] text-chalk/45">
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block size-1.5 rounded-full bg-verdigris"></span>
          ready to use — checked against the live API
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block size-1.5 rounded-full bg-chalk/25"></span>
          in development — built and mock-tested, API not yet reachable
        </span>
      </p>

      <!--
        Client-side because the whole corpus is a few hundred short strings
        that already shipped with the page. A round trip per keystroke to
        filter something already in memory would be slower and would be the
        page's first call out.
      -->
      <div class="mt-8 max-w-md">
        <label class="sr-only" for="channel-search">Search channels</label>
        <input
          id="channel-search"
          type="search"
          bind:value={channelQuery}
          autocomplete="off"
          placeholder="Search {data.counts.channels} built, {ROADMAP_COUNT} wanted…"
          class="machine w-full rounded-lg border border-white/12 bg-white/[0.04] px-3.5 py-2 text-[0.85rem]
                 text-chalk transition-colors placeholder:text-chalk/30 focus:border-gold/40
                 focus:outline-none focus:ring-2 focus:ring-gold/20"
        />
        {#if channelQuery.trim()}
          <p class="machine mt-2 text-[0.72rem] text-chalk/35">
            {builtHits} built · {wantedHits} wanted
          </p>
        {/if}
      </div>

      {#if channelQuery.trim() && builtHits === 0 && wantedHits === 0}
        <p class="mt-8 max-w-2xl text-[0.88rem] leading-relaxed text-chalk/50">
          Nothing matches <span class="machine text-chalk/80">{channelQuery}</span>. That is not a
          no — it is a marketplace nobody has asked for yet. Open an issue and it
          lands on the wanted-list.
        </p>
      {/if}

      <div class="mt-9 space-y-8">
        {#each builtGroups as group (group.label)}
          <div>
            <div class="mb-3 flex items-baseline gap-3">
              <h3 class="board-label shrink-0 text-[0.62rem] text-gold">{group.label}</h3>
              <span class="h-px min-w-0 flex-1 bg-white/10"></span>
              <span class="machine shrink-0 text-[0.7rem] text-chalk/30">
                {group.channels.length}
              </span>
            </div>

            {#if GROUP_NOTE[group.label]}
              <p class="mb-3 max-w-2xl text-[0.78rem] leading-relaxed text-chalk/45">
                {GROUP_NOTE[group.label]}
              </p>
            {/if}

            <ul class="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {#each group.channels as c (c.name)}
                <!--
                  Greyscale carries the status at a glance, but never alone:
                  the word beside it is what makes the state readable to anyone
                  who cannot separate the two by colour, and the only thing a
                  screen reader has to go on.
                -->
                <li
                  class="flex items-center gap-2.5 rounded-lg border px-3 py-2
                         {c.ready ? 'border-verdigris/30 bg-verdigris/8' : 'border-white/10'}"
                >
                  <span class="shrink-0 leading-none {c.ready ? '' : 'opacity-40 grayscale'}">
                    {@html c.mark}
                  </span>
                  <span
                    class="min-w-0 flex-1 truncate text-[0.85rem] {c.ready
                      ? 'text-chalk/85'
                      : 'text-chalk/40'}"
                  >
                    {c.displayName}
                  </span>
                  {#if c.ready}
                    <span class="inline-block size-1.5 shrink-0 rounded-full bg-verdigris"></span>
                    <span class="board-label shrink-0 text-[0.55rem] text-verdigris/80">ready</span>
                  {:else}
                    <span class="board-label shrink-0 text-[0.55rem] text-chalk/25">in dev</span>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>

      <p class="mt-8 max-w-2xl text-[0.78rem] leading-relaxed text-chalk/40">
        Mock mode is unaffected either way. Correcting a path or a field name
        once you have real credentials is a one-file change.
      </p>

      <!--
        Kept visually quieter than the grid above on purpose. These are names,
        not integrations, and the two must never be mistaken for each other at
        a glance — no logos, no colour, no status dot.
      -->
      {#if wantedGroups.length}
        <div class="mt-12 border-t border-white/10 pt-10">
          <div class="max-w-2xl">
            <h3 class="board text-[1.15rem] text-chalk">Wanted, not built</h3>
            <p class="mt-3 text-[0.9rem] leading-relaxed text-chalk/60">
              {ROADMAP_COUNT} channels with no connector behind them. Nothing here
              is integrated and none of it can be connected — it is a list of what
              has been asked for, published so you can check before assuming
              rather than after. A connector is one file and one line in the
              registry; the guide is in
              <span class="machine text-chalk/75">docs/connector-development.md</span>.
            </p>
          </div>

          <div class="mt-6 space-y-5">
            {#each wantedGroups as group (group.label)}
              <div>
                <h4 class="board-label mb-2 text-[0.58rem] text-chalk/35">{group.label}</h4>
                <ul class="flex flex-wrap gap-1.5">
                  {#each group.channels as name (name)}
                    <li
                      class="rounded-md border border-white/[0.08] px-2.5 py-1 text-[0.78rem] text-chalk/40"
                    >
                      {name}
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </section>

  <!-- ── stack ────────────────────────────────────────────────────────── -->
  <section id="stack" class="scroll-mt-4 border-t border-white/10">
    <div class="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
      <div class="max-w-2xl">
        <p class="board-label mb-4 text-[0.66rem] text-gold">The stack</p>
        <h2 class="board text-[clamp(1.6rem,3.4vw,2.3rem)] text-chalk">
          Nothing to install, because everything is a driver.
        </h2>
        <p class="mt-5 text-[0.92rem] leading-relaxed text-chalk/65">
          Every port ships a default that needs no external infrastructure, and
          each one is a seam rather than a ceiling. The default queue is durable,
          not absent: jobs live in the same database as your data, so the event
          and the state change commit in one transaction.
        </p>
      </div>

      <div class="mt-10 overflow-x-auto">
        <table class="w-full min-w-[34rem] border-collapse text-left">
          <thead>
            <tr class="border-b border-white/15">
              <th class="board-label py-2.5 pr-4 text-[0.6rem] text-chalk/40">Port</th>
              <th class="board-label py-2.5 pr-4 text-[0.6rem] text-chalk/40">Default</th>
              <th class="board-label py-2.5 text-[0.6rem] text-chalk/40">Drivers later</th>
            </tr>
          </thead>
          <tbody>
            {#each PORTS as row (row.port)}
              <tr class="border-b border-white/8">
                <td class="machine py-2.5 pr-4 text-[0.82rem] text-gold">{row.port}</td>
                <td class="py-2.5 pr-4 text-[0.85rem] text-chalk/85">{row.now}</td>
                <td class="py-2.5 text-[0.85rem] text-chalk/45">{row.later}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <!-- ── footer ───────────────────────────────────────────────────────── -->
  <!--
    Brand block on the left, four link columns on the right. The "deliberately
    not here yet" paragraph stays where it is and keeps the widest column: it
    is the most characteristic sentence on the page, and a footer is exactly
    where a reader goes looking for what a project is not.
  -->
  {#snippet brandIcon(name: string)}
    <!--
      Drawn inline rather than pulled from an icon package, for the same reason
      the marketplace marks are: no runtime request, and nothing extra in the
      dependency list. Paths are the CC0 Simple Icons outlines; the trademarks
      remain their owners' and are used here only to point at our own account
      on each platform.
    -->
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true" class="shrink-0 opacity-70">
      {#if name === "github"}
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
      {:else if name === "discord"}
        <path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286ZM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189Zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
      {:else if name === "telegram"}
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212-.07-.062-.174-.041-.249-.024-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635Z" />
      {:else if name === "x"}
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" />
      {/if}
    </svg>
  {/snippet}

  <footer class="border-t border-white/10 bg-peacock">
    <div class="mx-auto max-w-6xl px-5 py-14 sm:px-8">
      <div class="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)] lg:gap-14">
        <div class="max-w-md">
          <div class="flex items-center gap-2.5">
            <img src="/logo.svg" alt="" width="26" height="26" />
            <span class="board text-[0.95rem] text-chalk">OpenCommerce</span>
          </div>
          <p class="mt-4 text-[0.82rem] leading-relaxed text-chalk/45">
            Deliberately not here yet: teams and roles, multi-store, AI,
            Postgres, Redis, shipping, accounting, and bulk marketplace writes.
            Each has a seam waiting for it.
          </p>

          <div class="mt-6 flex flex-wrap items-center gap-2.5">
            <a
              href="/login"
              class="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-peacock-deep transition-opacity hover:opacity-90 hover:no-underline"
            >
              Sign in
            </a>
            <a
              href={LINKS.github}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-2 rounded-md border border-white/15 px-3.5 py-2 text-sm text-chalk/80 transition-colors hover:border-white/30 hover:text-chalk hover:no-underline
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-peacock"
            >
              {@render brandIcon("github")}
              Star on GitHub
            </a>
          </div>
        </div>

        <nav class="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4" aria-label="Footer">
          {#each FOOTER as column (column.title)}
            <div class="min-w-0">
              <h2 class="board-label mb-3 text-[0.58rem] text-chalk/35">{column.title}</h2>
              <ul class="space-y-2">
                {#each column.links as link (link.label)}
                  <li>
                    <a
                      href={link.href}
                      target={isExternal(link.href) ? "_blank" : undefined}
                      rel={isExternal(link.href) ? "noopener noreferrer" : undefined}
                      class="inline-flex items-center gap-1.5 text-[0.82rem] leading-snug text-chalk/60 transition-colors hover:text-chalk hover:no-underline
                             focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-peacock"
                    >
                      {#if link.icon}{@render brandIcon(link.icon)}{/if}
                      {link.label}
                    </a>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </nav>
      </div>

      <!--
        "No analytics, no trackers" and not "no cookies" — there is a session
        cookie, and claiming otherwise on the page that spends a whole section
        on being checkable would undo the section.
      -->
      <p class="machine mt-12 border-t border-white/8 pt-6 text-[0.72rem] text-chalk/30">
        MIT · {data.counts.channels} connectors · {data.counts.india} built for India ·
        no analytics, no trackers
      </p>
    </div>
  </footer>
</div>

<style>
  /*
   * One orchestrated load sequence, and nothing else on the page moves.
   *
   * The fan draws from the origin outward and each row arrives just behind its
   * own curve, so the animation says the one thing the page is about: this
   * started in a single place and went to fourteen. pathLength="1" normalises
   * every curve to the same dash length, so the strokes finish together
   * regardless of how long each one actually is.
   */
  .fan path {
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: draw 620ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }

  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  .row {
    opacity: 0;
    animation: arrive 420ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateX(-6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  /* The board is information, not an animation. Without motion it is simply
     already there. */
  @media (prefers-reduced-motion: reduce) {
    .fan path {
      animation: none;
      stroke-dashoffset: 0;
    }
    .row {
      animation: none;
      opacity: 1;
      transform: none;
    }
  }
</style>
