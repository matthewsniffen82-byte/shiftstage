import assert from "node:assert/strict";
import test from "node:test";
import { videoUploadHarness, videoInput, userId, dancerId } from "./helpers/video-upload-acknowledgment-fixture.mjs";

const profile = { id: dancerId, user_id: userId, stage_name: "Synthetic", city: "Las Vegas", status: "draft" };
const edit = {
  version: 1,
  source: { mimeType: videoInput.mimeType, fileSize: videoInput.fileSize, durationSeconds: 10, width: 720, height: 1280 },
  startSeconds: 0, endSeconds: 10,
  crop: { x: 0, y: 0, width: 720, height: 1280 },
};

for (const [name, options, input, message] of [
  ["missing profile", { profile: null }, videoInput, /Save your stage name and city/],
  ["unsaved city", { profile: { ...profile, city: "" } }, videoInput, /Save your stage name and city/],
  ["unsupported format", {}, { ...videoInput, mimeType: "video/avi" }, /MP4, WebM, or MOV/],
  ["oversized file", {}, { ...videoInput, fileSize: 25 * 1024 * 1024 + 1 }, /25 MB/],
  ["invalid duration", {}, { ...videoInput, durationSeconds: 31 }, /between 1 and 30 seconds/],
  ["invalid dimensions", {}, { ...videoInput, width: 200 }, /at least 240 pixels/],
  ["missing rights", {}, { ...videoInput, rightsConfirmed: false }, /Confirm consent and content rights/],
  ["invalid crop", {}, { ...videoInput, edit: { ...edit, crop: { ...edit.crop, x: 900 } } }, /Choose a vertical or square crop/],
  ["mismatched crop", {}, { ...videoInput, edit: { ...edit, source: { ...edit.source, fileSize: 2048 } } }, /does not match its crop/],
  ["full library", { activeVideoCount: 50 }, videoInput, /library is full/],
]) {
  test(`upload preparation explains ${name} before reserving storage`, async () => {
    const h = videoUploadHarness(options);
    const response = await h.post(input);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.code, "INVALID_REQUEST");
    assert.match(body.error, message);
    assert.deepEqual(h.calls, []);
  });
}

test("saved draft details allow a valid cropped upload before profile publication", async () => {
  const h = videoUploadHarness({ profile });
  const response = await h.post({ ...videoInput, edit });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).ok, true);
  assert.deepEqual(h.calls, ["insert", "sign"]);
});

for (const [changes, message] of [
  [{ status: "rejected" }, /profile needs changes/],
  [{ status: "disabled" }, /profile is disabled/],
  [{ disabled_at: "2026-10-09T00:00:00Z" }, /profile is disabled/],
]) {
  test("restricted profiles receive their status feedback without authorizing uploads: " + JSON.stringify(changes), async () => {
    const h = videoUploadHarness({ profile: { ...profile, ...changes } });
    const response = await h.post();
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.code, "FORBIDDEN");
    assert.match(body.error, message);
    assert.deepEqual(h.calls, []);
  });
}

test("a changed retry reports the conflict without replacing the reserved video", async () => {
  const h = videoUploadHarness();
  await h.run({ ...videoInput, edit });
  h.calls.length = 0;
  const response = await h.post({ ...videoInput, edit: { ...edit, endSeconds: 9 } });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /does not match the original upload/);
  assert.deepEqual(h.calls, []);
  assert.equal(h.rows.size, 1);
});

for (const options of [
  { profileError: new Error("private profile lookup detail") },
  { insertError: { code: "23514", message: "private constraint detail" } },
  { signError: { status: 400, message: "private storage detail" } },
]) {
  test("provider failures remain private in upload feedback: " + Object.keys(options)[0], async () => {
    const response = await videoUploadHarness(options).post();
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "Unable to prepare your MyDancr TV upload." });
  });
}
