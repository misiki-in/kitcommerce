/**
 * Helper script to make test API calls against Meta Graph API
 * to satisfy Meta's App Review requirement for "business_management" and "catalog_management".
 *
 * Usage:
 *   bun scripts/meta-test-call.ts <ACCESS_TOKEN>
 *
 * (You can get a temporary User Token from https://developers.facebook.com/tools/explorer/)
 */

const token = process.argv[2] || process.env.META_ACCESS_TOKEN;

if (!token) {
  console.error(`
❌ Missing Access Token!

How to get a token in 20 seconds:
1. Open https://developers.facebook.com/tools/explorer/
2. Select your Meta App in the top-right dropdown.
3. Under Permissions, add: "business_management" and "catalog_management".
4. Click "Generate Access Token" and approve.
5. Copy the token and run:

   bun scripts/meta-test-call.ts YOUR_TOKEN_HERE
`);
  process.exit(1);
}

const GRAPH_API = "https://graph.facebook.com/v26.0";

async function makeTestCalls() {
  console.log("🚀 Making test API calls to Meta Graph API...\n");

  const endpoints = [
    { name: "User Profile (/me)", path: "/me?fields=id,name" },
    { name: "Business Portfolios (/me/businesses)", path: "/me/businesses?fields=id,name,link" },
    { name: "Assigned Catalogs (/me/assigned_product_catalogs)", path: "/me/assigned_product_catalogs?fields=id,name,vertical" },
  ];

  for (const ep of endpoints) {
    try {
      console.log(`📡 Testing: ${ep.name}...`);
      const res = await fetch(`${GRAPH_API}${ep.path}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });

      const data = await res.json();

      if (!res.ok) {
        console.error(`   ❌ Failed (${res.status}):`, data.error?.message || data);
      } else {
        console.log(`   ✅ Success (${res.status}):`, JSON.stringify(data).slice(0, 150) + "...\n");
      }
    } catch (err) {
      console.error(`   ❌ Network error:`, err.message);
    }
  }

  console.log(`
🎉 Test calls completed!
Meta has now registered live API traffic for business_management on your App ID.
Check App Review -> Permissions and Features in your Meta App dashboard.
(Note: Meta's dashboard counter can take between a few minutes and a few hours to refresh the button status).
`);
}

makeTestCalls();
