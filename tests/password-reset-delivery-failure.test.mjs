import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/api/auth/route.ts", import.meta.url), "utf8");
const policySource = readFileSync(new URL("../src/lib/api-error-policy.ts", import.meta.url), "utf8");
function compile(source, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Request, Response, URL, Error, Buffer,
    console: { error() {}, warn() {} },
    require(name) {
      if (name === "next/server" || name === "node:crypto") return require(name);
      if (name in dependencies) return dependencies[name];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const policy = compile(policySource, {});

function resetFixture(providerError) {
  const calls = [];
  const dependencies = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map((match) => [match[1], {}]));
  Object.assign(dependencies, {
    "@supabase/supabase-js": { isAuthError: () => false },
    "@/src/lib/api": {
      PublicApiError: policy.PublicApiError,
      apiError(error, fallback) {
        const result = policy.resolveApiError(error, fallback);
        return Response.json(result.body, { status: result.status });
      },
    },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: (request) => request.json() },
    "@/src/lib/supabase/server": { createServerSupabaseClient: () => ({ auth: {
      resetPasswordForEmail: async (email, options) => {
        calls.push({ email, options });
        return { error: providerError };
      },
    } }) },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/account-recovery": {
      AccountRecoveryRateLimitError: class extends Error {},
      enforceAccountRecoveryRateLimit: async () => calls.push("rate-limit"),
    },
    "@/src/lib/dancr/public-request-rate-limit": { PublicRequestRateLimitError: class extends Error {} },
    "@/src/lib/dancr/public-app-url": { publicAppUrl: () => "https://mydancr.com" },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
  });
  return { ...compile(source, dependencies), calls };
}

function request() {
  return new Request("https://mydancr.com/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "reset_password", role: "dancer", email: "dancer@example.com" }),
  });
}

for (const message of ["upstream connection failure", "Error sending recovery email", "{}"])
  test(`provider failure returns unavailable instead of claiming an email is on its way: ${message}`, async () => {
    const fixture = resetFixture(new Error(message));
    const response = await fixture.POST(request());
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.code, "UNAVAILABLE");
    assert.match(body.error, /Password reset is temporarily unavailable/);
    assert.doesNotMatch(body.error, /on the way|dancer@example.com/);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.equal(fixture.calls[0], "rate-limit");
    assert.equal(fixture.calls.length, 2);
  });

test("an accepted reset preserves the account-neutral confirmation and callback", async () => {
  const fixture = resetFixture(null);
  const response = await fixture.POST(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.message, /If that email has a MyDancr account/);
  assert.equal(fixture.calls[1].options.redirectTo, "https://mydancr.com/auth/callback");
});

test("provider email rate limits remain retryable errors", async () => {
  const response = await resetFixture(new Error("email rate limit exceeded")).POST(request());
  assert.equal(response.status, 429);
  assert.equal((await response.json()).ok, false);
});
