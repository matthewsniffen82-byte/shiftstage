import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const script = fs.readFileSync("public/profile-photo-crop.js", "utf8");
const scope = { window: {} };
vm.runInNewContext(script, scope);
const { cropRect } = scope.window.DancrPhotoCrop;
const live = fs.readFileSync("outputs/index.html", "utf8");
const dashboard = fs.readFileSync("app/dashboard/DashboardClient.tsx", "utf8");
const preview = fs.readFileSync("app/api/dancer/photos/preview/route.ts", "utf8");

test("crop coordinates preserve the card ratio without blank edges for every source shape", () => {
  for (const [w, h] of [[900, 2100], [1200, 1600], [800, 800], [2400, 500], [500, 2400]]) {
    for (const ratio of [.4, .5625, .7, 1.2]) for (const zoom of [1, 1.4, 3]) {
      for (const x of [0, .5, 1]) for (const y of [0, .5, 1]) {
        const r = cropRect(w, h, ratio, zoom, x, y);
        assert.ok(r.x >= 0 && r.y >= 0);
        assert.ok(r.x + r.width <= w + .00001 && r.y + r.height <= h + .00001);
        assert.ok(Math.abs(r.width / r.height - ratio) < .00001);
      }
    }
  }
});

test("crop zoom and pan are bounded and invalid dimensions are rejected", () => {
  assert.deepEqual({ ...cropRect(1000, 2000, .5, 0, -1, 2) }, { x: 0, y: 0, width: 1000, height: 2000 });
  assert.deepEqual({ ...cropRect(1000, 2000, .5, 9, -1, 2) }, { ...cropRect(1000, 2000, .5, 3, 0, 1) });
  for (const args of [[0, 1000, .5, 1, .5, .5], [1000, 1000, NaN, 1, .5, .5], [Infinity, 1000, .5, 1, .5, .5]]) assert.throws(() => cropRect(...args));
});

test("crop preview measures the existing TV card CSS instead of inventing another ratio", () => {
  assert.match(script, /profile-media-card-feed/);
  assert.match(script, /height:var\(--profile-media-card-height\);width:calc\(100% - 10px\)/);
  assert.match(script, /return rect\.width \/ rect\.height/);
  assert.match(live, /profile-photo-crop\.js\?v=1/);
  assert.match(fs.readFileSync("app/layout.tsx", "utf8"), /versionedStaticAssetUrl\("\/profile-photo-crop\.js"\)/);
});

test("crop is confirmed before the dashboard sends the actual moderated photo", () => {
  const batch = dashboard.split("  async function uploadPhotoBatch(")[1].split("  async function pinPhoto(")[0];
  assert.ok(batch.indexOf("await cropProfilePhoto(item.file, controller.signal)") < batch.indexOf("persistQueuedPhotoDeletions(controller.signal)"));
  assert.ok(batch.indexOf("await cropProfilePhoto(item.file, controller.signal)") < batch.indexOf('formData.set("file", item.file)'));
  assert.match(batch, /item = \{ \.\.\.item, file: cropped, previewUrl \}/);
  assert.match(batch, /if \(!cropped\) \{[^]*?batch\.slice\(index\)[^]*?break;/);
  assert.match(batch, /const uploadKey = `\$\{item\.id\}:gallery`/);
});

test("legacy onboarding and replacement uploads share the same crop gate", () => {
  const upload = live.split("    async function uploadApprovedDancerPhoto(")[1].split("\n    }")[0];
  assert.ok(upload.indexOf("file = await cropApprovedProfilePhoto(file)") < upload.indexOf("persistQueuedApprovedPhotoDeletionsBeforeUpload"));
  assert.match(upload, /uploadSetupPhotoFile\(file, isPrimary, sortOrder/);
  assert.match(live, /if \(reason\?\.name === "AbortError"\) \{[^]*?while \(uploadAttempts\.length < photoFiles\.length\)/);
});

test("preview authenticates and verifies ownership before decoding untrusted bytes", () => {
  assert.ok(preview.indexOf("createRequestSupabaseContext(request)") < preview.indexOf("readBoundedFormData(request"));
  assert.ok(preview.indexOf('.eq("user_id", user.id)') < preview.indexOf("validateAndPrepareDancrImage(file)"));
  assert.match(preview, /enforcePublicRequestRateLimit/);
  assert.match(preview, /subject: user\.id/);
  assert.match(preview, /MAX_DANCR_RAW_UPLOAD_BYTES \+ 64 \* 1024/);
  assert.match(preview, /private, no-store/);
  assert.match(preview, /nosniff/);
  assert.doesNotMatch(preview, /\.storage|\.upload\(|\.insert\(|\.update\(/);
});

test("confirmed crops are reused on retries and cancellation cleans up preview work", () => {
  assert.match(script, /confirmed\.set\(file, cropped\)/);
  assert.match(script, /confirmed\.set\(cropped, cropped\)/);
  assert.match(script, /controller\.abort\(\)/);
  assert.match(script, /removeEventListener\("abort", abort\)/);
  assert.match(script, /dialog\.remove\(\)/);
  assert.match(script, /canvas\.width = canvas\.height = 0/);
  assert.match(script, /if \(settled\) return/);
  assert.match(script, /dialog\.showModal\(\)/);
  assert.match(script, /ArrowLeft.*ArrowRight.*ArrowUp.*ArrowDown/);
});
