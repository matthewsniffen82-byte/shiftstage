import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import {
  createWorkerDatabase, seedWorker, patchWorker, workerSnapshot, videoWorkerHarness,
  workerDecision, captureWorker, workerInstant,
} from "./helpers/video-worker-database.mjs";

let db;
before(async () => { db = await createWorkerDatabase(); });
beforeEach(async () => { await seedWorker(db); });
after(async () => { await db?.close(); });
const foreignWorker = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

test("two queued workers race through native compare-and-set but only one starts a provider", async () => {
  const h = videoWorkerHarness(db, { holdProviders: true, synchronizeInitialReads: 2 });
  const jobs = [captureWorker(h.retry()), captureWorker(h.retry())];
  let outcomes;
  try {
    await h.waitFor(({ claimAttempts }) => claimAttempts === 2);
    assert.equal(h.providers.length, 1);
  } finally { h.releaseAll(); outcomes = await Promise.all(jobs); }
  assert.equal(outcomes.filter(outcome => outcome.value === null).length, 1);
  assert.equal(outcomes.filter(outcome => outcome.value?.status === "approved").length, 1);
  assert.equal((await workerSnapshot(db)).row.moderation_attempt_count, 1);
});

for (const [name, values] of [
  ["an active worker", { moderation_attempt_count: 1, moderation_details: { workerId: foreignWorker } }],
  ["the automatic attempt ceiling", { moderation_attempt_count: 3, moderation_started_at: new Date(workerInstant - 3600000).toISOString() }],
  ["an unbounded start timestamp", { moderation_attempt_count: 1, moderation_started_at: "infinity" }],
  ["a missing start for an already attempted job", { moderation_attempt_count: 1, moderation_started_at: null }],
]) test(`a stale cron selection cannot replace ${name}`, async () => {
  await patchWorker(db, values); const expected = await workerSnapshot(db);
  const h = videoWorkerHarness(db);
  await captureWorker(h.retry());
  assert.equal(h.providers.length, 0); assert.equal(h.watermarks.length, 0);
  assert.deepEqual(await workerSnapshot(db), expected);
});

