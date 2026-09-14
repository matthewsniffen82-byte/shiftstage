import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

test("image and video recovery run every five minutes at different offsets", () => {
  const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.crons.find(job => job.path === "/api/cron/image-moderation").schedule, "*/5 * * * *");
  assert.equal(config.crons.find(job => job.path === "/api/cron/video-moderation").schedule, "2-59/5 * * * *");
});

for (const failure of [false, true]) test(`exhausted video recovery fits a short remaining budget and reports ${failure ? "failure" : "backlog"}`, async () => {
  const calls = [], logs = [], exports = {};
  const query = {
    select(_fields, options) { assert.equal(options.count, "exact"); return query; },
    eq() { return query; }, order() { return query; },
    lt(field) { assert.notEqual(field, "moderation_attempt_count"); return query; },
    limit(value) { assert.equal(value, 2); return query; },
    then(resolve) { resolve({ data: [{ id: "synthetic", status: "moderating", moderation_attempt_count: 3 }], count: 12, error: null }); },
  };
  const dependencies = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/src/lib/dancr/cron-auth": { authorizeCronRequest: () => null },
    "@/src/lib/dancr/tv": { async retryMyDancrTvAutomatedModeration(_admin, id) {
      calls.push(id); if (failure) throw new Error("Synthetic database failure");
      return { status: "submitted", moderation_decision: "review" };
    } },
    "@/src/lib/dancr/video-moderation-mode": { isVideoDemoAutoApproveMode: () => false },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ from: () => query }) },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
    "@/src/lib/server-job": { VIDEO_PROCESSING_JOB_TIMEOUT_MS: 240000, VIDEO_PROCESSING_ROUTE_TIMEOUT_MS: 270000,
      MODERATION_WORKER_STALE_MS: 300000, runWithServerJob: operation => operation(), serverJobRemainingMs: () => 20000 },
  };
  const source = readFileSync(new URL("../app/api/cron/video-moderation/route.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, Date, console: { info: value => logs.push(JSON.parse(value)), error() {} }, require: name => {
      assert.ok(name in dependencies, name); return dependencies[name];
    } });
  const response = await exports.GET(new Request("https://synthetic.invalid"));
  assert.equal(response.status, failure ? 500 : 200);
  const result = await response.json();
  assert.equal(result.eligibleAtStart, 12);
  assert.equal(result.processed, 1);
  assert.equal(result.failed, failure ? 1 : 0);
  assert.deepEqual(calls, ["synthetic"]);
  assert.equal(logs[0].eligibleAtStart, 12);
});
