import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { serverJobRemainingMs, VIDEO_PROCESSING_JOB_TIMEOUT_MS } from "../src/lib/server-job.ts";
import { isPublicDancerProfileEligible } from "../src/lib/dancr/profile-approval.ts";
import {
  createWorkerDatabase, seedWorker, patchWorker, workerSnapshot, videoWorkerHarness,
  workerDecision, captureWorker, workerInstant, workerUserId,
} from "./helpers/video-worker-database.mjs";

let db;
before(async () => { db = await createWorkerDatabase(); });
beforeEach(async () => { await seedWorker(db); });
after(async () => { await db?.close(); });
const foreignWorker = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

test('processing timeout immediately becomes retryable and late completion cannot publish it',async()=>{
  const h=videoWorkerHarness(db,{jobTimeoutMs:80,holdPreparations:true});
  const outcome=await h.retry();
  assert.equal(outcome.status,'submitted');
  let snapshot=await workerSnapshot(db);
  assert.equal(snapshot.row.moderation_decision,'review');
  assert.deepEqual(snapshot.row.moderation_reason_codes,['video_moderation_timeout']);
  assert.equal(snapshot.row.published_at,null);
  h.releaseAll();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.watermarks.length,1);assert.deepEqual(await workerSnapshot(db),snapshot);
});
test('a timed out worker cannot change a newer worker or removed video',async()=>{
  for(const change of [{moderation_details:{workerId:foreignWorker}},{status:'hidden'}]){
    await seedWorker(db);
    const h=videoWorkerHarness(db,{jobTimeoutMs:150,holdPreparations:true});
    const job=captureWorker(h.retry());await h.waitFor(({preparationCount})=>preparationCount===1);
    await patchWorker(db,change);const before=await workerSnapshot(db);
    const outcome=await job;assert.match(outcome.error?.message||'',/review changed/);
    h.releaseAll();assert.deepEqual(await workerSnapshot(db),before);
  }
});

test("deferred submission acknowledges storage before inspection, then validates in the worker", async () => {
  await patchWorker(db, { status: "uploading" });
  const h = videoWorkerHarness(db);
  assert.equal((await h.submit(true)).status, "moderating");
  assert.equal(h.inspections.length, 0);
  assert.equal(h.providers.length, 0);
  assert.equal((await workerSnapshot(db)).row.upload_validation_pending, true);
  assert.equal((await h.retry()).status, "submitted");
  assert.equal(h.inspections.length, 1);
  assert.equal(h.providers.length, 0);
  assert.equal((await workerSnapshot(db)).row.upload_validation_pending, false);
});

test("failed background inspection stays private and manual approval cannot bypass it", async () => {
  await patchWorker(db, { status: "uploading" });
  const h = videoWorkerHarness(db, { inspectionError: new Error("Invalid uploaded container") });
  await h.submit(true);
  assert.equal((await h.retry()).status, "submitted");
  assert.equal(h.providers.length, 0);
  assert.equal(h.watermarks.length, 0);
  assert.equal((await workerSnapshot(db)).row.upload_validation_pending, true);
  await assert.rejects(h.review(), /Club approval|file preparation/);
  await assert.rejects(patchWorker(db, { status: "approved" }), /tv_validated_before_approval/);
  h.advance(600_000);
  await h.retryOwn();
  assert.equal((await workerSnapshot(db)).row.upload_validation_pending, true);
  const recovered = videoWorkerHarness(db);
  assert.equal((await recovered.retry()).status, "submitted");
  assert.equal(recovered.inspections.length, 1);
});

test("a replaced worker cannot commit inspection results or run AI", async () => {
  await patchWorker(db, { upload_validation_pending: true });
  const h = videoWorkerHarness(db, { beforeInspectionReturns: () => patchWorker(db, { moderation_details: { workerId: foreignWorker } }) });
  await assert.rejects(h.retry(), /review changed/);
  assert.equal(h.providers.length, 0);
  assert.equal(h.watermarks.length, 0);
  assert.equal((await workerSnapshot(db)).row.upload_validation_pending, true);
});

