/**
 * The release history, as data.
 *
 * Local on purpose. A dashboard that reaches out to a code-hosting API to find
 * out what version it is would be the first runtime call this project makes,
 * and "no runtime calls out" is printed on the landing page. The notes ship
 * with the code that they describe, so they are correct offline, correct on an
 * air-gapped box, and correct for whatever commit you actually have checked
 * out — which a remote feed cannot promise.
 *
 * Newest first. The head entry is what the app reports as its own version, so
 * a release is cut by adding an entry here; `bun test` fails if this and
 * package.json disagree.
 */

export interface Release {
  version: string;
  /**
   * ISO date, omitted while unreleased. Left off rather than guessed — a
   * release page that invents dates is worse than one that admits it has none.
   */
  date?: string;
  title: string;
  /** What changed, in the order a reader cares about. */
  notes: string[];
}

export const RELEASES: Release[] = [
  {
    version: "0.1.0",
    title: "One catalogue, every marketplace",
    notes: [
      "Seventeen marketplace and social connectors, each declaring its own required fields, rate limits and capabilities.",
      "Direct API integration on every connector, connecting to official marketplace endpoints.",
      "Sync engine with idempotency keys and a retry ladder: a retry rebuilds byte-identical input and produces the same remote ID as the first attempt, so a retry is never a second listing.",
      "Transactional outbox for events, so a sync that commits cannot lose the notification that it did.",
      "Dashboard: overview, product wizard, orders, channels, settings, and an activity rail that refreshes as you navigate.",
      "REST API the dashboard is one client of, with no privileges the API does not give you.",
      "Light, dark and system themes, following the OS by default.",
      "Optional AI listing drafts, off unless you supply your own API key.",
      "SQLite for the database and the job queue. No broker, no config file, no runtime dependencies.",
    ],
  },
];

/** The version this build reports. Always the head of the list. */
export const CURRENT_VERSION = RELEASES[0]!.version;
