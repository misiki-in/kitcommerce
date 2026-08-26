/**
 * A small subsequence matcher, for finding a marketplace by typing at it.
 *
 * Written rather than installed. Fuse.js is the obvious answer and it is also
 * a runtime dependency, which this project does not have and advertises not
 * having on its own landing page. The problem here is narrow enough that the
 * trade is easy: a few hundred short proper nouns, matched against a query
 * someone is typing one character at a time. Thirty lines covers it.
 *
 * The rule is subsequence, not substring: every character of the query has to
 * appear in the target in order, but not adjacently. That is what lets "tcq"
 * find "Tata CLiQ" and "amzn" find "Amazon". Scoring then decides which of the
 * matches a human meant.
 */

/** Characters after which the next one counts as starting a word. */
const BOUNDARY = new Set([" ", "-", ".", "(", "/", "&"]);

/**
 * Higher is better. `null` means the query is not a subsequence at all.
 *
 * Scores are only ever compared against each other, so the absolute numbers
 * carry no meaning — they are weights chosen so that the three things people
 * actually expect beat everything else: a run of adjacent characters, a match
 * on the start of a word, and a short target.
 */
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  let score = 0;
  let from = 0;
  let previous = -2;

  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at === -1) return null;

    // Adjacent to the last match: this is what typing a prefix looks like.
    if (at === previous + 1) score += 8;

    // Start of a word beats the middle of one, so "cliq" ranks Tata CLiQ above
    // a marketplace that merely contains those letters somewhere.
    if (at === 0 || BOUNDARY.has(t[at - 1]!)) score += 6;

    // Skipping ahead is allowed but never free, or long names win everything.
    score -= Math.min(at - from, 4);

    previous = at;
    from = at + 1;
  }

  // Two targets that both matched: the one with less left over is the better
  // answer. "eBay" should beat "eBay Motors Parts and Accessories".
  score += Math.max(0, 12 - (t.length - q.length));

  return score;
}

/**
 * Filter and rank in one pass.
 *
 * Ties keep their original order, which for these lists means the curated
 * order stays visible when a query is too short to discriminate.
 */
export function fuzzyRank<T>(items: T[], query: string, text: (item: T) => string): T[] {
  if (!query.trim()) return items;

  const scored: Array<{ item: T; score: number; index: number }> = [];

  items.forEach((item, index) => {
    const score = fuzzyScore(query.trim(), text(item));
    if (score !== null) scored.push({ item, score, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}

/** True when the query matches at all. Cheaper to read than a null check. */
export function fuzzyMatches(query: string, target: string): boolean {
  return fuzzyScore(query, target) !== null;
}
