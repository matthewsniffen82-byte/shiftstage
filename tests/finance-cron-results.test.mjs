import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { safeErrorMetadata } from "../src/lib/security/safe-error-metadata.ts";

function compile(path, baseline = false) {
  const source = baseline
    ? execFileSync("git", ["show", "HEAD:" + path], { encoding: "utf8", windowsHide: true })
    : readFileSync(new URL("../" + path, import.meta.url), "utf8");
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const routeCode = compile("app/api/cron/finance/route.ts", process.env.FINANCE_CRON_BASELINE === "1");
const guardCode = compile("src/lib/dancr/cron-auth.ts");
const counts = {
  invoicesCreated: 0, invoicesOpened: 0, invoicesReconciled: 0, remindersSent: 0,
  payoutsCreated: 0, payoutsFailed: 0, natsExportsCreated: 0, natsExportsFailed: 0,
  natsReconciliationRequired: 0,
};
const reviewMessage = "Some finance work needs review. Check current invoice and payout states before retrying.";

async function invoke(result, { secret = "synthetic-cron-secret", authorization = "Bearer synthetic-cron-secret", failure } = {}) {
  const exports = {}, authExports = {}, logs = [], calls = { client: 0, job: 0 };
  const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };
  vm.runInNewContext(guardCode, {
    exports: authExports, Buffer, process: { env: { CRON_SECRET: secret } },
    require: name => name === "node:crypto" ? { timingSafeEqual } : next,
  });
  const client = { synthetic: true };
  vm.runInNewContext(routeCode, {
    exports, Error,
    console: {
      info: (...values) => logs.push(["info", ...values]),
      error: (...values) => logs.push(["error", ...values]),
    },
    require(name) {
      if (name === "next/server") return next;
      if (name.endsWith("cron-auth")) return authExports;
      if (name.endsWith("safe-error-metadata")) return { safeErrorMetadata };
      if (name.endsWith("supabase/admin")) return { createAdminSupabaseClient() { calls.client++; return client; } };
      if (name.endsWith("finance-automation")) return { async runQrFinanceAutomation(received) {
        calls.job++; assert.equal(received, client);
        if (failure) throw failure;
        return result;
      } };
      throw new Error("Unexpected dependency: " + name);
    },
  });
  const response = await exports.GET(new Request("https://example.invalid/api/cron/finance", {
    headers: authorization ? { authorization } : {},
  }));
  assert.equal(response.headers.has("retry-after"), false);
  return { response, body: await response.json(), logs: JSON.parse(JSON.stringify(logs)), calls };
}

for (const completed of [counts, { ...counts, invoicesCreated: 2, invoicesOpened: 1, invoicesReconciled: 3, remindersSent: 1, payoutsCreated: 2, natsExportsCreated: 1 }]) {
  test("finance cron acknowledges confirmed counts and excludes unexpected private fields: " + completed.invoicesCreated, async () => {
    const run = await invoke({ ...completed, errors: [], privateRecord: "private@example.invalid" });
    assert.equal(run.response.status, 200);
    assert.deepEqual(run.body, { ok: true, result: { ...completed, errors: [] } });
    assert.deepEqual(run.calls, { client: 1, job: 1 });
    assert.deepEqual(run.logs, [["info", "QR finance automation completed", { ...completed, errorCount: 0 }]]);
  });
}

for (const partial of [
  { errors: ["private invoice@example.invalid bearer credential"] },
  { payoutsFailed: 1 }, { natsExportsFailed: 1 }, { natsReconciliationRequired: 1 },
  { payoutsFailed: 1, natsExportsFailed: 2, errors: ["private database detail", "private provider detail"] },
]) {
  test("finance cron reports partial work without replaying completed stages: " + JSON.stringify(Object.keys(partial)), async () => {
    const input = { ...counts, invoicesCreated: 3, invoicesOpened: 2, errors: [], ...partial, privateRecord: "private value" };
    const run = await invoke(input);
    const expectedCounts = Object.fromEntries(Object.keys(counts).map(key => [key, input[key]]));
    assert.equal(run.response.status, 500);
    assert.deepEqual(run.body, {
      ok: false, partial: true, error: reviewMessage,
      result: { ...expectedCounts, errors: input.errors.map(() => reviewMessage) },
    });
    assert.deepEqual(run.calls, { client: 1, job: 1 });
    assert.deepEqual(run.logs, [["error", "QR finance automation partially completed", { ...expectedCounts, errorCount: input.errors.length }]]);
    assert.doesNotMatch(JSON.stringify([run.body, run.logs]), /private|bearer|credential/);
  });
}

for (const [label, input] of [
  ["missing result", undefined], ["null result", null],
  ["missing counter", { errors: [] }],
  ["missing errors", counts], ["non-array errors", { ...counts, errors: "private error" }],
  ...[-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"].map(value => ["invalid count " + value, { ...counts, errors: [], payoutsCreated: value }]),
]) {
  test("finance cron refuses an unconfirmed result: " + label, async () => {
    const run = await invoke(input);
    assert.equal(run.response.status, 500);
    assert.deepEqual(run.body, { ok: false, error: "QR finance automation failed." });
    assert.deepEqual(run.calls, { client: 1, job: 1 });
    assert.equal(run.logs.length, 1);
    assert.equal(run.logs[0][1], "QR finance automation failed");
    assert.doesNotMatch(JSON.stringify(run.logs), /private|payoutsCreated|stack/);
  });
}

test("finance cron safely reports a thrown database failure without rerunning billing", async () => {
  const run = await invoke(null, { failure: Object.assign(new Error("private database invoice@example.invalid"), { code: "57014", status: 503 }) });
  assert.equal(run.response.status, 500);
  assert.deepEqual(run.body, { ok: false, error: "QR finance automation failed." });
  assert.deepEqual(run.calls, { client: 1, job: 1 });
  assert.deepEqual(run.logs, [["error", "QR finance automation failed", { errorName: "Error", code: "57014", status: 503 }]]);
});

for (const [label, options, status] of [
  ["missing authorization", { authorization: "" }, 401],
  ["invalid authorization", { authorization: "Bearer different-secret" }, 401],
  ["unconfigured worker", { secret: "" }, 503],
]) {
  test("finance cron blocks " + label + " before privileged access", async () => {
    const run = await invoke({ ...counts, errors: [] }, options);
    assert.equal(run.response.status, status);
    assert.equal(run.body.ok, false);
    assert.deepEqual(run.calls, { client: 0, job: 0 });
    assert.deepEqual(run.logs, []);
  });
}
