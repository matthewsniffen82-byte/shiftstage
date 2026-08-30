import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, directionsRoute, eventsRoute, reportsRoute, dmcaPage] = await Promise.all([
  read("../supabase/migrations/202608300001_harden_direct_browser_rls.sql"),
  read("../app/api/customer/directions/route.ts"),
  read("../app/api/events/route.ts"),
  read("../app/api/reports/route.ts"),
  read("../app/dmca/page.tsx"),
]);

test("browser roles cannot bypass server analytics and report boundaries", () => {
  for (const table of [
    "profile_views",
    "schedule_views",
    "direction_requests",
    "social_clicks",
    "content_reports",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke insert on table public\\.${table} from anon, authenticated;`),
    );
  }

  for (const policy of [
    "insert public profile views",
    "insert public schedule views",
    "insert public direction requests",
    "insert public social clicks",
    "users create content reports",
  ]) {
    assert.match(migration, new RegExp(`drop policy if exists "${policy}"`));
  }

  assert.match(eventsRoute, /const client = createAdminSupabaseClient\(\)/);
  assert.match(reportsRoute, /const client = createAdminSupabaseClient\(\)/);
});

test("authenticated customer directions use the server client after identity validation", () => {
  assert.match(directionsRoute, /const \{ user \} = await createRequestSupabaseContext\(request\)/);
  assert.match(directionsRoute, /const adminClient = createAdminSupabaseClient\(\)/);
  assert.match(
    directionsRoute,
    /requirePublicDancersAtVenue\(adminClient, venueId, dancerIds\)[\s\S]*recordDirectionRequest\(adminClient, user\.id/,
  );
  assert.doesNotMatch(directionsRoute, /recordDirectionRequest\(client,/);
});

test("public DMCA contact rendering no longer requires anonymous table access", () => {
  assert.match(migration, /revoke select on table public\.dmca_agent_settings from anon;/);
  assert.match(migration, /drop policy if exists "public reads dmca agent settings"/);
  assert.match(dmcaPage, /getPublicDmcaAgent\(createAdminSupabaseClient\(\)\)/);
});

function read(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}
