import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createRootContentSecurityPolicy } from "../src/lib/security/root-content-security-policy.mjs";

const source = readFileSync(new URL("../app/auth/callback/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
for (const mode of ["empty", "valid", "invalid", "outage"]) test(`${mode} callback sends an exact script allowlist without caching credentials`, async () => {
  const exports = {};
  const dependencies = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(match => [match[1], {}]));
  Object.assign(dependencies, {
    "@/src/lib/security/root-content-security-policy.mjs": { createRootContentSecurityPolicy },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
    "@/src/lib/dancr/safe-return-path": { safeLocalReturnPath: () => "" },
    "@/src/lib/dancr/browser-session": { BROWSER_AUTH_SESSION_KEY: "synthetic-session" },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/auth": { getAccountByUserId: async () => ({ id: "synthetic-user", role: "customer" }) },
    "@/src/lib/supabase/server": { createServerSupabaseClient: () => ({ auth: { exchangeCodeForSession: async () => ({
      data: mode === "valid" ? { user: { id: "synthetic-user" }, session: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" } } : {},
      error: mode === "outage" ? { status: 503 } : mode === "invalid" ? { status: 400 } : null,
    }) } }) },
  });
  vm.runInNewContext(code, { exports, Response, URL, Error, console: { warn() {}, error() {} }, require: name => dependencies[name] });
  const response = await exports.GET(new Request("https://www.mydancr.com/auth/callback?type=recovery" + (mode === "empty" ? "" : "&code=synthetic-code")));
  assert.equal(response.status, mode === "outage" ? 503 : 200);
  const html = await response.text(), csp = response.headers.get("content-security-policy") || "";
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 1);
  for (const script of scripts) assert.ok(csp.includes("'sha256-" + createHash("sha256").update(script).digest("base64") + "'"));
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline|unsafe-eval|synthetic-access|synthetic-refresh|synthetic-code/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.ok(!csp.includes(createHash("sha256").update("window.injected=true").digest("base64")));
});
