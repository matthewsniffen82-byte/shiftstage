import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminRoute, adminClient, liveApp, signupMigration] = await Promise.all([
  readFile(new URL("../app/api/admin/venues/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202608220002_venue_self_publish_onboarding.sql", import.meta.url), "utf8"),
]);

test("administrators cannot manually create a venue and publish only after venue approval", () => {
  assert.match(adminRoute, /New venues must submit the venue request form/);
  assert.match(adminRoute, /transitionAdminManagedVenuePage/);
  assert.match(adminClient, /Approve a submitted request to create its private workspace/);
  assert.match(adminClient, /Send page for venue approval/);
  assert.match(adminClient, /Publish approved page/);
  assert.doesNotMatch(adminClient, /Venue created and active/);
  assert.match(signupMigration, /insert into public\.venues[\s\S]*?false,[\s\S]*?null/);
});

test("venue management exposes active and hidden states without a venue verification queue", () => {
  assert.match(liveApp, /Directory status: Active/);
  assert.doesNotMatch(liveApp, /data-admin-action="verify-venue"/);
  assert.doesNotMatch(liveApp, /Venue verified/);
  assert.doesNotMatch(liveApp, /Verification status: \$\{venue\.verified/);
  assert.match(liveApp, /data-admin-action="remove-venue"/);
  assert.match(liveApp, /isActive: false/);
});

test("dancer venue affiliation remains separate from venue legitimacy", () => {
  assert.match(liveApp, /Confirm venue affiliation/);
  assert.match(liveApp, /data-venue-affiliation-remove/);
});
