import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const venueApiRoot = new URL("../app/api/venue/", import.meta.url);

async function findRouteFiles(directoryUrl, relativeDirectory = "") {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const routes = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);
    if (entry.isDirectory()) {
      routes.push(...await findRouteFiles(entryUrl, relativePath));
    } else if (entry.name === "route.ts") {
      routes.push(relativePath);
    }
  }

  return routes.sort();
}

const expectedRoutes = [
  "access-code/preview/route.ts",
  "claims/route.ts",
  "cover-image/route.ts",
  "dancer-verifications/route.ts",
  "dashboard/route.ts",
  "deal/qr/route.ts",
  "deal/route.ts",
  "finance/route.ts",
  "finance/statement/route.ts",
  "logo-image/route.ts",
  "nfc-support/route.ts",
  "nfc-tags/route.ts",
  "profile/route.ts",
  "publication/route.ts",
  "qr-code/route.ts",
  "referral-fee/route.ts",
  "signup-requests/route.ts",
  "team/invitations/route.ts",
  "team/route.ts",
  "tv/videos/route.ts",
];

const retiredRoutes = new Set([
  "claims/route.ts",
  "deal/qr/route.ts",
  "qr-code/route.ts",
]);
const reviewedPublicRoutes = new Set([
  "access-code/preview/route.ts",
  "signup-requests/route.ts",
  "team/invitations/route.ts",
]);

const discoveredRoutes = await findRouteFiles(venueApiRoot);
const routeSources = new Map(await Promise.all(
  discoveredRoutes.map(async (relativePath) => [
    relativePath,
    await readFile(new URL(relativePath, venueApiRoot), "utf8"),
  ]),
));

test("every venue API route is included in the security inventory", () => {
  assert.deepEqual(discoveredRoutes, expectedRoutes);
});

test("venue APIs are dynamic server routes and never reference privileged credentials", () => {
  for (const [relativePath, source] of routeSources) {
    assert.match(source, /export const runtime = "nodejs"/, relativePath);
    assert.match(source, /export const dynamic = "force-dynamic"/, relativePath);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role|process\.env\.[A-Z_]*SECRET/, relativePath);
  }
});

test("retired venue APIs stay inert and cannot reach authentication or database services", () => {
  for (const relativePath of retiredRoutes) {
    const source = routeSources.get(relativePath) || "";
    assert.match(source, /status: 410/, relativePath);
    if (relativePath === "claims/route.ts") {
      assert.match(source, /Venue claiming is retired/, relativePath);
      assert.match(source, /signupUrl: "\/clubs\/join"/, relativePath);
    } else {
      assert.match(source, /replacement: "\/api\/venue\/nfc-tags"/, relativePath);
    }
    assert.doesNotMatch(source, /createRequestSupabaseContext|createAdminSupabaseClient|\.from\(/, relativePath);
  }
});

test("the public venue entry points remain narrowly scoped and abuse resistant", () => {
  const preview = routeSources.get("access-code/preview/route.ts") || "";
  assert.match(preview, /enforceAccountRecoveryRateLimit/);
  assert.match(preview, /eventType: "venue_access_preview"/);
  assert.match(preview, /resolveVenueSignupCode/);
  assert.match(preview, /id: access\.venue\.id/);
  assert.match(preview, /slug: access\.venue\.slug/);
  assert.doesNotMatch(preview, /token: access\.|code: access\./);
  assert.match(preview, /apiError\(/);

  const signupRequests = routeSources.get("signup-requests/route.ts") || "";
  assert.match(signupRequests, /body\?\.companyFax/);
  assert.match(signupRequests, /createVenueSignupRequest\(/);
  assert.match(signupRequests, /requestIp\(request\)/);
  assert.match(signupRequests, /status: 201/);
  assert.match(signupRequests, /apiError\(/);
  assert.doesNotMatch(signupRequests, /contact_email|request_ip_hash|accessCode/);

  const invitations = routeSources.get("team/invitations/route.ts") || "";
  assert.match(invitations, /resolveVenueTeamInvitation/);
  assert.match(invitations, /createRequestSupabaseContext\(request\)/);
  assert.match(invitations, /requireActiveVenueAccount/);
  assert.match(invitations, /cache-control": "private, no-store, max-age=0"/);
  assert.match(invitations, /apiError\(/);
});

test("every remaining venue API authenticates, authorizes, and sanitizes failures", () => {
  const authorizationBoundary = /requireActiveVenueAccount|requireVenueAccess|getVenueReferralFeeStateForAccount|requestVenueReferralFeeChange|getVenueTeamState|createVenueTeamInvitation|updateVenueTeamMember|revokeVenueTeamInvitation/;

  for (const [relativePath, source] of routeSources) {
    if (retiredRoutes.has(relativePath) || reviewedPublicRoutes.has(relativePath)) continue;

    assert.match(source, /createRequestSupabaseContext\(request\)/, relativePath);
    assert.match(source, authorizationBoundary, relativePath);
    assert.match(source, /apiError\(/, relativePath);
  }
});