const unfinishedProfile = { stage_name: "", city: null, status: "draft", verification_status: "pending", approved_at: null, is_public: false };
test("owner retry queues a pending video and only the claimed worker prepares it", async () => {
  await patchWorker(db, { status: "submitted", moderation_started_at: new Date(workerInstant - 600000).toISOString(), reviewed_by: null, reviewed_at: null });
  const h = videoWorkerHarness(db);
  assert.equal((await h.retryOwn()).status, "moderating");
  assert.equal(h.providers.length, 0);
  await assert.rejects(h.retryOwn(), /wait before retrying/);
  assert.equal((await h.retry()).status, "submitted");
  assert.equal(h.providers.length, 0);
});
for (const status of ["approved", "rejected", "hidden", "expired", "uploading"]) test(`owner cannot restart ${status} video review`, async () => {
  await patchWorker(db, { status }); const h = videoWorkerHarness(db);
  const before = await workerSnapshot(db);
  await assert.rejects(h.retryOwn(), /no longer waiting/);
  assert.deepEqual(await workerSnapshot(db), before);
});
test("owner video retry rejects foreign ownership and concurrent human review", async () => {
  await patchWorker(db, { status: "submitted", moderation_started_at: new Date(workerInstant - 600000).toISOString() });
  const h = videoWorkerHarness(db);
  await assert.rejects(h.retryOwn(foreignWorker), /not found/);
  await patchWorker(db, { reviewed_by: workerUserId });
  await assert.rejects(h.retryOwn(), /no longer waiting/);
});
for (const demo of [false, true]) test(`${demo ? "demo" : "standard"} video review completes before stage name and city are saved`, async () => {
  await patchWorker(db, { status: "uploading" });
  const h = videoWorkerHarness(db, { demo, profile: unfinishedProfile });
  assert.equal((await h.submit(true)).status, "moderating");
  assert.equal((await h.retry()).status, "submitted");
  assert.equal(h.providers.length, 0);
  assert.equal(h.watermarks.length, 1);
  assert.equal(isPublicDancerProfileEligible(unfinishedProfile), false);
});

test("human video review can approve media while the dancer details are still a private draft", async () => {
  const h = videoWorkerHarness(db, { profile: unfinishedProfile });
  await h.retry();
  await patchWorker(db, { club_reviewed_at: new Date(workerInstant).toISOString(), club_reviewed_by: workerUserId });
  assert.equal((await h.review()).status, "approved");
  assert.equal(h.watermarks.length, 1);
  assert.equal(isPublicDancerProfileEligible(unfinishedProfile), false);
});

for (const demo of [false, true]) test(`${demo ? "legacy demo setting" : "standard setting"} does not publish until human approval`, async () => {
  const h = videoWorkerHarness(db, { demo, beforeWatermarkReturns() {
    const remaining = serverJobRemainingMs();
    assert.ok(remaining > 150_000 && remaining <= VIDEO_PROCESSING_JOB_TIMEOUT_MS);
  } });
  assert.equal((await h.retry()).status, "submitted");
  assert.equal(h.providers.length, 0);
  assert.equal(h.watermarks.length, 1);
  assert.equal((await workerSnapshot(db)).row.published_at, null);
  await patchWorker(db, { club_reviewed_at: new Date(workerInstant).toISOString(), club_reviewed_by: workerUserId });
  assert.equal((await h.review()).status, "approved");
  assert.equal(h.watermarks.length, 1);
  assert.ok((await workerSnapshot(db)).row.reviewed_by);
});

test("two queued workers race through native compare-and-set but only one starts file preparation", async () => {
  const h = videoWorkerHarness(db, { holdPreparations: true, synchronizeInitialReads: 2 });
  const jobs = [captureWorker(h.retry()), captureWorker(h.retry())];
  let outcomes;
  try {
    await h.waitFor(({ claimAttempts }) => claimAttempts === 2);
    assert.equal(h.providers.length, 0);
  } finally { h.releaseAll(); outcomes = await Promise.all(jobs); }
  assert.equal(outcomes.filter(outcome => outcome.value === null).length, 1);
  assert.equal(outcomes.filter(outcome => outcome.value?.status === "submitted").length, 1);
  assert.equal((await workerSnapshot(db)).row.moderation_attempt_count, 1);
});

