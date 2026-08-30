import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/202608280002_lock_account_role_mutations.sql", import.meta.url),
  "utf8",
);
const authRoute = readFileSync(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
const accountRoute = readFileSync(new URL("../app/api/account/route.ts", import.meta.url), "utf8");
const callbackRoute = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
const authRoleMigration = readFileSync(
  new URL("../supabase/migrations/202608290001_lock_auth_signup_role_claims.sql", import.meta.url),
  "utf8",
);

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

test("public auth metadata cannot provision privileged application roles", () => {
  assert.match(authRoleMigration, /raw_app_meta_data->>'mydancr_provisioned_role'/);
  assert.match(authRoleMigration, /public_role in \('customer', 'dancer'\)/);
  assert.match(authRoleMigration, /trusted_role in \('admin', 'venue'\)/);
  assert.doesNotMatch(authRoleMigration, /coalesce\(new\.raw_user_meta_data->>'role', 'customer'\)::public\.user_role/);
  assert.match(authRoute, /app_metadata:\s*\{\s*mydancr_provisioned_role: "admin"/);
  assert.match(authRoute, /app_metadata:\s*\{\s*mydancr_provisioned_role: "venue"/);
});

test("email callback recovery never provisions venue authority from a browser role hint", () => {
  assert.match(callbackRoute, /function publicCallbackProvisioningRole/);
  assert.match(callbackRoute, /role === "customer" \|\| role === "dancer" \? role : null/);
  assert.match(callbackRoute, /const provisioningRole = publicCallbackProvisioningRole\(roleHint\)/);
  assert.doesNotMatch(callbackRoute, /!account \? roleHint : null/);
});
