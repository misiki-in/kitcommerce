# Marketplace setup guides

These guides walk through taking a channel **live**, which
always involves steps OpenCommerce cannot do for you — opening seller accounts,
registering API applications, and getting credentials issued.

Each guide walks that manual path end to end: what to click, whom to ask when
there is no self-serve portal, what you receive at each step, and exactly which
connect-form field each value lands in. Guides were last verified against the
marketplaces' official documentation on **2026-08-27**.

Three connectors can skip the paste-credentials flow entirely: once the
operator sets a few environment variables, **Amazon, eBay and Etsy** connect by
redirect — the seller clicks Connect, signs in on the marketplace, and the
refresh token is minted and stored automatically. Their guides cover both
routes.

| Marketplace | Connector | API access | Guide |
| --- | --- | --- | --- |
| Amazon | `amazon` | Public (SP-API) — self-authorize or built-in OAuth | [amazon.md](./amazon.md) |
| Flipkart | `flipkart` | Public (Seller API v3) — self-access application | [flipkart.md](./flipkart.md) |
| Meesho | `meesho` | Gated — issued by the integration team over email | [meesho.md](./meesho.md) |
| JioMart | `jiomart` | Gated — issued by your category manager | [jiomart.md](./jiomart.md) |
| Snapdeal | `snapdeal` | Public docs — API user + per-seller authorization | [snapdeal.md](./snapdeal.md) |
| Tata CLiQ | `tatacliq` | Gated — activated by the account manager | [tatacliq.md](./tatacliq.md) |
| Myntra | `myntra` | Partner docs — credentials from the account manager | [myntra.md](./myntra.md) |
| AJIO | `ajio` | Gated — POB credentials from the integration team | [ajio.md](./ajio.md) |
| Nykaa | `nykaa` | Gated — issued by the Nykaa integration team | [nykaa.md](./nykaa.md) |
| Zepto | `zepto` | No public API — curated brand onboarding | [zepto.md](./zepto.md) |
| Swiggy Instamart | `instamart` | No public API — curated brand onboarding | [instamart.md](./instamart.md) |
| Meta (Facebook & Instagram) | `meta` | Public (Graph API) — App ID & App Secret or System-User Token | [meta.md](./meta.md) |
| TikTok Shop | `tiktok` | Public (Open Platform) — app + shop authorization | [tiktok.md](./tiktok.md) |
| eBay | `ebay` | Public (Sell APIs) — keyset + built-in OAuth | [ebay.md](./ebay.md) |
| Etsy | `etsy` | Public (Open API v3) — app + built-in OAuth | [etsy.md](./etsy.md) |
| Shopify | `shopify` | Public (Admin GraphQL) — custom or Dev Dashboard app | [shopify.md](./shopify.md) |

Every guide is also linked from the connect dialog itself — the manifest's
`setupGuide` field — so a seller staring at an empty credentials form is one
click from the instructions.