for (const outcome of ["approved", "review", "rejected", "provider failure"]) {
  test(`an older ${outcome} cannot replace a newer active worker`, async () => {
    const h = videoWorkerHarness(db, { holdProviders: true });
    const older = captureWorker(h.retry()); let newer;
    try {
      await h.waitFor(({ providerCount }) => providerCount === 1);
      h.advance(360001);
      newer = captureWorker(h.retry());
      await h.waitFor(({ providerCount }) => providerCount === 2);
      const expected = await workerSnapshot(db);
      h.finish(0, outcome === "provider failure" ? new Error("Synthetic private provider failure") : workerDecision(outcome));
      const result = await older;
      assert.equal(result.error?.status, 409);
      assert.deepEqual(await workerSnapshot(db), expected);
      assert.equal(h.watermarks.length, 0);
      h.finish(1);
      assert.equal((await newer).value?.status, "approved");
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
]) test(`a provider result respects ${name} before starting watermark work`, async () => {
  const h = videoWorkerHarness(db, { holdProviders: true });
  const job = captureWorker(h.retry());
  try {
    await h.waitFor(({ providerCount }) => providerCount === 1);
    await patchWorker(db, values); const expected = await workerSnapshot(db);
    h.finish(0);
    assert.equal((await job).error?.status, 409);
    assert.equal(h.watermarks.length, 0);
    assert.deepEqual(await workerSnapshot(db), expected);
  } finally { h.releaseAll(); await job; }
});

test("losing ownership during watermark processing cannot publish its late result", async () => {
  let expected;
  const h = videoWorkerHarness(db, { async beforeWatermarkReturns() {
    await patchWorker(db, { moderation_attempt_count: 2, moderation_details: { workerId: foreignWorker } });
    expected = await workerSnapshot(db);
  } });
  assert.equal((await captureWorker(h.retry())).error?.status, 409);
  assert.equal(h.watermarks.length, 1);
  assert.deepEqual(await workerSnapshot(db), expected);
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
]) test(`a ${name} claim receipt cannot start provider work or compensate a committed claim`, async () => {
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

for (const decision of ["approved", "review", "rejected"]) test(`the current worker can persist ${decision} exactly once`, async () => {
  const h = videoWorkerHarness(db, { decision });
  const result = await h.retry();
  assert.equal(result.status, decision === "review" ? "submitted" : decision);
  assert.equal(h.providers.length, 1);
  assert.equal(h.calls.filter(call => call.kind === "result").length, 1);
  assert.equal((await workerSnapshot(db)).row.moderation_decision, decision);
});

test("a current provider failure becomes human review without replaying the provider", async () => {
  const h = videoWorkerHarness(db, { providerError: new Error("Synthetic provider failure") });
  assert.equal((await h.retry()).status, "submitted");
  assert.equal(h.providers.length, 1);
  assert.equal((await workerSnapshot(db)).row.moderation_decision, "review");
});

test("queued submission leaves one claimable job for the post-response worker", async () => {
  await patchWorker(db, { status: "uploading" });
  const h = videoWorkerHarness(db);
  assert.equal((await h.submit(true)).status, "moderating");
  assert.equal(h.providers.length, 0);
  assert.equal((await workerSnapshot(db)).row.moderation_attempt_count, 0);
  assert.equal((await h.retry()).status, "approved");
  assert.equal(h.providers.length, 1);
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
  const h = videoWorkerHarness(db, { holdProviders: true });
  const job = captureWorker(h.submit());
  try {
    await h.waitFor(({ providerCount }) => providerCount === 1);
    await patchWorker(db, { moderation_attempt_count: 2, moderation_details: { workerId: foreignWorker } });
    const expected = await workerSnapshot(db); h.finish(0);
    assert.equal((await job).error?.status, 409);
    assert.deepEqual(await workerSnapshot(db), expected);
    assert.equal(h.watermarks.length, 0);
  } finally { h.releaseAll(); await job; }
});

test("an administrator retry receives a fresh worker and preserves explicit retry permission", async () => {
  await patchWorker(db, { status: "submitted", moderation_attempt_count: 3, moderation_reason_codes: ["video_moderation_provider_error"] });
  const h = videoWorkerHarness(db);
  assert.equal((await h.retrySubmitted()).status, "approved");
  assert.equal((await workerSnapshot(db)).row.moderation_attempt_count, 4);
  assert.equal(h.providers.length, 1);
});

for (const source of ["inline", "pending"]) test(`demo ${source} publication also rejects a replaced worker`, async () => {
  await patchWorker(db, { status: source === "inline" ? "uploading" : "submitted" });
  let expected;
  const h = videoWorkerHarness(db, { demo: true, async beforeWatermarkReturns() {
    await patchWorker(db, { moderation_attempt_count: 2, moderation_details: { workerId: foreignWorker } });
    expected = await workerSnapshot(db);
  } });
  const result = await captureWorker(source === "inline" ? h.submit() : h.demoPending());
  assert.equal(result.error?.status, 409); assert.equal(h.providers.length, 0);
  assert.deepEqual(await workerSnapshot(db), expected);
});

for (const source of ["inline", "pending"]) test(`the current demo ${source} worker can publish its own result`, async () => {
  await patchWorker(db, { status: source === "inline" ? "uploading" : "submitted" });
  const h = videoWorkerHarness(db, { demo: true });
  assert.equal((await (source === "inline" ? h.submit() : h.demoPending())).status, "approved");
  assert.equal(h.providers.length, 0); assert.equal(h.watermarks.length, 1);
  assert.equal((await workerSnapshot(db)).row.moderation_attempt_count, 1);
});

for (const demo of [false, true]) test(`a current ${demo ? "demo" : "AI"} worker preserves its watermark failure policy`, async () => {
  const h = videoWorkerHarness(db, { demo, beforeWatermarkReturns() { throw new Error("Synthetic media failure"); } });
  assert.equal((await h.retry()).status, demo ? "approved" : "submitted");
  const { row } = await workerSnapshot(db);
  assert.ok(row.moderation_reason_codes.includes(demo ? "demo_watermark_processing_failed" : "public_watermark_processing_failed"));
});
