import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { boundedSupabaseFetch } from "../src/lib/supabase/bounded-fetch.ts";

const source = readFileSync(new URL("../src/lib/supabase/request.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture(failureAt, error) {
  const session = { access_token: "verified-access", refresh_token: "verified-refresh", expires_at: 2000000000 };
  const user = { id: "verified-user" };
  const calls = [];
  const client = { auth: {
    async setSession() {
      calls.push("session");
      return failureAt === "session" ? { data: { session: null }, error } : { data: { session }, error: null };
    },
    async getUser() {
      calls.push("user");
      return failureAt === "user" ? { data: { user: null }, error } : { data: { user }, error: null };
    },
  } };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, require: (name) => {
    if (name === "@supabase/supabase-js") return { createClient: () => client };
    if (name === "../env.ts") return { getPublicEnv: () => ({ supabaseUrl: "https://example.test", supabaseAnonKey: "public-test-key" }) };
    if (name === "../api-error-policy.ts") return { PublicApiError };
    if (name === "./bounded-fetch.ts") return { boundedSupabaseFetch };
    throw new Error(`Unexpected import ${name}`);
  } });
  return { createContext: exports.createRequestSupabaseContext, calls };
}

for (const refresh of [true, false]) {
  for (const failureAt of refresh ? ["session", "user"] : ["user"]) {
    for (const error of [{ status: 503 }, { status: 408 }, { status: 429 }, { status: 0 }, { name: "AuthRetryableFetchError" }, { status: 401 }, { status: 400 }, null]) {
      test(`auth ${refresh ? 'with' : 'without'} refresh: ${failureAt} failure ${JSON.stringify(error)} remains distinct from a verified session`, async () => {
        const { createContext, calls } = fixture(failureAt, error);
        const request = new Request("https://example.test/api/account", { headers: {
          authorization: "Bearer original-access",
          ...(refresh ? { "x-dancr-refresh-token": "original-refresh" } : {}),
        } });
        const transient = error && (error.status === 503 || error.status === 408 || error.status === 429 || error.status === 0 || error.name === "AuthRetryableFetchError");
        await assert.rejects(createContext(request), failure => {
          const result = resolveApiError(failure, "Unable to load account.");
          assert.equal(result.status, transient ? 503 : 401);
          assert.equal(result.body.code, transient ? "UNAVAILABLE" : "AUTH_REQUIRED");
          return true;
        });
        if (failureAt === "session") assert.deepEqual(calls, ["session"]);
      });
    }
  }
}

test("a successfully refreshed session still requires a verified server user", async () => {
  const { createContext, calls } = fixture(null, null);
  const context = await createContext(new Request("https://example.test/api/account", { headers: {
    authorization: "Bearer original-access", "x-dancr-refresh-token": "original-refresh",
  } }));
  assert.deepEqual(calls, ["session", "user"]);
  assert.equal(context.user.id, "verified-user");
  assert.equal(context.session.accessToken, "verified-access");
});
