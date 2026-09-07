import type { RequestHandler } from "./$types";
import { createHash } from "node:crypto";
import { config } from "$server/config";

/**
 * eBay Marketplace Account Deletion / Closure Notification Endpoint.
 *
 * eBay requires all production developer applications to configure an endpoint to handle
 * account deletion/closure notifications (GDPR/privacy compliance).
 *
 * 1. Verification (GET):
 *    eBay sends: GET /api/webhooks/ebay/deletion?challenge_code=xyz
 *    The server calculates: SHA-256(challenge_code + verification_token + endpoint_url)
 *    The server returns: HTTP 200 { "challengeResponse": "<hash>" }
 *
 * 2. Notification (POST):
 *    eBay posts account deletion notifications containing seller/user ID when a user requests
 *    account deletion.
 */

export const GET: RequestHandler = async ({ url }) => {
  const challengeCode = url.searchParams.get("challenge_code");
  const verificationToken =
    process.env.EBAY_VERIFICATION_TOKEN ||
    process.env.EBAY_CLIENT_SECRET ||
    "opencommerce-ebay-verification-token-2026";

  if (!challengeCode) {
    return new Response(JSON.stringify({ error: "Missing challenge_code parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Exact endpoint URL as called (or configured public endpoint)
  const endpointUrl = `${url.origin}${url.pathname}`;

  // eBay algorithm: SHA-256(challengeCode + verificationToken + endpointUrl)
  const hash = createHash("sha256");
  hash.update(challengeCode);
  hash.update(verificationToken);
  hash.update(endpointUrl);
  const challengeResponse = hash.digest("hex");

  return new Response(JSON.stringify({ challengeResponse }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    console.log("[eBay Account Deletion Notification received]:", JSON.stringify(body));

    // Acknowledge receipt to eBay (eBay requires HTTP 200)
    return new Response(JSON.stringify({ status: "acknowledged" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[eBay Account Deletion Webhook Error]:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 200, // Still return 200 to prevent eBay from retrying indefinitely on bad payload
      headers: { "Content-Type": "application/json" },
    });
  }
};
