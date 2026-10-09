import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync("app/dashboard/main-profile-photo-upload.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ decision = "approved", canceled = false, refreshFails = false, cropWait = false, uploadFails = false, saved = false, isPrimary = true, makeMain = false, pendingReviewId, photoSlot, deleteFails = false, switchAfterUpload = false } = {}) {
  let session = { account: { id: "dancer-a", role: "dancer" }, accessToken: "token-a" };
  const listeners = new Set(), requests = [], controller = new AbortController();
  const original = new File(["original"], "portrait.jpg", { type: "image/jpeg" });
  const source = { id: "photo-a", isPrimary, sortOrder: isPrimary ? 0 : 3 };
  const previews = [], cropFiles = [];
  const cropped = new File(["cropped"], "crop.jpg", { type: "image/jpeg" });
  let confirm, validate, cropSignal;
  const scope = { exports: {}, AbortController, DOMException, FormData, File, atob, Uint8Array,
    window: { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) },
    require: name => name === "./profile-photo-crop" ? {
      cropProfilePhoto: async (file, signal, check, ratio) => {
        assert.equal(ratio, 3 / 4);
        if (saved) assert.equal(await file.text(), "saved-original"); else assert.equal(file, original);
        cropFiles.push(file); validate = check; cropSignal = signal;
        if (cropWait) await new Promise(resolve => { confirm = resolve; });
        check();
        return canceled ? null : cropped;
      },
    } : {
      DASHBOARD_SESSION_KEY: "session", readSession: () => session,
      requestDashboardJson: async (url, options) => { assert.equal(url, "/api/dancer/photos/preview"); previews.push(options.body.get("photoId")); return { imageDataUrl: "data:image/jpeg;base64," + btoa("saved-original") }; },
      requestDancerPhotosJson: async options => {
        requests.push(options);
        if (options.method === 'DELETE') { if (deleteFails) throw new Error('Review already approved'); return { photo: { deletedIds: [JSON.parse(options.body).photoId] } }; }
        if (uploadFails) throw new Error("Network unavailable");
        if (switchAfterUpload) session = { account: { id: 'dancer-b', role: 'dancer' }, accessToken: 'other' };
        return { decision, moderationRecordId: 'new-review' };
      },
      requestDancerProfileJson: async () => { if (refreshFails) throw new Error("Refresh failed"); return { profile: { id: "profile-a" } }; },
    },
  };
  vm.runInNewContext(code, scope);
  return { requests, previews, cropFiles, listeners, controller, original, cropped,
    start: (replacementPhotoId = "photo-a") => scope.exports.uploadMainProfilePhoto(saved ? source : original, { signal: controller.signal, uploadKey: "stable-key", replacementPhotoId, makeMain, pendingReviewId, photoSlot }),
    confirm: () => confirm(),
    validate: () => validate(),
    change: (id, dispatch = true) => { session = { account: { id, role: "dancer" }, accessToken: "new-token" }; if (dispatch) listeners.forEach(fn => fn({ key: "session" })); },
    get cropSignal() { return cropSignal; },
  };
}

test("main photo replacement uploads the confirmed crop with a stable key and the selected photo identity", async () => {
  const f = fixture(), result = await f.start();
  assert.equal(result.decision, "approved"); assert.equal(result.profile.id, "profile-a");
  const request = f.requests[0];
  assert.equal(await request.body.get("file").text(), "cropped");
  assert.equal(request.body.get("isPrimary"), "true");
  assert.equal(request.body.get("sortOrder"), "0");
  assert.equal(request.body.get("replaceExisting"), "true");
  assert.equal(request.body.get("replacementPhotoId"), "photo-a");
  assert.equal(request.headers["idempotency-key"], request.body.get("idempotencyKey"));
  assert.equal(f.listeners.size, 0);
});

test("a first main photo is added without replacing a gallery photo or avatar", async () => {
  const f = fixture(); await f.start("");
  assert.equal(f.requests[0].body.get("replaceExisting"), "false");
  assert.equal(f.requests[0].body.has("replacementPhotoId"), false);
});

test("canceling a crop writes nothing", async () => {
  const f = fixture({ canceled: true }); assert.equal(await f.start(), null);
  assert.equal(f.requests.length, 0); assert.equal(f.listeners.size, 0);
});

for (const decision of ["approved", "review", "moderation_retry", "rejected"]) {
  test(`${decision} remains acknowledged when the profile refresh fails`, async () => {
    const f = fixture({ decision, refreshFails: true }), result = await f.start();
    assert.equal(result.decision, decision); assert.equal(result.refreshFailed, true);
    assert.equal(result.profile, null); assert.equal(f.requests.length, 1);
  });
}

test("retrying an uncertain upload retains its idempotency key", async () => {
  const f = fixture({ uploadFails: true });
  await assert.rejects(f.start(), /Network unavailable/); await assert.rejects(f.start(), /Network unavailable/);
  assert.deepEqual(f.requests.map(r => r.headers["idempotency-key"]), ["stable-key", "stable-key"]);
});

