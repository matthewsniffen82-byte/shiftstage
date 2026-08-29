import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/202608280005_lock_server_managed_media_storage.sql", import.meta.url),
  "utf8",
);
const verificationRoute = readFileSync(
  new URL("../app/api/dancer/verification-documents/route.ts", import.meta.url),
  "utf8",
);
const coverRoute = readFileSync(new URL("../app/api/venue/cover-image/route.ts", import.meta.url), "utf8");
const logoRoute = readFileSync(new URL("../app/api/venue/logo-image/route.ts", import.meta.url), "utf8");

test("retired identity-document storage rejects direct dancer writes", () => {
  for (const action of ["upload", "update", "delete"]) {
    assert.match(
      migration,
      new RegExp(`drop policy if exists "dancers ${action} own verification files"`, "i"),
    );
  }
  assert.match(verificationRoute, /Identity-document uploads are disabled/);
  assert.match(verificationRoute, /status:\s*410/);
});

test("venue branding remains behind authenticated server moderation", () => {
  assert.match(migration, /drop policy if exists "venue owners manage own cover images"/i);
  assert.match(migration, /drop policy if exists "venue owners manage own logo images"/i);

  for (const route of [coverRoute, logoRoute]) {
    const authIndex = route.indexOf("createRequestSupabaseContext(request)");
    const adminIndex = route.indexOf("createAdminSupabaseClient()", authIndex);
    const uploadIndex = route.indexOf("uploadVenue", adminIndex);
    assert.ok(authIndex >= 0);
    assert.ok(adminIndex > authIndex);
    assert.ok(uploadIndex > adminIndex);
  }
});
