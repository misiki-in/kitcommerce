/**
 * Prefixed, sortable, URL-safe IDs. Prefix-first so a stray ID in a log or an
 * error message is self-describing: prd_… is a product, job_… is a sync job.
 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newId(prefix: string): string {
  // 48-bit timestamp keeps IDs roughly k-sortable by creation time.
  const ts = Date.now();
  let time = "";
  let n = ts;
  while (n > 0) {
    time = ALPHABET[n % 36] + time;
    n = Math.floor(n / 36);
  }
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(rand, (b) => ALPHABET[b % 36]).join("");
  return `${prefix}_${time}${suffix}`;
}

export function token(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Stable content hash used for change detection (spec 11). */
export async function contentHash(value: unknown): Promise<string> {
  const json = stableStringify(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Key-sorted JSON so hashes do not change when property order does. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((v as any)[k])}`)
    .join(",")}}`;
}
