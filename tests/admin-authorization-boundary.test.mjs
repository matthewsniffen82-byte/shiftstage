import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { requestRoleFixture } from "./helpers/request-role-fixture.mjs";

const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const adminCode = compile("src/lib/dancr/admin.ts");
const quietConsole = { log() {}, warn() {}, error() {}, info() {} };

function fixture(options = {}) {
  const auth = requestRoleFixture(options), unexpected = [];
  const unavailable = new Proxy({}, { get(_target, name) {
    if (name === "__esModule") return false;
    if (/^is[A-Z].*Error$/.test(String(name))) return () => false;
    return class { constructor() { unexpected.push(String(name)); throw new Error("Unexpected work before authorization"); } };
  } });
  const adminExports = {};
  vm.runInNewContext(adminCode, { exports: adminExports, Error, console: quietConsole, require(name) {
    if (name === "server-only") return {};
    if (name === "../api-error-policy") return { PublicApiError };
    return unavailable;
  } });
  return { auth, unexpected, adminExports, unavailable };
}

function loadRoute(code, f) {
  const exports = {};
  vm.runInNewContext(code, { exports, Error, Request, Response, URL, Blob, Buffer, console: quietConsole, require(name) {
    if (name === "next/server" || name.startsWith("node:")) return require(name);
    if (name === "@/src/lib/dancr/admin") return { ...f.unavailable, requireAdmin: f.adminExports.requireAdmin };
    if (name === "@/src/lib/supabase/request") return { createRequestSupabaseContext: f.auth.createContext };
    if (name === "@/src/lib/api" || name === "@/src/lib/api-error-policy") return {
      PublicApiError, apiError(error, fallback, status) {
        const result = resolveApiError(error, fallback, status);
        return require("next/server").NextResponse.json(result.body, { status: result.status });
      },
    };
    if (name === "@/src/lib/security/safe-error-metadata") return { safeErrorMetadata: () => ({}) };
    return f.unavailable;
  } });
  return exports;
}

const routes = readdirSync(new URL("../app/api/admin/", import.meta.url), { recursive: true })
  .filter(path => /(?:^|[\\/])route\.ts$/.test(path))
  .map(path => "app/api/admin/" + path.replaceAll("\\", "/"));
const denied = [
  ...["customer", "dancer", "venue"].map(role => ({ label: role, role, state: "active", status: 403 })),
  ...["disabled", "deleted"].map(state => ({ label: state + " admin", role: "admin", state, status: 403 })),
  { label: "missing account", missing: true, status: 403 },
  { label: "anonymous", anonymous: true, status: 401 },
];
for (const file of routes) {
  const code = compile(file);
  const methods = [...readFileSync(new URL("../" + file, import.meta.url), "utf8").matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\(/g)].map(m => m[1]);
  for (const method of methods) for (const actor of denied) test(`${method} ${file} denies ${actor.label} before privileged work`, async () => {
    const f = fixture(actor), handlers = loadRoute(code, f);
    const request = new Request("https://www.mydancr.com/api/admin/test?role=admin&userId=forged", {
      method, headers: actor.anonymous ? {} : { authorization: "Bearer synthetic-token", "x-role": "admin", "x-dancr-refresh-token": "synthetic-refresh" },
    });
    const response = await handlers[method](request, { params: Promise.resolve({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      photoId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      socialId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }) });
    assert.equal(response.status, actor.status);
    assert.deepEqual(f.unexpected, []);
    assert.equal(request.bodyUsed, false);
    if (!actor.anonymous) assert.deepEqual(f.auth.calls.find(c => c[0] === "eq"), ["eq", "id", "verified-owner"]);
  });
}

for (const refresh of [false, true]) test(`active database admins retain access with refresh=${refresh}`, async () => {
  const f = fixture({ role: "admin" });
  const context = await f.auth.createContext(new Request("https://www.mydancr.com/api/admin/test", {
    headers: { authorization: "Bearer synthetic-token", ...(refresh ? { "x-dancr-refresh-token": "synthetic-refresh" } : {}) },
  }));
  await f.adminExports.requireAdmin(context.client, context.user.id);
  assert.deepEqual(f.unexpected, []);
  assert.ok(f.auth.calls.findIndex(c => c[0] === "getUser") < f.auth.calls.findIndex(c => c[0] === "from"));
});