for (const [name, values] of [
  ["an active worker", { moderation_attempt_count: 1, moderation_details: { workerId: foreignWorker } }],
  ["an active final attempt", { moderation_attempt_count: 3, moderation_details: { workerId: foreignWorker } }],
  ["an unbounded start timestamp", { moderation_attempt_count: 1, moderation_started_at: "infinity" }],
  ["a missing start for an already attempted job", { moderation_attempt_count: 1, moderation_started_at: null }],
]) test(`a stale cron selection cannot replace ${name}`, async () => {
  await patchWorker(db, values); const expected = await workerSnapshot(db);
  const h = videoWorkerHarness(db);
  await captureWorker(h.retry());
  assert.equal(h.providers.length, 0); assert.equal(h.watermarks.length, 0);
  assert.deepEqual(await workerSnapshot(db), expected);
});

test("an interrupted final attempt stays private for retry without another provider call and supports admin recovery", async () => {
  await patchWorker(db, { moderation_attempt_count: 3, moderation_started_at: new Date(workerInstant - 3600000).toISOString(), moderation_details: { workerId: foreignWorker } });
  const h = videoWorkerHarness(db);
  assert.equal((await h.retry()).status, "submitted");
  const row = (await workerSnapshot(db)).row;
  assert.equal(row.moderation_decision, "review");
  assert.deepEqual(row.moderation_reason_codes, ["video_moderation_attempts_exhausted"]);
  assert.equal(row.moderation_attempt_count, 3);
  assert.equal(row.published_at, null);
  assert.equal(h.providers.length, 0);
  assert.equal(h.watermarks.length, 0);
  assert.equal((await h.retrySubmitted()).status, "submitted");
  assert.equal((await workerSnapshot(db)).row.moderation_attempt_count, 4);
});

test("two recovery workers cannot both transition the same exhausted attempt", async () => {
  await patchWorker(db, { moderation_attempt_count: 4, moderation_started_at: new Date(workerInstant - 3600000).toISOString(), moderation_details: { workerId: foreignWorker } });
  const h = videoWorkerHarness(db, { synchronizeInitialReads: 2 });
  const results = await Promise.all([h.retry(), h.retry()]);
  assert.equal(results.filter(result => result?.status === "submitted").length, 1);
  assert.equal(results.filter(result => result === null).length, 1);
  assert.equal(h.providers.length, 0);
});

for (const outcome of ["prepared", "preparation failure"]) {
  test(`an older ${outcome} cannot replace a newer active worker`, async () => {
    const h = videoWorkerHarness(db, { holdPreparations: true });
    const older = captureWorker(h.retry()); let newer;
    try {
      await h.waitFor(({ preparationCount }) => preparationCount === 1);
      h.advance(360001);
      newer = captureWorker(h.retry());
      await h.waitFor(({ preparationCount }) => preparationCount === 2);
      const expected = await workerSnapshot(db);
      h.finish(0, outcome === "preparation failure" ? new Error("Synthetic private provider failure") : workerDecision(outcome));
      const result = await older;
      assert.equal(result.error?.status, 409);
      assert.deepEqual(await workerSnapshot(db), expected);
      assert.equal(h.watermarks.length, 2);
      h.finish(1);
      assert.equal((await newer).value?.status, "submitted");
    } finally { h.releaseAll(); await Promise.all([older, newer].filter(Boolean)); }
  });
}

for (const [name, values] of [
  ["human approval", { status: "approved", moderation_decision: "approved" }],
  ["human rejection", { status: "rejected", moderation_decision: "rejected" }],
  ["removal", { status: "hidden" }],
  ["expiry", { status: "expired" }],
  ["human review", { status: "submitted", moderation_decision: "review" }],
  ["a changed caption", { caption: "A newer synthetic caption" }],
  ["a changed source", { storage_path: "synthetic/changed-source.mp4" }],
  ["a changed source type", { storage_mime: "video/webm" }],
  ["a changed duration", { duration_seconds: 11 }],
  ["a changed width", { width: 800 }],
  ["a changed height", { height: 1300 }],
  ["a changed submitter", { submitted_by: "a1400000-0000-4000-8000-000000000002" }],
]) test(`file preparation respects ${name} before marking the upload ready`, async () => {
  const h = videoWorkerHarness(db, { holdPreparations: true });
  const job = captureWorker(h.retry());
  try {
    await h.waitFor(({ preparationCount }) => preparationCount === 1);
    await patchWorker(db, values); const expected = await workerSnapshot(db);
    h.finish(0);
    assert.equal((await job).error?.status, 409);
    assert.equal(h.watermarks.length, 1);
    assert.deepEqual(await workerSnapshot(db), expected);
  } finally { h.releaseAll(); await job; }
});

