import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jobs from "../src/lib/server-job.ts";

const videoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
function loadRoute(path, dependencies, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(read(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, { exports, Error, Date, Math, console: { error() {}, info() {} }, ...globals,
    require(name) {
      assert.ok(name in dependencies, `Unexpected route dependency: ${name}`);
      return dependencies[name];
    },
  });
  return exports;
}

test("video budgets fit within route and worker ownership limits without extending image jobs", () => {
  assert.equal(jobs.MODERATION_JOB_TIMEOUT_MS, 45_000);
  assert.ok(jobs.VIDEO_PROCESSING_JOB_TIMEOUT_MS >= 120_000 + 30_000 + 60_000);
  assert.ok(jobs.VIDEO_PROCESSING_JOB_TIMEOUT_MS < jobs.VIDEO_PROCESSING_ROUTE_TIMEOUT_MS);
  assert.ok(jobs.VIDEO_PROCESSING_ROUTE_TIMEOUT_MS < jobs.MODERATION_WORKER_STALE_MS);
  for (const path of ["dancer/tv/videos/[id]", "cron/video-moderation", "admin/tv/videos", "admin/tv/import"]) {
    const duration = Number(read(`app/api/${path}/route.ts`).match(/export const maxDuration = (\d+)/)?.[1]);
    assert.equal(duration, 300);
    assert.ok(jobs.VIDEO_PROCESSING_ROUTE_TIMEOUT_MS < duration * 1000);
  }
});

for (const [elapsed, alreadyAccepted] of [[2000, false], [31_000, false], [2000, true]]) {
  test(`submission remains immediate and bounds deferred work (${elapsed}ms elapsed, accepted=${alreadyAccepted})`, async () => {
    const after = [], budgets = [], retried = [];
    let now = 0;
    const route = loadRoute("app/api/dancer/tv/videos/[id]/route.ts", {
      "next/server": { NextResponse: { json: Response.json }, after: callback => after.push(callback) },
      "@/src/lib/api": { apiError(error) { throw error; } },
      "@/src/lib/bounded-json-body": { readBoundedJsonObject: async () => ({ action: "submit" }) },
      "@/src/lib/dancr/tv": {
        async submitMyDancrTvUpload(_admin, _userId, id, options) {
          assert.equal(options.deferModeration, true);
          now = elapsed;
          return { id, status: "moderating", submissionAlreadyAccepted: alreadyAccepted };
        },
        async retryMyDancrTvAutomatedModeration(_admin, id) { retried.push(id); },
      },
      "@/src/lib/dancr/media-request-rate-limit": {
        DancerMediaRateLimitError: class extends Error {}, enforceDancerMediaRequestRateLimit: async () => {},
      },
      "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
      "@/src/lib/supabase/request": { createRequestSupabaseContext: async (_request, access) => {
        assert.equal(access.role, "dancer"); return { user: { id: "synthetic-user" } };
      } },
      "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
      "@/src/lib/server-job": { ...jobs, async runWithServerJob(operation, timeoutMs) {
        budgets.push(timeoutMs); return operation();
      } },
    }, { performance: { now: () => now } });
    const result = await route.PATCH(new Request("https://synthetic.invalid", { method: "PATCH" }), { params: Promise.resolve({ id: videoId }) });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).video.status, "moderating");
    assert.equal(retried.length, 0, "encoding must not delay the upload acknowledgment");
    assert.equal(after.length, alreadyAccepted ? 0 : 1);
    for (const work of after) await work();
    const enoughTime = !alreadyAccepted && jobs.VIDEO_PROCESSING_ROUTE_TIMEOUT_MS - elapsed >= jobs.VIDEO_PROCESSING_JOB_TIMEOUT_MS;
    assert.deepEqual(retried, enoughTime ? [videoId] : []);
    assert.deepEqual(budgets, enoughTime ? [jobs.VIDEO_PROCESSING_ROUTE_TIMEOUT_MS - elapsed] : []);
  });
}

test("cron leaves the next video unclaimed when a full encoding job no longer fits", async () => {
  let remaining = jobs.VIDEO_PROCESSING_ROUTE_TIMEOUT_MS;
  const retried = [], budgets = [];
  const query = {
    select() { return query; }, lt() { return query; }, eq() { return query; }, order() { return query; },
    limit(value) { assert.equal(value, 2); return query; },
    then(resolve) { resolve({ data: [{ id: videoId, status: "moderating" }, { id: "second", status: "moderating" }], error: null }); },
  };
  const route = loadRoute("app/api/cron/video-moderation/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/src/lib/dancr/cron-auth": { authorizeCronRequest: () => null },
    "@/src/lib/dancr/tv": { async retryMyDancrTvAutomatedModeration(_admin, id) {
      retried.push(id); remaining -= 60_000; return { status: "approved" };
    } },
    "@/src/lib/dancr/video-moderation-mode": { isVideoDemoAutoApproveMode: () => false },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ from: () => query }) },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
    "@/src/lib/server-job": { ...jobs, serverJobRemainingMs: () => remaining,
      async runWithServerJob(operation, timeoutMs) { budgets.push(timeoutMs); return operation(); },
    },
  });
  const result = await route.GET(new Request("https://synthetic.invalid"));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).processed, 1);
  assert.deepEqual(retried, [videoId]);
  assert.deepEqual(budgets, [jobs.VIDEO_PROCESSING_ROUTE_TIMEOUT_MS]);
});
