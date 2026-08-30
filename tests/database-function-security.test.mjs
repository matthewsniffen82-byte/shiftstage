import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/202608300004_harden_database_function_execution.sql", import.meta.url),
  "utf8",
);

test("legacy SQL helpers use fixed search paths and are not browser-callable", () => {
  assert.match(
    migration,
    /alter function public\.slugify\(text\)[\s\S]*?set search_path = pg_catalog, pg_temp/i,
  );
  assert.match(
    migration,
    /alter function public\.unique_dancer_slug\(text, uuid\)[\s\S]*?set search_path = pg_catalog, pg_temp/i,
  );
  assert.match(
    migration,
    /revoke execute on function public\.slugify\(text\)[\s\S]*?from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /revoke execute on function public\.unique_dancer_slug\(text, uuid\)[\s\S]*?from public, anon, authenticated, service_role/i,
  );
});

test("all public trigger functions are excluded from direct API execution", () => {
  assert.match(migration, /namespace\.nspname = 'public'/i);
  assert.doesNotMatch(migration, /procedure\.prosecdef/i);
  assert.match(migration, /'pg_catalog\.trigger'::regtype/i);
  assert.match(migration, /'pg_catalog\.event_trigger'::regtype/i);
  assert.match(
    migration,
    /revoke execute on function %I\.%I\(%s\) from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /alter function public\.prohibit_financial_record_delete\(\)[\s\S]*?set search_path = pg_catalog, pg_temp/i,
  );
});
