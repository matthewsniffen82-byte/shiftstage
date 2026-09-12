import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test, { before, after } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { PublicApiError } from "../src/lib/api-error-policy.ts";

const nativeRequire = createRequire(import.meta.url);
function load(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { exports, URL, Request, Response, Uint8Array, console: { warn() {} },
    process: { env: { NODE_ENV: "production", DANCR_PUBLIC_RATE_LIMIT_SECRET: "synthetic-only-never-production" } },
    require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      if (name.startsWith("node:")) return nativeRequire(name);
      throw new Error(`Unexpected test dependency ${name}`);
    },
  });
  return exports;
}
const address = load("src/lib/security/request-client-address.ts");
const limiter = load("src/lib/dancr/public-request-rate-limit.ts", {
  "../security/request-client-address": address, "../api-error-policy.ts": { PublicApiError },
});
let db;
before(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(readFileSync(new URL("../supabase/migrations/202608300003_atomic_request_rate_limits.sql", import.meta.url), "utf8"));
});
after(async () => db?.close());
function fixture({ error = null, malformed = false, encoderError = false } = {}) {
  const calls = [], renders = [];
  const client = { async rpc(name, args) {
    assert.equal(name, "consume_request_rate_limit"); calls.push(args);
    if (error) return { data: null, error };
    if (malformed) return { data: {}, error: null };
    const { rows } = await db.query("select public.consume_request_rate_limit($1,$2::uuid,$3::uuid,$4::integer,$5::integer,$6::integer) decision", [
      args.p_namespace, args.p_ip_hash, args.p_subject_hash, args.p_window_seconds, args.p_ip_limit, args.p_subject_limit,
    ]);
    return { data: rows[0].decision, error: null };
  } };
  const route = load("app/api/public/share-qr/route.ts", {
    qrcode: { async toBuffer(value, options) { renders.push({ value, options }); if (encoderError) throw new Error("private encoder failure"); return Uint8Array.from([137, 80, 78, 71]); } },
    "@/src/lib/dancr/public-request-rate-limit": limiter,
    "@/src/lib/security/request-client-address": address,
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => client },
  });
  return { calls, renders, get(target = "https://www.mydancr.com/dancers/synthetic", headers = {}) {
    return route.GET(new Request("https://www.mydancr.com/api/public/share-qr?url=" + encodeURIComponent(target), { headers }));
  } };
}
test("a native persistent QR budget survives URL variants and separate route instances", async () => {
  const a = fixture(), b = fixture();
  for (let i = 0; i < 61; i++) {
    const f = i % 2 ? a : b;
    const response = await f.get(`https://www.mydancr.com/dancers/synthetic?mediaIndex=${i}`, {
      "x-vercel-forwarded-for": "192.0.2.10", "cf-connecting-ip": `192.0.2.${30 + i}`,
    });
    assert.equal(response.status, i < 60 ? 200 : 429);
    if (i === 60) {
      assert.match(response.headers.get("cache-control"), /private, no-store/);
      assert.ok(Number(response.headers.get("retry-after")) > 0);
    }
  }
  assert.equal(a.renders.length + b.renders.length, 60);
  const calls = [...a.calls, ...b.calls];
  assert.equal(new Set(calls.map(call => call.p_ip_hash)).size, 1);
  assert.equal(new Set(calls.map(call => call.p_subject_hash)).size, 1);
  assert.ok(calls.every(call => call.p_namespace === "public_share_qr" && call.p_window_seconds === 60));
  const other = fixture();
  assert.equal((await other.get(undefined, { "x-vercel-forwarded-for": "192.0.2.11" })).status, 200);
});
test("missing address and arbitrary user agents share one unknown-client budget", async () => {
  const f = fixture();
  await f.get(undefined, { "user-agent": "one", "cf-connecting-ip": "192.0.2.20" });
  await f.get("https://www.mydancr.com/venues/synthetic", { "user-agent": "two", "cf-connecting-ip": "192.0.2.21" });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].p_subject_hash, f.calls[1].p_subject_hash);
  assert.equal(f.calls[0].p_ip_hash, f.calls[1].p_ip_hash);
});
for (const error of [{ code: "PGRST202", message: "private missing function" }, { code: "SUPABASE_UNAVAILABLE", message: "private transport failure" }]) {
  test(`QR rendering fails closed on counter uncertainty ${error.code}`, async () => {
    const f = fixture({ error }); const response = await f.get();
    assert.equal(response.status, 503); assert.equal(f.renders.length, 0); assert.equal(f.calls.length, 1);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.doesNotMatch(await response.text(), /private|PGRST202|SUPABASE_UNAVAILABLE/);
  });
}
test("a malformed allowance cannot start image encoding", async () => {
  const f = fixture({ malformed: true }); const response = await f.get();
  assert.equal(response.status, 429); assert.equal(f.renders.length, 0);
});
test("invalid links are rejected before any counter or image work", async () => {
  const f = fixture();
  for (const target of ["", "https://other.invalid/dancers/synthetic", "https://www.mydancr.com/admin", "https://www.mydancr.com/dancers/" + "a".repeat(2048)]) {
    assert.equal((await f.get(target)).status, 400);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.renders.length, 0);
});
test("successful image format and cache policy remain intact", async () => {
  const f = fixture(); const response = await f.get(undefined, { "x-vercel-forwarded-for": "192.0.2.12" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), "image/png");
  assert.match(response.headers.get("cache-control"), /public, max-age=3600/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(f.renders[0].options.width, 360);
});
test("encoder failures do not refund uncertain work or expose details", async () => {
  const f = fixture({ encoderError: true }); const response = await f.get(undefined, { "x-vercel-forwarded-for": "192.0.2.13" });
  assert.equal(response.status, 503); assert.equal(f.calls.length, 1); assert.equal(f.renders.length, 1);
  assert.doesNotMatch(await response.text(), /private encoder/);
});
