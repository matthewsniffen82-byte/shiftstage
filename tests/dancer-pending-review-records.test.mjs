import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { mediaReview } from "./helpers/media-review-label.mjs";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const slot = {};
vm.runInNewContext(compile(read("src/lib/dancr/photo-slot.ts")), { exports: slot });
const route = read("app/api/dancer/profile/route.ts");
const loader = route.slice(route.indexOf("async function loadPendingPhotoReviews"), route.indexOf("async function loadLatestAvatarReview"));

async function pendingReviews(reviews, photos) {
  const signed = [];
  const query = new Proxy({ then: resolve => resolve({ data: reviews }) }, { get: (target, key) => target[key] || (() => query) });
  const context = vm.createContext({
    ...slot, ACTIVE_IMAGE_MODERATION_STATUSES: [], MAX_DANCER_PROFILE_PHOTOS: 30,
    MODERATION_REVIEW_BUCKET: "review", MODERATION_TEMP_BUCKET: "temp",
    createAdminSupabaseClient: () => ({
      from: () => query,
      storage: { from: bucket => ({ createSignedUrl: async path => { signed.push([bucket, path]); return { data: { signedUrl: `/signed/${path}` } }; } }) },
    }),
  });
  vm.runInContext(compile(loader), context);
  return { rows: await context.loadPendingPhotoReviews("owner", photos), signed };
}

test("a stale review linked to the same saved approval cannot downgrade it", async () => {
  for (const link of [{ image_id: "approved-photo" }, { final_storage_path: "approved.webp" }]) {
    const result = await pendingReviews([{ id: "old-review", upload_context: "profile_gallery:1", ...link }], [
      { id: "approved-photo", storage_path: "approved.webp", review_status: "approved", sort_order: 1 },
    ]);
    assert.equal(result.rows.length, 0);
    assert.equal(result.signed.length, 0);
  }
});

test("a distinct pending replacement is not approved just because it shares an approved photo's slot", async () => {
  const result = await pendingReviews([{ id: "new-review", status: "pending_review", upload_context: "profile_gallery:1", temporary_storage_path: "replacement.jpg" }], [
    { id: "approved-photo", review_status: "approved", sort_order: 1 },
  ]);
  assert.equal(result.rows[0].id, "new-review");
  assert.equal(result.rows[0].reviewStatus, "pending");
  assert.equal(result.rows[0].status, "pending_review");
  assert.deepEqual(result.signed, [["review", "replacement.jpg"]]);
});

test("linked pending or rejected photos never count as approval", async () => {
  for (const status of ["pending", "rejected"]) {
    const result = await pendingReviews([{ id: "review", image_id: "photo", upload_context: "profile_gallery:1" }], [{ id: "photo", review_status: status, sort_order: 1 }]);
    assert.equal(result.rows.length, 1);
  }
});

for (const upload_context of ["profile_gallery:2", "profile_main"]) {
  test(`distinct pending uploads sharing ${upload_context} are both returned with private previews`, async () => {
    const result = await pendingReviews([
      { id: "first-review", status: "pending_review", upload_context, temporary_storage_path: "first.jpg" },
      { id: "second-review", status: "moderating", upload_context, temporary_storage_path: "second.jpg" },
    ], []);
    assert.deepEqual(Array.from(result.rows, row => row.id), ["first-review", "second-review"]);
    assert.deepEqual(result.signed, [["review", "first.jpg"], ["temp", "second.jpg"]]);
  });
}

test("final media decisions take precedence and waiting review is distinct from an active check", () => {
  assert.equal(mediaReview.mediaReviewLabel("approved", "pending_review"), "Approved");
  assert.equal(mediaReview.mediaReviewLabel("rejected", "moderating"), "Not approved");
  assert.equal(mediaReview.mediaReviewLabel("pending", "pending_review"), "Awaiting review");
  assert.equal(mediaReview.mediaReviewLabel("submitted"), "Awaiting review");
  assert.equal(mediaReview.mediaReviewLabel("pending", "moderation_error"), "Review delayed");
  assert.equal(mediaReview.mediaReviewLabel("pending", "moderating"), "Checking");
});
