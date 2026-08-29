import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/202608280003_lock_dancer_content_mutations.sql", import.meta.url),
  "utf8",
);
const profileRoute = readFileSync(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8");
const dancerLibrary = readFileSync(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8");

test("browser sessions cannot directly change dancer approval or content records", () => {
  for (const table of ["dancer_profiles", "dancer_photos", "social_links", "image_moderation_records"]) {
    assert.match(
      migration,
      new RegExp(`revoke insert, update, delete on table public\\.${table} from anon, authenticated`, "i"),
    );
  }
  assert.match(migration, /drop policy if exists "dancers update own draft profile"/i);
  assert.match(migration, /drop policy if exists "dancers manage own photos"/i);
  assert.match(migration, /drop policy if exists "dancers manage own social links"/i);
  assert.match(migration, /drop policy if exists "users insert own moderation shell"/i);
});

test("the public photo bucket no longer accepts direct dancer writes", () => {
  assert.match(migration, /drop policy if exists "dancers upload own dancer photo files"/i);
  assert.match(migration, /drop policy if exists "dancers update own dancer photo files"/i);
  assert.match(migration, /drop policy if exists "dancers delete own dancer photo files"/i);
  assert.doesNotMatch(dancerLibrary, /storage\.from\("dancer-photos"\)\.upload/);
  assert.doesNotMatch(dancerLibrary, /export async function uploadDancerPhoto/);
});

test("profile writes authorize ownership before using the server mutation client", () => {
  const authIndex = profileRoute.indexOf("createRequestSupabaseContext(request)");
  const ownershipIndex = profileRoute.indexOf("loadProfileForSave(client, user.id)");
  const privilegedIndex = profileRoute.indexOf("const db = createAdminSupabaseClient()", authIndex);
  const updateIndex = profileRoute.indexOf('.from("dancer_profiles")', privilegedIndex);

  assert.ok(authIndex >= 0);
  assert.ok(ownershipIndex > authIndex);
  assert.ok(privilegedIndex > ownershipIndex);
  assert.ok(updateIndex > privilegedIndex);
});
