import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { validatePublicSupabaseConfig } from "../src/lib/supabase/public-config.mjs";

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8");
function load(file, dependencies = {}, environment = {}) {
  const exports = {};
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, URL, Buffer, process: { env: environment }, require(name) {
    if (name === "server-only") return {};
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error("Unexpected fixture dependency: " + name);
  } });
  return exports;
}
const serverConfig = load("src/lib/supabase/server-config.ts");
const jwt = payload => "fixture-header." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".fixture-signature";
const url = "https://fixture-project.supabase.co";
const validKey = jwt({ role: "service_role", ref: "fixture-project" });

test("server configuration accepts both supported privileged key families", () => {
  for (const key of [validKey, "sb_secret_fixture-opaque-key"]) {
    assert.equal(serverConfig.validateServerSupabaseConfig(url, key), undefined);
  }
  // Self-hosted legacy keys and custom domains need not carry a hosted ref.
  assert.doesNotThrow(() => serverConfig.validateServerSupabaseConfig("http://localhost:54321", jwt({ role: "service_role" })));
  assert.doesNotThrow(() => serverConfig.validateServerSupabaseConfig("https://database.example.test", validKey));
});

test("server configuration rejects public, user, malformed and cross-project keys without disclosure", () => {
  for (const key of [
    "", " ", "fixture-placeholder", "sb_publishable_fixture-key", "sb_secret_", "sb_secret_fixture key",
    jwt({ role: "anon", ref: "fixture-project" }), jwt({ role: "authenticated" }),
    jwt({ role: "service_role", ref: "wrong-project" }), jwt(null), jwt("service_role"),
    "header.invalid-json.signature", validKey + "\n",
  ]) {
    assert.throws(() => serverConfig.validateServerSupabaseConfig(url, key), error => {
      if (key.trim()) assert.equal(error.message.includes(key), false);
      assert.equal(error.message.includes(url), false);
      assert.equal(error.message.includes("wrong-project"), false);
      return true;
    });
  }
  assert.throws(() => serverConfig.validateServerSupabaseConfig("fixture-bad-url", validKey), /server URL is invalid/);
});

test("invalid admin configuration fails before constructing a client or issuing requests", () => {
  const calls = [];
  let key = jwt({ role: "anon" });
  const boundedFetch = () => { throw new Error("No network permitted in this fixture"); };
  const sentinel = {};
  const admin = load("src/lib/supabase/admin.ts", {
    "@supabase/supabase-js": { createClient(...args) { calls.push(args); return sentinel; } },
    "../env": { getPublicEnv: () => ({ supabaseUrl: url, supabaseAnonKey: "sb_publishable_fixture-key" }) },
    "../server-env": { getServerEnv: () => key },
    "./bounded-fetch": { boundedSupabaseFetch: boundedFetch },
    "./server-config": serverConfig,
  });
  for (const invalid of [key, jwt({ role: "service_role", ref: "other-project" }), "placeholder"]) {
    key = invalid;
    assert.throws(() => admin.createAdminSupabaseClient());
    assert.equal(calls.length, 0);
  }
  key = validKey;
  assert.equal(admin.createAdminSupabaseClient(), sentinel);
  assert.equal(calls.length, 1);
  const [receivedUrl, receivedKey, options] = calls[0];
  assert.equal(receivedUrl, url);
  assert.equal(receivedKey, validKey);
  assert.equal(options.global.fetch, boundedFetch);
  assert.equal(options.auth.persistSession, false);
  assert.equal(options.auth.autoRefreshToken, false);
  assert.equal(options.auth.detectSessionInUrl, false);
});

test("required environment rejects empty configuration without changing valid credential bytes", () => {
  const environment = {};
  const server = load("src/lib/server-env.ts", {}, environment);
  for (const value of [undefined, "", " ", "\n\t"]) {
    environment.FIXTURE_SERVER_KEY = value;
    assert.throws(() => server.getServerEnv("FIXTURE_SERVER_KEY"), /Missing server environment variable: FIXTURE_SERVER_KEY/);
    assert.equal(server.getOptionalServerEnv("FIXTURE_SERVER_KEY"), null);
  }
  environment.FIXTURE_SERVER_KEY = " fixture-credential ";
  assert.equal(server.getServerEnv("FIXTURE_SERVER_KEY"), " fixture-credential ");
  assert.equal(server.getOptionalServerEnv("FIXTURE_SERVER_KEY"), "fixture-credential");
});

test("Vercel production configuration rejects loopback targets while local development remains supported", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    for (const protocol of ["http:", "https:"]) {
      const local = protocol + "//" + host + ":54321";
      assert.throws(() => validatePublicSupabaseConfig(local, "sb_publishable_fixture-key", { allowLocal: false }), /cannot target localhost/);
      assert.doesNotThrow(() => validatePublicSupabaseConfig(local, "sb_publishable_fixture-key"));
    }
  }
  assert.doesNotThrow(() => validatePublicSupabaseConfig(url, "sb_publishable_fixture-key", { allowLocal: false }));
  assert.doesNotThrow(() => validatePublicSupabaseConfig(undefined, undefined, { allowMissing: true, allowLocal: false }));
  assert.throws(() => validatePublicSupabaseConfig(undefined, undefined, { allowLocal: false }), /Missing/);
  const config = read("next.config.mjs");
  assert.match(config, /allowLocal: process\.env\.VERCEL_ENV !== "production"/);
  assert.match(config, /allowMissing: process\.env\.VERCEL_ENV !== "production"/);
});

test("every explicit Next browser environment property has a reviewed validation contract", () => {
  const source = ts.createSourceFile("next.config.mjs", read("next.config.mjs"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const nextConfig = source.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
    .find(declaration => declaration.name.getText(source) === "nextConfig").initializer;
  const env = nextConfig.properties.find(property => property.name?.getText(source) === "env").initializer;
  assert.deepEqual(env.properties.map(property => property.name?.getText(source)), ["DANCR_VIDEO_MODERATION_MODE"]);
});