test("upload processing prepares private video files and approval does not encode again", async () => {
  const h = videoWorkerHarness(db);
  assert.equal((await h.retry()).status, "submitted");
  assert.equal(h.watermarks.length, 1);
  const { row } = await workerSnapshot(db);
  assert.equal(row.moderation_details.preparedPublication.storagePath, row.storage_path);
  assert.equal(row.published_at, null);
  assert.equal(row.reviewed_at, null);
  assert.equal(row.reviewed_by, null);
  await patchWorker(db, { club_reviewed_at: new Date(workerInstant).toISOString(), club_reviewed_by: workerUserId });
  assert.equal((await h.review()).status, "approved");
  assert.equal(h.watermarks.length, 1);
});

test("a superseded worker cannot mark its prepared files ready for approval", async () => {
  const h = videoWorkerHarness(db, { beforeWatermarkReturns: () => patchWorker(db, { status: "hidden" }) });
  await assert.rejects(h.retry(), /review changed/);
  const { row } = await workerSnapshot(db);
  assert.equal(row.status, "hidden");
  assert.equal(row.moderation_details.preparedPublication, undefined);
  assert.equal(row.published_at, null);
});

test("changed video dimensions invalidate a preparation receipt", async () => {
  const h = videoWorkerHarness(db);
  await h.retry();
  await patchWorker(db, { width: 800, club_reviewed_at: new Date(workerInstant).toISOString(), club_reviewed_by: workerUserId });
  await h.review();
  assert.equal(h.watermarks.length, 2);
});

for (const [name, receipt] of [
  ["missing worker", row => ({ ...row, moderation_details: {} })],
  ["foreign worker", row => ({ ...row, moderation_details: { workerId: foreignWorker } })],
  ["invalid worker", row => ({ ...row, moderation_details: { workerId: "synthetic-invalid" } })],
  ["foreign video", row => ({ ...row, id: foreignWorker })],
  ["wrong attempt", row => ({ ...row, moderation_attempt_count: 0 })],
  ["missing version", row => ({ ...row, updated_at: null })],
  ["wrong start", row => ({ ...row, moderation_started_at: new Date(workerInstant - 1).toISOString() })],
  ["missing caption", row => ({ ...row, caption: null })],
  ["missing media type", row => ({ ...row, storage_mime: null })],
  ["invalid dimensions", row => ({ ...row, width: "unconfirmed" })],
]) test(`a ${name} claim receipt cannot start file preparation or compensate a committed claim`, async () => {
  const h = videoWorkerHarness(db, { claimReceipt: receipt });
  const result = await captureWorker(h.retry());
  assert.equal(result.error?.status, 503);
  assert.equal(h.providers.length, 0); assert.equal(h.watermarks.length, 0);
  assert.equal(h.calls.filter(call => call.kind === "claim").length, 1);
  assert.equal(h.calls.filter(call => call.kind === "result").length, 0);
  const { row } = await workerSnapshot(db);
  assert.equal(row.status, "moderating"); assert.equal(row.moderation_attempt_count, 1);
});

test("an uncertain claim response is never replayed", async () => {
  const error = { code: "SUPABASE_UNAVAILABLE", message: "Synthetic lost response" };
  const expected = await workerSnapshot(db);
  const h = videoWorkerHarness(db, { writeError: error });
  assert.equal((await captureWorker(h.retry())).error, error);
  assert.equal(h.providers.length, 0); assert.equal(h.calls.filter(call => call.kind === "claim").length, 1);
  assert.deepEqual(await workerSnapshot(db), expected);
});

test("file preparation queues human review exactly once without AI", async () => {
  const h = videoWorkerHarness(db);
  const result = await h.retry();
  assert.equal(result.status, "submitted");
  assert.equal(h.providers.length, 0);
  assert.equal(h.calls.filter(call => call.kind === "result").length, 1);
  assert.equal((await workerSnapshot(db)).row.moderation_decision, "review");
  assert.equal((await workerSnapshot(db)).row.moderation_details.fileChecksPassed, true);
});

