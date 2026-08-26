/**
 * Marketplace OAuth, for the channels a seller cannot connect by pasting a key.
 *
 * Three of the connectors take credentials a seller already has — Flipkart and
 * Meesho issue an app ID and secret you copy out of their seller portal, and
 * pasting those into the connect form is the whole flow. Etsy and eBay do not
 * work that way: what their APIs need is a token minted by the seller granting
 * this installation access to their shop, and there is no page in either portal
 * that hands you one. Without the redirect below, "connect Etsy" means running
 * a curl by hand and pasting the result, which is not a thing to ask of someone
 * listing saris.
 *
 * The two flows differ in ways that matter:
 *
 *   Etsy  — PKCE is mandatory and there is no client secret. The verifier is
 *           generated per attempt and must survive the round trip.
 *   eBay  — no PKCE, a client secret, and `redirect_uri` is not a URL at all:
 *           it is the RuName eBay assigns your application. Sending the actual
 *           callback URL there fails with an unhelpful invalid_request.
 *
 * Both are declared here rather than in the connectors, because a connector
 * describes how to talk to an API once you hold a token; this describes how the
 * seller hands one over. Adding a provider is one entry.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config";

export interface ExchangeResult {
  /** Credentials in exactly the shape the connector expects to read. */
  credentials: Record<string, string>;
  /** Channel config discovered during the exchange, if any. */
  channelConfig?: Record<string, unknown>;
}

export interface OAuthProvider {
  /** Connector name in the registry. */
  connector: string;
  label: string;
  /** Etsy requires PKCE; eBay does not support it. */
  pkce: boolean;
  /**
   * Query parameter carrying the authorization code on the way back.
   *
   * Everyone uses "code" except Amazon, which sends spapi_oauth_code — reading
   * the wrong one yields an empty string and a token exchange that fails with
   * "invalid_grant", which reads like an expired code rather than a typo.
   */
  codeParam?: string;
  enabled(): boolean;
  authorizeUrl(input: { redirectUri: string; state: string; challenge?: string }): string;
  exchange(input: {
    code: string;
    redirectUri: string;
    verifier?: string;
    /** Every query parameter the callback arrived with. */
    params: Record<string, string>;
  }): Promise<ExchangeResult>;
}

// ------------------------------------------------------------------- helpers

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A PKCE pair.
 *
 * 64 random bytes base64url-encodes to 86 characters, inside Etsy's 43-128
 * range, and base64url's alphabet is a subset of the characters it permits —
 * so no escaping is needed anywhere downstream.
 */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(64));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function newState(): string {
  return base64url(randomBytes(24));
}

async function form(url: string, body: URLSearchParams, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    // The provider's own message is the only useful thing here — "invalid_grant"
    // and "invalid_request" mean very different things to whoever is debugging.
    throw new Error(`${res.status} ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as Record<string, any>;
}

// ----------------------------------------------------------------- providers

const etsy: OAuthProvider = {
  connector: "etsy",
  label: "Etsy",
  pkce: true,

  enabled: () => Boolean(config.oauth.etsy.clientId),

  authorizeUrl({ redirectUri, state, challenge }) {
    const q = new URLSearchParams({
      response_type: "code",
      client_id: config.oauth.etsy.clientId,
      redirect_uri: redirectUri,
      scope: config.oauth.etsy.scopes,
      state,
      code_challenge: challenge!,
      code_challenge_method: "S256",
    });
    return `https://www.etsy.com/oauth/connect?${q}`;
  },

  async exchange({ code, redirectUri, verifier }) {
    const body = await form(
      "https://api.etsy.com/v3/public/oauth/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.oauth.etsy.clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier!,
      }),
    );

    /*
     * Etsy access tokens carry the shop owner's user ID as a prefix —
     * "12345678.abcdef..." — and the connector needs the shop ID separately.
     * The user ID is not the shop ID, so it is not guessed at here: the seller
     * still supplies shop_id, and only the token pair comes from the exchange.
     */
    return {
      credentials: {
        // The connector sends this as x-api-key on every call.
        api_key: config.oauth.etsy.clientId,
        access_token: String(body.access_token),
        refresh_token: String(body.refresh_token ?? ""),
      },
    };
  },
};

