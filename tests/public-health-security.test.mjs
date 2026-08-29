import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const healthRoute = await readFile(
  new URL("../app/api/health/supabase/route.ts", import.meta.url),
  "utf8",
);

test("the public Supabase health probe keeps diagnostics and environment state private", () => {
  assert.match(healthRoute, /console\.error\("SUPABASE_HEALTH_PROBE_FAILED", await formatSupabaseResponse\(response\)\);/);
  assert.match(healthRoute, /console\.error\("SUPABASE_HEALTH_PROBE_FAILED", formatUnexpectedError\(error\)\);/);
  assert.match(healthRoute, /function unhealthySupabaseResponse\(\)[\s\S]*?error: "Supabase health check failed\."[\s\S]*?status: 503/);
  assert.doesNotMatch(healthRoute, /env:\s*getSupabaseEnvStatus|getSupabaseEnvStatus\(\)/);
  assert.doesNotMatch(healthRoute, /error:\s*await formatSupabaseResponse|error:\s*formatUnexpectedError/);
});