test("a current preparation failure stays private for retry", async () => {
  const h = videoWorkerHarness(db, { preparationError: new Error("Synthetic provider failure") });
  assert.equal((await h.retry()).status, "submitted");
  assert.equal(h.providers.length, 0);
  assert.equal((await workerSnapshot(db)).row.moderation_decision, "review");
});

test("queued submission leaves one claimable job for the post-response worker", async () => {
  await patchWorker(db, { status: "uploading" });
  const h = videoWorkerHarness(db);
  assert.equal((await h.submit(true)).status, "moderating");
  assert.equal(h.providers.length, 0);
  assert.equal((await workerSnapshot(db)).row.moderation_attempt_count, 0);
  assert.equal((await h.retry()).status, "submitted");
  assert.equal(h.providers.length, 0);
});

for (const [name, receipt] of [
  ["foreign video", row => ({ ...row, id: foreignWorker })],
  ["missing version", row => ({ ...row, updated_at: null })],
]) test(`queued submission cannot acknowledge a ${name} receipt`, async () => {
  await patchWorker(db, { status: "uploading" });
  const h = videoWorkerHarness(db, { claimReceipt: receipt });
  assert.equal((await captureWorker(h.submit(true))).error?.status, 503);
  assert.equal(h.providers.length, 0); assert.equal(h.watermarks.length, 0);
  const { row } = await workerSnapshot(db);
  assert.equal(row.status, "moderating"); assert.equal(row.moderation_attempt_count, 0);
  assert.equal(h.calls.filter(call => call.kind === "claim").length, 1);
});

test("inline submission receives the same worker ownership boundary", async () => {
  await patchWorker(db, { status: "uploading" });
  const h = videoWorkerHarness(db, { holdPreparations: true });
  const job = captureWorker(h.submit());
  try {
    await h.waitFor(({ preparationCount }) => preparationCount === 1);
    await patchWorker(db, { moderation_attempt_count: 2, moderation_details: { workerId: foreignWorker } });
    const expected = await workerSnapshot(db); h.finish(0);
    assert.equal((await job).error?.status, 409);
    assert.deepEqual(await workerSnapshot(db), expected);
    assert.equal(h.watermarks.length, 1);
  } finally { h.releaseAll(); await job; }
});

test("an administrator retry receives a fresh worker and preserves explicit retry permission", async () => {
  await patchWorker(db, { status: "submitted", moderation_attempt_count: 3, moderation_reason_codes: ["video_moderation_provider_error"] });
  const h = videoWorkerHarness(db);
  assert.equal((await h.retrySubmitted()).status, "submitted");
  assert.equal((await workerSnapshot(db)).row.moderation_attempt_count, 4);
  assert.equal(h.providers.length, 0);
});

test("legacy demo configuration cannot bypass club and staff approval for inline uploads", async () => {
  await patchWorker(db, { status: "uploading" });
  const h = videoWorkerHarness(db, { demo: true });
  assert.equal((await h.submit()).status, "submitted");
  assert.equal(h.providers.length, 0);
  assert.equal(h.watermarks.length, 1);
  assert.equal((await workerSnapshot(db)).row.published_at, null);
});

for (const demo of [false, true]) test(`preparation failure keeps ${demo ? "legacy demo" : "standard"} uploads private and retryable`, async () => {
  const h = videoWorkerHarness(db, { demo, beforeWatermarkReturns() { throw new Error("Synthetic media failure"); } });
  assert.equal((await h.retry()).status, "submitted");
  await assert.rejects(h.review(), /Club approval|file preparation/);
  const { row } = await workerSnapshot(db);
  assert.equal(row.status, "submitted");
  assert.equal(row.moderation_decision, "review");
  assert.deepEqual(row.moderation_reason_codes, ["public_watermark_processing_failed"]);
  assert.equal(row.published_at, null);
});

test("owners cannot restart a file waiting for club or final staff approval", async () => {
  const h = videoWorkerHarness(db);
  await h.retry(); h.advance(600_000);
  await assert.rejects(h.retryOwn(), /no longer waiting/);
  await patchWorker(db, { club_reviewed_at: new Date(workerInstant).toISOString(), club_reviewed_by: workerUserId });
  const before = await workerSnapshot(db);
  await assert.rejects(h.retryOwn(), /no longer waiting/);
  assert.deepEqual(await workerSnapshot(db), before);
});
