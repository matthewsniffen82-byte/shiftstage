import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/202608280006_lock_security_definer_trigger_execution.sql", import.meta.url),
  "utf8",
);

test("security-definer trigger functions are not callable by browser roles", () => {
  assert.match(migration, /namespace\.nspname = 'public'/i);
  assert.match(migration, /procedure\.prosecdef/i);
  assert.match(migration, /'pg_catalog\.trigger'::regtype/i);
  assert.match(migration, /'pg_catalog\.event_trigger'::regtype/i);
  assert.match(
    migration,
    /revoke execute on function %I\.%I\(%s\) from public, anon, authenticated/i,
  );
});
