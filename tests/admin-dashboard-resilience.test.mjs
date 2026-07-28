import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [adminSource, dealMigration] = await Promise.all([
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../supabase/migrations/202606280002_club_deal_qr_attribution.sql", import.meta.url),
    "utf8",
  ),
]);

test("admin authentication is separate from optional dashboard section failures", () => {
  assert.match(adminSource, /authRequired\?: boolean/);
  assert.match(adminSource, /warnings\?: string\[\]/);
  assert.match(adminSource, /const needsSignIn = state\.authRequired === true/);
  assert.match(adminSource, /Promise\.allSettled/);
  assert.match(adminSource, /isAdminAuthenticationError\(result\.reason\)/);
  assert.match(adminSource, /nextState\.warnings = warnings/);
  assert.match(adminSource, /Retry unavailable sections/);
  assert.doesNotMatch(adminSource, /const needsSignIn = Boolean\(state\.error\)/);
});

test("stored sessions must belong to an admin before admin APIs receive their token", () => {
  assert.match(adminSource, /session\?\.account\?\.role !== "admin"/);
  assert.match(adminSource, /window\.localStorage\.removeItem\(SESSION_KEY\)/);
});

test("deal attribution policies call the shared no-argument admin authorization function", () => {
  assert.match(dealMigration, /using \(public\.is_admin\(\)\)/);
  assert.match(dealMigration, /with check \(public\.is_admin\(\)\)/);
  assert.doesNotMatch(dealMigration, /public\.is_admin\(auth\.uid\(\)\)/);
});