for (const dispatch of [true, false]) test(`account changes cannot upload the original dancer's crop (${dispatch ? "with" : "before"} storage event)`, async () => {
  const f = fixture({ cropWait: true }), pending = f.start();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  f.change("dancer-b", dispatch); assert.throws(f.validate, { name: "AbortError" }); f.confirm(); await rejected;
  assert.equal(f.requests.length, 0); assert.equal(f.listeners.size, 0);
});

test("closing the uploader aborts preparation and cannot publish a crop", async () => {
  const f = fixture({ cropWait: true }), pending = f.start();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  f.controller.abort(); assert.equal(f.cropSignal.aborted, true); f.confirm(); await rejected;
  assert.equal(f.requests.length, 0);
});

test("token refresh for the same dancer does not interrupt their upload", async () => {
  const f = fixture({ cropWait: true }), pending = f.start();
  f.change("dancer-a"); f.confirm(); assert.equal((await pending).decision, "approved");
});

for (const isPrimary of [true, false]) test(`reopening a saved ${isPrimary ? "main" : "separate roster"} photo preserves its identity and slot`, async () => {
  const f = fixture({ saved: true, isPrimary }); await f.start();
  assert.deepEqual(f.previews, ["photo-a"]);
  assert.equal(f.requests[0].body.get("replacementPhotoId"), "photo-a");
  assert.equal(f.requests[0].body.get("isPrimary"), String(isPrimary));
  assert.equal(f.requests[0].body.get("sortOrder"), isPrimary ? "0" : "3");
  // A fresh editor after a refresh/relogin reads the persisted source again.
  const returned = fixture({ saved: true, isPrimary }); await returned.start(); assert.deepEqual(returned.previews, ["photo-a"]);
});
test('saved crop cancellation writes nothing and retry retains the same confirmed file and key', async () => {
  const canceled = fixture({ saved: true, canceled: true }); assert.equal(await canceled.start(), null); assert.equal(canceled.requests.length, 0);
  const retry = fixture({ saved: true, uploadFails: true }); await assert.rejects(retry.start()); await assert.rejects(retry.start());
  assert.deepEqual(retry.previews, ['photo-a']); assert.equal(retry.cropFiles[0], retry.cropFiles[1]);
  assert.deepEqual(retry.requests.map(r => r.body.get('idempotencyKey')), ['stable-key','stable-key']);
});
test('a saved photo cannot be published after the dancer changes accounts while cropping', async () => {
  const f = fixture({ saved: true, cropWait: true }), pending = f.start();
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setTimeout(resolve, 0)); f.change('dancer-b'); f.confirm(); await rejected;
  assert.equal(f.requests.length, 0);
});


test("making a gallery image the main photo replaces only the previous main photo", async () => {
  const f = fixture({ saved: true, isPrimary: false, makeMain: true });
  await f.start("previous-main");
  assert.deepEqual(f.previews, ["photo-a"]);
  const body = f.requests[0].body;
  assert.equal(body.get("isPrimary"), "true");
  assert.equal(body.get("sortOrder"), "0");
  assert.equal(body.get("replacementPhotoId"), "previous-main");
  assert.notEqual(body.get("replacementPhotoId"), "photo-a", "gallery source must survive the copy");
});

test("canceling make-main never modifies either photo", async () => {
  const f = fixture({ saved: true, isPrimary: false, makeMain: true, canceled: true });
  await f.start("previous-main");
  assert.equal(f.requests.length, 0);
});

test('pending replacement retires only the old review after acknowledging the new upload', async () => {
  const f = fixture({ decision: 'review', pendingReviewId: 'old-review' });
  const result = await f.start();
  assert.deepEqual(f.requests.map(request => request.method), ['POST', 'DELETE']);
  assert.deepEqual(JSON.parse(f.requests[1].body), { photoId: 'old-review' });
  assert.equal(f.requests[0].body.get('replacementPhotoId'), 'photo-a');
  assert.equal(result.replacementWarning, '');
});

test('cancellation, rejection, failed upload, and changed account retain the old pending photo', async () => {
  for (const options of [{ canceled: true }, { decision: 'rejected' }, { uploadFails: true }, { switchAfterUpload: true }]) {
    const f = fixture({ ...options, pendingReviewId: 'old-review' });
    if (options.uploadFails || options.switchAfterUpload) await assert.rejects(f.start()); else await f.start();
    assert.equal(f.requests.some(request => request.method === 'DELETE'), false);
  }
});

test('a concurrent review decision never triggers a duplicate upload or deletes the approved photo', async () => {
  const f = fixture({ pendingReviewId: 'old-review', deleteFails: true });
  const result = await f.start();
  assert.equal(result.decision, 'approved'); assert.equal(result.profile.id, 'profile-a');
  assert.match(result.replacementWarning, /previous upload could not be removed/);
  assert.deepEqual(f.requests.map(request => request.method), ['POST', 'DELETE']);
});

test('replacing pending extra media preserves its gallery slot', async () => {
  const f = fixture({ pendingReviewId: 'gallery-review', photoSlot: { isPrimary: false, sortOrder: 3 } });
  await f.start('');
  assert.equal(f.requests[0].body.get('isPrimary'), 'false');
  assert.equal(f.requests[0].body.get('sortOrder'), '3');
});
