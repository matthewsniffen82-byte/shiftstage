import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const request = () => new Request("https://www.mydancr.com/api/reports", {
  method: "POST", headers: { "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.41" },
  body: JSON.stringify({ targetType: "contact_message", targetLabel: "Synthetic contact", reason: "Synthetic request" }),
});
const input = () => ({ namespace: "synthetic_boundary", request: request(), subject: " Synthetic@Example.invalid ", windowSeconds: 600, ipLimit: 5, subjectLimit: 3 });

function fixture({ error = null, decision = { allowed: true }, thrown = null } = {}) {
  const calls = [], rows = [], cache = new Map();
  const client = {
    async rpc(name, args) { calls.push({ rpc: name, args }); if (thrown) throw thrown; return { data: decision, error }; },
    from(table) {
      calls.push({ table });
      const filters = new Map();
      let inserted = null;
      return {
        select() { return this; },
        eq(name, value) { filters.set(name, value); return this; },
        gte() { return Promise.resolve({ count: rows.filter(row => [...filters].every(([name, value]) => row[name] === value)).length, error: null }); },
        insert(records) {
          rows.push(...(Array.isArray(records) ? records : [records]));
          inserted = { ...rows.at(-1), id: "00000000-0000-4000-8000-000000000001", created_at: "2026-09-12T00:00:00Z" };
          return this;
        },
        async single() { return { data: inserted, error: null }; },
        then(onFulfilled, onRejected) { return Promise.resolve({ data: inserted, error: null }).then(onFulfilled, onRejected); },
      };
    },
  };
  function load(file) {
    const absolute = resolve(root, file);
    if (cache.has(absolute)) return cache.get(absolute);
    const exports = {}; cache.set(absolute, exports);
    vm.runInNewContext(ts.transpileModule(readFileSync(absolute, "utf8"), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText, {
      exports, Error, Request, Response, URL, Date, Buffer, Headers, TextDecoder, Uint8Array,
      process: { env: { SUPABASE_SERVICE_ROLE_KEY: "synthetic-rate-prerequisite-only" } },
      console: { warn() {}, error() {}, info() {} },
      require(name) {
        if (name === "server-only") return {};
        if (name === "next/server" || name.startsWith("node:")) return require(name);
        if (name === "@/src/lib/supabase/admin") return { createAdminSupabaseClient: () => client };
        if (name === "@/src/lib/supabase/request") return { getBearerToken: () => "", assertOptionalAuthAvailable() {} };
        const target = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(absolute), name);
        return load(target.endsWith(".ts") || target.endsWith(".mjs") ? target : target + ".ts");
      },
    });
    return exports;
  }
  const limiter = load("src/lib/dancr/public-request-rate-limit.ts");
  return { ...limiter, calls, rows, client, load };
}

test("missing atomic prerequisite cannot admit a concurrent burst through legacy counts", async () => {
  const f = fixture({ error: { code: "PGRST202", message: "Synthetic missing function" } });
  const results = await Promise.allSettled(Array.from({ length: 20 }, () => f.enforcePublicRequestRateLimit(f.client, input())));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 0);
  assert.equal(results.filter(result => result.status === "rejected").length, 20);
  assert.equal(f.calls.filter(call => call.rpc).length, 20);
  assert.equal(f.calls.filter(call => call.table).length, 0);
  assert.equal(f.rows.length, 0);
});

test("missing atomic prerequisite returns a safe typed unavailable result", async () => {
  const f = fixture({ error: { code: "PGRST202", message: "Synthetic internal function signature" } });
  const policy = f.load("src/lib/api-error-policy.ts");
  await assert.rejects(f.enforcePublicRequestRateLimit(f.client, input()), error => {
    assert.ok(error instanceof policy.PublicApiError);
    assert.equal(error.status, 503); assert.equal(error.code, "UNAVAILABLE");
    assert.doesNotMatch(error.message, /PGRST|signature|Synthetic/);
    return true;
  });
  assert.equal(f.calls.length, 1);
});

for (const code of ["XX000", "42501", "57014", "SUPABASE_UNAVAILABLE"]) test(`returned ${code} remains a single failed request without legacy writes`, async () => {
  const failure = { code, message: "Synthetic private details" }, f = fixture({ error: failure });
  await assert.rejects(f.enforcePublicRequestRateLimit(f.client, input()), error => error === failure);
  assert.equal(f.calls.length, 1); assert.equal(f.rows.length, 0);
});

test("thrown uncertain transport failure is not replayed", async () => {
  const failure = new Error("Synthetic transport failure"), f = fixture({ thrown: failure });
  await assert.rejects(f.enforcePublicRequestRateLimit(f.client, input()), error => error === failure);
  assert.equal(f.calls.length, 1); assert.equal(f.rows.length, 0);
});

for (const decision of [null, {}, [], { allowed: "true" }, { allowed: 1 }]) test(`malformed atomic decision ${JSON.stringify(decision)} cannot grant admission`, async () => {
  const f = fixture({ decision });
  await assert.rejects(f.enforcePublicRequestRateLimit(f.client, input()), error => error instanceof f.PublicRequestRateLimitError);
  assert.equal(f.calls.length, 1); assert.equal(f.rows.length, 0);
});

test("acknowledged admission retains the exact budget and hashed identities", async () => {
  const f = fixture();
  await f.enforcePublicRequestRateLimit(f.client, input());
  assert.equal(f.calls.length, 1); assert.equal(f.rows.length, 0);
  assert.equal(f.calls[0].rpc, "consume_request_rate_limit");
  assert.equal(f.calls[0].args.p_window_seconds, 600);
  assert.equal(f.calls[0].args.p_ip_limit, 5); assert.equal(f.calls[0].args.p_subject_limit, 3);
  assert.match(f.calls[0].args.p_ip_hash, /^[a-f0-9-]{36}$/);
  assert.match(f.calls[0].args.p_subject_hash, /^[a-f0-9-]{36}$/);
  assert.doesNotMatch(JSON.stringify(f.calls), /192\.0\.2|example\.invalid|synthetic-rate-prerequisite-only/i);
});

test("report route returns 503 before target reads or persistence when the atomic prerequisite is absent", async () => {
  const f = fixture({ error: { code: "PGRST202", message: "Synthetic private metadata" } });
  const response = await f.load("app/api/reports/route.ts").POST(request());
  assert.equal(response.status, 503);
  const body = await response.json(); assert.equal(body.ok, false); assert.equal(body.code, "UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(body), /PGRST|metadata|Synthetic/);
  assert.equal(f.calls.length, 1); assert.equal(f.rows.length, 0);
});

test("report route preserves atomic denial and Retry-After without persistence", async () => {
  const f = fixture({ decision: { allowed: false, retry_after_seconds: 37 } });
  const response = await f.load("app/api/reports/route.ts").POST(request());
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "37");
  assert.equal(f.calls.length, 1); assert.equal(f.rows.length, 0);
});

test("report route preserves successful admission and one actual report write", async () => {
  const f = fixture();
  const response = await f.load("app/api/reports/route.ts").POST(request());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true); assert.equal(body.report.targetType, "contact_message");
  assert.equal(body.report.status, "open");
  assert.equal(f.calls.filter(call => call.rpc).length, 1);
  assert.equal(f.calls.filter(call => call.table).length, 1);
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].target_type, "contact_message");
});
