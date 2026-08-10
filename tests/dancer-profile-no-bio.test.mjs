import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const dashboardSource = fs.readFileSync("app/dashboard/DashboardClient.tsx", "utf8");
const profileRouteSource = fs.readFileSync("app/api/dancer/profile/route.ts", "utf8");
const publicProfileSource = fs.readFileSync("src/lib/dancr/public.ts", "utf8");
const accountProfileSource = fs.readFileSync("src/lib/dancr/auth.ts", "utf8");
const adminSource = fs.readFileSync("src/lib/dancr/admin.ts", "utf8");
const adminClientSource = fs.readFileSync("app/admin/AdminClient.tsx", "utf8");
const liveShellSource = fs.readFileSync("outputs/index.html", "utf8");
const profileTypesSource = fs.readFileSync("src/lib/dancr/types.ts", "utf8");
const profileWriterSource = fs.readFileSync("src/lib/dancr/dancer.ts", "utf8");
const migrationSource = fs.readFileSync(
  "supabase/migrations/202608100002_remove_dancer_profile_bio.sql",
  "utf8",
);

test("dancer profile creation and editing never offer or submit a biography", () => {
  assert.doesNotMatch(dashboardSource, /\bBio\b|\[bio, setBio\]|bio:/);
  assert.doesNotMatch(profileWriterSource, /\bbio\b/i);
  assert.doesNotMatch(profileRouteSource, /body\.bio|update\.bio|bio: typeof body\.bio/);
});

test("public and admin dancer profile payloads do not select or render biographies", () => {
  assert.doesNotMatch(publicProfileSource, /\bbio\b/i);
  assert.doesNotMatch(accountProfileSource, /\bbio\b/i);
  assert.doesNotMatch(adminSource, /\bbio\b/i);
  assert.doesNotMatch(adminClientSource, /label="Bio"|profile\.bio|item\.bio/);
  assert.doesNotMatch(liveShellSource, /profile\.bio|item\.bio|Bio:/);
  assert.doesNotMatch(profileTypesSource, /\bbio\b/i);
});

test("the production schema permanently removes the legacy dancer biography column", () => {
  assert.match(migrationSource, /drop view if exists public\.public_dancer_profiles/);
  assert.match(migrationSource, /alter table public\.dancer_profiles[\s\S]*drop column if exists bio/);
  assert.match(migrationSource, /create view public\.public_dancer_profiles/);
  assert.doesNotMatch(migrationSource, /dp\.bio/);
  assert.match(migrationSource, /grant select on public\.public_dancer_profiles to anon, authenticated/);
});
