import assert from "node:assert/strict";
import test from "node:test";
import { videoUploadHarness, videoId, videoInput, storagePath, userId } from "./helpers/video-upload-acknowledgment-fixture.mjs";
test("video reservation identity is acknowledged before signing its upload", async () => {
  const h = videoUploadHarness(), result = await h.run();
  assert.equal(result.videoId, videoId); assert.equal(result.path, storagePath);
  assert.deepEqual(h.calls, ["insert", "sign"]);
});
for (const options of [{ signError: { status: 503 } }, { signedResponse: null }, { signedResponse: { token: "" } }, { signedResponse: { token: " " } }, { signedResponse: { token: 42 } }, { signedResponse: { token: "synthetic", path: "other-owner/video.mp4" } }]) {
  test("unconfirmed signing retains the reservation for an explicit retry: " + JSON.stringify(options), async () => {
    const h = videoUploadHarness({ ...options });
    await assert.rejects(h.run());
    assert.equal(h.rows.get(videoId).status, "uploading");
    assert.equal(h.calls.includes("delete"), false);
    delete h.options.signError; delete h.options.signedResponse;
    const resumed = await h.run();
    assert.equal(resumed.videoId, videoId);
    assert.equal(h.calls.filter(c => c === "insert").length, 1);
  });
}
test("a thrown signing failure also retains the pending upload", async () => {
  const h = videoUploadHarness({ signThrow: new TypeError("Synthetic network failure") });
  await assert.rejects(h.run()); assert.equal(h.rows.size, 1); assert.equal(h.calls.includes("delete"), false);
});
test("a lost committed insert response resumes the same record without duplicate insertion", async () => {
  const h = videoUploadHarness({ afterInsertError: { code: "08006" } });
  await assert.rejects(h.run()); assert.deepEqual(h.calls, ["insert"]);
  delete h.options.afterInsertError;
  assert.equal((await h.run()).videoId, videoId);
  assert.equal(h.rows.size, 1); assert.equal(h.calls.filter(c => c === "insert").length, 1);
});
for (const insertResponse of [null, { id: "other", storage_path: storagePath }, { id: videoId, storage_path: "other-owner/video.mp4" }]) {
  test("an invalid insert acknowledgment cannot authorize upload: " + JSON.stringify(insertResponse), async () => {
    const h = videoUploadHarness({ insertResponse });
    await assert.rejects(h.run()); assert.deepEqual(h.calls, ["insert"]); assert.equal(h.rows.size, 1);
  });
}
for (const listResponse of [null, {}]) {
  test("an unconfirmed resume listing does not start another upload: " + JSON.stringify(listResponse), async () => {
    const h = videoUploadHarness(); await h.run(); h.calls.length = 0;
    h.options.listResponse = listResponse;
    await assert.rejects(h.run()); assert.deepEqual(h.calls, ["list"]); assert.equal(h.rows.size, 1);
  });
}
test("a Storage list error preserves pending state", async () => {
  const h = videoUploadHarness(); await h.run(); h.calls.length = 0;
  h.options.listError = { status: 503 };
  await assert.rejects(h.run()); assert.deepEqual(h.calls, ["list"]); assert.equal(h.rows.size, 1);
});
test("a matching uploaded object resumes without obtaining another token", async () => {
  const h = videoUploadHarness(); await h.run(); h.calls.length = 0;
  h.options.listResponse = [{ name: videoId + ".mp4", metadata: { size: 1024, mimetype: "video/mp4" } }];
  const result = await h.run(); assert.equal(result.uploadComplete, true);
  assert.equal(result.alreadySubmitted, false); assert.deepEqual(h.calls, ["list"]);
});
test("an already submitted concurrent upload survives an older signing failure", async () => {
  const h = videoUploadHarness({ signError: { status: 503 }, beforeSign: rows => { rows.get(videoId).status = "approved"; } });
  await assert.rejects(h.run()); assert.equal(h.rows.get(videoId).status, "approved");
  h.calls.length = 0;
  assert.equal((await h.run()).alreadySubmitted, true); assert.deepEqual(h.calls, []);
});
test("retrying a retained reservation with different media does not overwrite it", async () => {
  const h = videoUploadHarness(); await h.run(); h.calls.length = 0;
  await assert.rejects(h.run({ ...videoInput, fileSize: 2048 }));
  assert.deepEqual(h.calls, []); assert.equal(h.rows.get(videoId).file_size_bytes, 1024);
});
test("another owner cannot resume or replace the reserved upload identity", async () => {
  const h = videoUploadHarness(); await h.run();
  await assert.rejects(h.run(videoInput, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"));
  assert.equal(h.rows.get(videoId).submitted_by, userId);
  assert.equal(h.calls.filter(c => c === "sign").length, 1);
});
test("an unusable signed response on resume leaves the reservation unchanged", async () => {
  const h = videoUploadHarness(); await h.run();
  h.options.signedResponse = { token: "synthetic", path: "other/video.mp4" };
  await assert.rejects(h.run()); assert.equal(h.rows.get(videoId).storage_path, storagePath);
});
test("the dancer route reports a safe transient failure and retains the retry identity", async () => {
  const h = videoUploadHarness({ signError: { status: 503, message: "synthetic private storage detail" } });
  const result = await h.post(); assert.equal(result.status, 503);
  assert.doesNotMatch(await result.text(), /synthetic private/);
  assert.equal(h.rows.get(videoId).status, "uploading");
});
