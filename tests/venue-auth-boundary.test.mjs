import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const venueRoutePaths = [
  "../app/api/venue/cover-image/route.ts",
  "../app/api/venue/dancer-verifications/route.ts",
  "../app/api/venue/dashboard/route.ts",
  "../app/api/venue/deal/route.ts",
  "../app/api/venue/finance/route.ts",
  "../app/api/venue/finance/statement/route.ts",
  "../app/api/venue/logo-image/route.ts",
  "../app/api/venue/nfc-tags/route.ts",
  "../app/api/venue/profile/route.ts",
  "../app/api/venue/publication/route.ts",
  "../app/api/venue/team/invitations/route.ts",
  "../app/api/venue/tv/videos/route.ts",
];

const venueRoutes = await Promise.all(
  venueRoutePaths.map(async (path) => ({
    path,
    source: await readFile(new URL(path, import.meta.url), "utf8"),
  })),
);
const authService = await readFile(new URL("../src/lib/dancr/auth.ts", import.meta.url), "utf8");

test("active venue authorization has one production boundary", () => {
  for (const route of venueRoutes) {
    assert.match(route.source, /requireActiveVenueAccount/, route.path);
    assert.doesNotMatch(route.source, /getAccountByUserId/, route.path);
    assert.doesNotMatch(
      route.source,
      /async function (?:requireActiveVenue|requireVenueRole|requireVenueAccount)/,
      route.path,
    );
  }
});

test("the venue boundary accepts only an active venue account and fails with a typed 403", () => {
  const boundary = authService.match(
    /export async function requireActiveVenueAccount[\s\S]*?\n}/,
  )?.[0] || "";

  assert.match(boundary, /getAccountByUserId\(client, userId\)/);
  assert.match(boundary, /account\.role !== "venue"/);
  assert.match(boundary, /account\.accountState !== "active"/);
  assert.match(
    boundary,
    /new PublicApiError\("FORBIDDEN", "Active venue account required\.", 403\)/,
  );
  assert.match(boundary, /return account/);
});
