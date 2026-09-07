/**
 * Fetch each marketplace's real favicon into data/logos/.
 *
 *   bun run logos
 *
 * Deliberately a separate, opt-in command rather than something `bun dev`
 * does:
 *
 *   - It is the only part of this project that talks to the public internet.
 *     Startup must never depend on that.
 *   - The files land in data/ (gitignored), so no third-party trademarked
 *     artwork is ever committed to the repository.
 *   - Once fetched they are served locally forever, so the offline guarantee
 *     holds after the first run.
 *
 * Anything that fails simply keeps the drawn brand mark from brand.ts. Delete a
 * file from data/logos/ to go back to the drawn mark for that marketplace.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./lib/server/config";
import { connectors } from "./lib/server/connectors";

/** Where each connector's brand lives. */
const DOMAINS: Record<string, string> = {
  amazon: "amazon.in",
  flipkart: "flipkart.com",
  meesho: "meesho.com",
  myntra: "myntra.com",
  ajio: "ajio.com",
  jiomart: "jiomart.com",
  nykaa: "nykaa.com",
  tatacliq: "tatacliq.com",
  snapdeal: "snapdeal.com",
  zepto: "zeptonow.com",
  instamart: "swiggy.com",
  blinkit: "blinkit.com",
  meta: "about.meta.com",
  instagram: "instagram.com",
  facebook: "facebook.com",
  tiktok: "tiktok.com",
  ebay: "ebay.com",
  etsy: "etsy.com",
  litekart: "litekart.in",
};

/**
 * Best quality first: touch icons are usually 180px, favicon.ico often 32.
 *
 * The last two entries are public icon resolvers, used only because several
 * Indian marketplaces sit behind bot protection that refuses a direct fetch.
 * They see nothing but a marketplace domain name — no user data — and are only
 * ever reached by this opt-in command.
 *
 * Both are listed because they do not cover the same ground: DuckDuckGo 404s
 * on flipkart, meesho, myntra, zepto and swiggy, which between them are five of
 * the fourteen connectors and most of the quick-commerce group. Google resolves
 * all five. Ordered DDG-first anyway, so the fetch only reaches Google for the
 * domains that need it.
 */
const CANDIDATES = (domain: string) => [
  `https://${domain}/apple-touch-icon.png`,
  `https://${domain}/apple-touch-icon-precomposed.png`,
  `https://www.${domain}/apple-touch-icon.png`,
  `https://${domain}/favicon.ico`,
  `https://www.${domain}/favicon.ico`,
  `https://${domain}/static/favicon.ico`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
];

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
};

const dir = join(config.dataDir, "logos");
mkdirSync(dir, { recursive: true });

const names = Object.keys(connectors);
console.log(`\n  Fetching favicons for ${names.length} connectors into ${dir}\n`);

let saved = 0;
let failed = 0;

for (const name of names) {
  const domain = DOMAINS[name];
  if (!domain) {
    console.log(`  ${name.padEnd(12)} no domain mapped — keeping the drawn mark`);
    failed++;
    continue;
  }

  let done = false;
  for (const url of CANDIDATES(domain)) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
        headers: {
          // Some CDNs serve a 403 to clients without a browser-ish UA.
          "User-Agent": "Mozilla/5.0 (compatible; OpenCommerce/0.1; +logo-fetch)",
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
      if (!res.ok) continue;

      const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      const ext = EXT[type];
      // An HTML error page served with 200 is the usual failure here.
      if (!ext) continue;

      const bytes = new Uint8Array(await res.arrayBuffer());
      // Floor is low because a tight-cropped 128px PNG can be genuinely small
      // (Meesho's is ~350 bytes). Serving-an-HTML-error-page is already caught
      // by the content-type check above, and a resolver that has no icon
      // answers 404 rather than with something tiny.
      if (bytes.byteLength < 200) continue;

      writeFileSync(join(dir, `${name}.${ext}`), bytes);
      console.log(
        `  ${name.padEnd(12)} ${String(Math.round(bytes.byteLength / 1024)).padStart(3)} KB  ${ext.padEnd(4)} ${url}`,
      );
      saved++;
      done = true;
      break;
    } catch {
      // try the next candidate
    }
  }

  if (!done) {
    console.log(`  ${name.padEnd(12)} not found — keeping the drawn mark`);
    failed++;
  }
}

console.log(`
  ${saved} saved, ${failed} using the drawn mark.
  Restart the server to pick them up (they are indexed once at startup).
`);
