import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/202608280002_lock_account_role_mutations.sql", import.meta.url),
  "utf8",
);
const authRoute = readFileSync(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
const accountRoute = readFileSync(new URL("../app/api/account/route.ts", import.meta.url), "utf8");

test("browser roles cannot mutate account identity or authorization columns", () => {
  assert.match(
    migration,
    /revoke insert, update, delete on table public\.app_users from anon, authenticated/i,
  );
  assert.match(migration, /drop policy if exists "users update own profile"/i);
  assert.match(migration, /drop policy if exists "users create own app profile"/i);
});

test("account provisioning and lifecycle mutations remain behind trusted server clients", () => {
  assert.match(authRoute, /provisionAppAccount\(createAdminSupabaseClient\(\), \{/);
  assert.match(accountRoute, /setAccountState\(client, user\.id, accountState, createAdminSupabaseClient\(\)\)/);
  assert.match(accountRoute, /const admin = createAdminSupabaseClient\(\)/);
});
