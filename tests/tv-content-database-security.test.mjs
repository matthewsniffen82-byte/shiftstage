import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/202608280004_lock_tv_content_mutations.sql", import.meta.url),
  "utf8",
);
const tvRoute = readFileSync(new URL("../app/api/dancer/tv/videos/route.ts", import.meta.url), "utf8");
const tvLibrary = readFileSync(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8");
const tvStudio = readFileSync(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8");

test("browser sessions cannot directly mutate TV moderation rows or storage", () => {
  assert.match(
    migration,
    /revoke insert, update, delete on table public\.mydancr_tv_videos from anon, authenticated/i,
  );
  assert.match(migration, /drop policy if exists "dancers upload own MyDancr TV files"/i);
  assert.match(migration, /drop policy if exists "dancers delete own MyDancr TV files"/i);
});

test("dancer TV uploads retain the authenticated one-time signed upload flow", () => {
  const authIndex = tvRoute.indexOf("createRequestSupabaseContext(request)");
  const prepareIndex = tvRoute.indexOf("createMyDancrTvUpload(admin, user.id");
  const validationIndex = tvLibrary.indexOf("export async function createMyDancrTvUpload");
  const signedUploadIndex = tvLibrary.indexOf("createSignedUploadUrl(storagePath)", validationIndex);

  assert.ok(authIndex >= 0);
  assert.ok(prepareIndex > authIndex);
  assert.ok(validationIndex >= 0);
  assert.ok(signedUploadIndex > validationIndex);
  assert.match(tvStudio, /uploadToSignedUrl\(data\.upload\.path, data\.upload\.token, item\.file/);
  assert.doesNotMatch(tvStudio, /\.upload\(/);
});
