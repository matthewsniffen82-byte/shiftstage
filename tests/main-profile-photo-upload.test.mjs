import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync("app/dashboard/main-profile-photo-upload.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ decision = "approved", canceled = false, refreshFails = false, cropWait = false, uploadFails = false } = {}) {
  let session = { account: { id: "dancer-a", role: "dancer" }, accessToken: "token-a" };
  const listeners = new Set(), requests = [], controller = new AbortController();
  const original = new File(["original"], "portrait.jpg", { type: "image/jpeg" });
  const cropped = new File(["cropped"], "crop.jpg", { type: "image/jpeg" });
  let confirm, validate, cropSignal;
  const scope = { exports: {}, AbortController, DOMException, FormData,
    window: { addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) },
    require: name => name === "./profile-photo-crop" ? {
      cropProfilePhoto: async (file, signal, check, ratio) => {
        assert.equal(ratio, 3 / 4);
        assert.equal(file, original); validate = check; cropSignal = signal;
        if (cropWait) await new Promise(resolve => { confirm = resolve; });
        check();
        return canceled ? null : cropped;
      },
    } : {
      DASHBOARD_SESSION_KEY: "session", readSession: () => session,
      requestDancerPhotosJson: async options => { requests.push(options); if (uploadFails) throw new Error("Network unavailable"); return { decision }; },
      requestDancerProfileJson: async () => { if (refreshFails) throw new Error("Refresh failed"); return { profile: { id: "profile-a" } }; },
    },
  };
  vm.runInNewContext(code, scope);
  return { requests, listeners, controller, original, cropped,
    start: (replacementPhotoId = "photo-a") => scope.exports.uploadMainProfilePhoto(original, { signal: controller.signal, uploadKey: "stable-key", replacementPhotoId }),
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
