import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError } from "../../src/lib/api-error-policy.ts";

const source = readFileSync(new URL("../../src/lib/supabase/request.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
export function requestRoleFixture({ role = "dancer", state = "active", missing = false, accountError = null, authError = null } = {}) {
  const calls = [];
  const user = { id: "verified-owner", user_metadata: { role: "admin", account_state: "active" }, app_metadata: { role: "admin" } };
  const row = missing ? null : { id: user.id, role, account_state: state };
  const session = { access_token: "verified-access", refresh_token: "verified-refresh", expires_at: 2000000000 };
  const client = { auth: {
    async setSession() { calls.push(["setSession"]); return { data: { session }, error: null }; },
    async getUser() { calls.push(["getUser"]); return { data: { user: authError ? null : user }, error: authError }; },
  }, from(table) {
    calls.push(["from", table]); let id;
    return { select(columns) { calls.push(["select", columns]); return this; },
      eq(key, value) { calls.push(["eq", key, value]); if (key === "id") id = value; return this; },
      async maybeSingle() { return { data: id === user.id ? row : null, error: accountError }; },
    };
  } };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, require(name) {
    if (name === "@supabase/supabase-js") return { createClient: () => client };
    if (name === "../env.ts") return { getPublicEnv: () => ({ supabaseUrl: "https://example.test", supabaseAnonKey: "public-fixture" }) };
    if (name === "../api-error-policy.ts") return { PublicApiError };
    if (name === "./bounded-fetch.ts") return { boundedSupabaseFetch: () => { throw new Error("No network in role tests"); } };
    throw new Error(name);
  } });
  return { createContext: exports.createRequestSupabaseContext, calls, user, row };
}