const ebay: OAuthProvider = {
  connector: "ebay",
  label: "eBay",
  pkce: false,

  enabled: () =>
    Boolean(config.oauth.ebay.clientId && config.oauth.ebay.clientSecret && config.oauth.ebay.ruName),

  authorizeUrl({ state }) {
    const host = config.oauth.ebay.sandbox ? "auth.sandbox.ebay.com" : "auth.ebay.com";
    const q = new URLSearchParams({
      client_id: config.oauth.ebay.clientId,
      response_type: "code",
      // Not the callback URL. eBay matches this against the RuName registered
      // for the application, and resolves the real redirect from that.
      redirect_uri: config.oauth.ebay.ruName,
      scope: config.oauth.ebay.scopes,
      state,
    });
    return `https://${host}/oauth2/authorize?${q}`;
  },

  async exchange({ code }) {
    const api = config.oauth.ebay.sandbox ? "api.sandbox.ebay.com" : "api.ebay.com";
    const basic = Buffer.from(
      `${config.oauth.ebay.clientId}:${config.oauth.ebay.clientSecret}`,
    ).toString("base64");

    const body = await form(
      `https://${api}/identity/v1/oauth2/token`,
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.oauth.ebay.ruName,
      }),
      { Authorization: `Basic ${basic}` },
    );

    /*
     * Only the refresh token is stored. eBay access tokens last two hours and
     * the connector already mints one per run from the refresh token, which is
     * good for eighteen months — persisting the short-lived half would just be
     * a stale secret sitting in the database.
     */
    return {
      credentials: {
        client_id: config.oauth.ebay.clientId,
        client_secret: config.oauth.ebay.clientSecret,
        refresh_token: String(body.refresh_token),
      },
      channelConfig: config.oauth.ebay.sandbox ? { sandbox: true } : undefined,
    };
  },
};

const amazon: OAuthProvider = {
  connector: "amazon",
  label: "Amazon",
  pkce: false,
  codeParam: "spapi_oauth_code",

  enabled: () =>
    Boolean(
      config.oauth.amazon.applicationId &&
        config.oauth.amazon.clientId &&
        config.oauth.amazon.clientSecret,
    ),

  authorizeUrl({ redirectUri, state }) {
    const q = new URLSearchParams({
      application_id: config.oauth.amazon.applicationId,
      state,
      redirect_uri: redirectUri,
    });
    // Draft applications are only reachable with version=beta, and a live one
    // rejects the parameter — so it is set from config rather than always sent.
    if (config.oauth.amazon.draft) q.set("version", "beta");

    return `https://${config.oauth.amazon.sellerCentralHost}/apps/authorize/consent?${q}`;
  },

  async exchange({ code, redirectUri, params }) {
    const body = await form(
      "https://api.amazon.com/auth/o2/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: config.oauth.amazon.clientId,
        client_secret: config.oauth.amazon.clientSecret,
      }),
    );

    /*
     * The selling partner ID does not come from the token response — Amazon
     * puts it on the callback query instead, and the connector needs it to
     * address the right seller. Taken from there rather than derived, because
     * nothing in the token identifies the shop.
     */
    return {
      credentials: {
        client_id: config.oauth.amazon.clientId,
        client_secret: config.oauth.amazon.clientSecret,
        refresh_token: String(body.refresh_token),
        seller_id: params.selling_partner_id ?? "",
      },
    };
  },
};

const PROVIDERS: Record<string, OAuthProvider> = { etsy, ebay, amazon };

export function oauthProvider(name: string): OAuthProvider | undefined {
  return PROVIDERS[name];
}

/** Connectors that can be connected by redirect right now, for the UI. */
export function enabledOAuthConnectors(): string[] {
  return Object.values(PROVIDERS)
    .filter((p) => p.enabled())
    .map((p) => p.connector);
}

/** The callback this installation registers with each provider. */
export function callbackUrl(name: string): string {
  return `${config.publicUrl.replace(/\/+$/, "")}/auth/${name}/callback`;
}
