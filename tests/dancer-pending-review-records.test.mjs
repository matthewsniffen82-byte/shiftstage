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

test('saved rejection feedback is owner scoped and excludes avatar reviews and private storage', async () => {
  const calls = [], exports = {};
  const query = new Proxy({ then: resolve => resolve({ data: [
    { id: 'rejected-photo', upload_context: 'profile_gallery:2', reason_codes: ['multiple_people_detected'] },
    { id: 'manual-rejection', upload_context: 'profile_gallery:3', reason_codes: ['person_count_uncertain'], review_notes: 'Multiple people' },
  ] }) }, {
    get: (target, key) => target[key] || ((...args) => { calls.push([key, ...args]); return query; }),
  });
  const source = route.slice(route.indexOf('async function loadRejectedPhotoReviews'), route.indexOf('function withPhotoUrls'));
  const context = vm.createContext({ ...slot, ...mediaReview, exports, MAX_DANCER_PROFILE_PHOTOS: 30, createAdminSupabaseClient: () => ({ from: table => { calls.push(['from', table]); return query; } }) });
  vm.runInContext(compile(source), context);
  const rows = await context.loadRejectedPhotoReviews('signed-in-owner');
  assert.ok(calls.some(call => call.join(':') === 'eq:user_id:signed-in-owner'));
  assert.ok(calls.some(call => call.join(':') === 'eq:decision:rejected'));
  assert.ok(calls.some(call => call.join(':') === 'eq:status:rejected'));
  assert.ok(calls.some(call => call.join(':') === `neq:upload_context:${slot.PROFILE_AVATAR_CONTEXT}`));
  assert.ok(calls.some(call => call[0] === 'select' && call[1].includes('review_notes')));
  assert.equal(rows[0].id, 'rejected-photo');
  assert.match(rows[0].message, /Multiple people/);
  assert.equal(rows[0].status, 'rejected');
  assert.equal(rows[0].isPrimary, false);
  assert.ok(!('temporary_storage_path' in rows[0]));
  assert.equal(rows[1].message, 'Multiple people');
});

async function pendingReviews(reviews, photos, {avatarFailure=false}={}) {
  const signed = [], calls = [];
  const query = new Proxy({ then: resolve => resolve({ data: reviews }) }, { get: (target, key) => target[key] || ((...args) => { calls.push([key, ...args]); return query; }) });
  const context = vm.createContext({
    ...slot, ...mediaReview, ACTIVE_IMAGE_MODERATION_STATUSES: [], MAX_DANCER_PROFILE_PHOTOS: 30,
    MODERATION_REVIEW_BUCKET: "review", MODERATION_TEMP_BUCKET: "temp", APPROVED_PHOTO_BUCKET: "approved",
    createAdminSupabaseClient: () => ({
      from: () => query,
      storage: { from: bucket => ({ createSignedUrl: async (path, expiry) => { assert.equal(expiry,3600);signed.push([bucket, path]);if(avatarFailure&&path.endsWith('.avatar.jpg'))throw Error('Unavailable');return { data: { signedUrl: `/signed/${path}` } }; } }) },
    }),
  });
  vm.runInContext(compile(loader), context);
  return { rows: await context.loadPendingPhotoReviews("owner", photos), signed, calls };
}

test("pending reviews query saved reasons for the signed-in owner and return readable explanations", async () => {
  const { rows, calls } = await pendingReviews([
    { id: "uncertain", status: "pending_review", reason_codes: ["person_count_uncertain"], upload_context: "profile_gallery:1" },
    { id: "delayed", status: "moderation_error", reason_codes: ["OPENAI_TIMEOUT"], upload_context: "profile_gallery:2" },
    { id: "no-reason", status: "pending_review", reason_codes: [], upload_context: "profile_gallery:3" },
  ], []);
  assert.ok(calls.some(call => call[0] === "select" && call[1].includes("reason_codes")));
  assert.ok(calls.some(call => call.join(":") === "eq:user_id:owner"));
  assert.ok(calls.some(call => call.join(":") === "eq:decision:review"));
  assert.ok(calls.some(call => call.join(":") === `neq:upload_context:${slot.PROFILE_AVATAR_CONTEXT}`));
  assert.match(rows[0].message, /couldn't confirm that you are the only person/);
  assert.match(rows[1].message, /Retry/);
  assert.doesNotMatch(rows[1].message, /OPENAI|Diagnostic/);
  assert.equal(rows[2].message, '');
});

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
  assert.equal(mediaReview.mediaReviewLabel("pending", "pending_review"), "Waiting for final approval");
  assert.equal(mediaReview.mediaReviewLabel("submitted"), "Waiting for final approval");
  assert.equal(mediaReview.mediaReviewLabel("pending", "moderation_error"), "Review delayed");
  assert.equal(mediaReview.mediaReviewLabel("pending", "moderating"), "Completed");
});

const checkedMain={id:'checked-main',decision:'review',status:'pending_review',upload_context:'profile_main',temporary_storage_path:'private-main.jpg',final_storage_path:'owner/profile/main.jpg',category_flags:{file_checks_passed:true,publication_prepared:true}};
test('owner receives the prepared avatar preview without changing publication status',async()=>{
  const {rows,signed,calls}=await pendingReviews([checkedMain],[]);
  assert.equal(rows[0].avatarPreviewUrl,'/signed/owner/profile/main.jpg.avatar.jpg');
  assert.equal(rows[0].review_status,'pending');assert.equal(rows[0].decision,'review');
  assert.ok(!('avatarPhotoUrl' in rows[0]));
  assert.deepEqual(signed,[['review','private-main.jpg'],['approved','owner/profile/main.jpg.avatar.jpg']]);
  assert.ok(calls.some(c=>c.join(':')==='eq:user_id:owner'));
  assert.ok(calls.some(c=>c[0]==='select'&&c[1].includes('category_flags')));
});
for(const changes of [
  {status:'moderating'},{decision:'rejected'},{upload_context:'profile_gallery:1'},
  {category_flags:{}},{category_flags:{file_checks_passed:true}},
  {category_flags:{...checkedMain.category_flags,file_checks_passed:false}},
  {category_flags:{...checkedMain.category_flags,publication_prepared:false}},
  ...['other/profile/main.jpg','owner/../other.jpg','owner//main.jpg','owner/./main.jpg','owner/\\other.jpg',''].map(final_storage_path=>({final_storage_path})),
])test('avatar preview requires checked prepared primary media and an owned path: '+JSON.stringify(changes),async()=>{
  const {rows,signed}=await pendingReviews([{...checkedMain,...changes}],[]);
  assert.equal(rows[0].avatarPreviewUrl,'');assert.ok(signed.every(([bucket])=>bucket!=='approved'));
});
test('missing avatar derivative does not prevent loading the main photo review',async()=>{
  const {rows}=await pendingReviews([checkedMain],[],{avatarFailure:true});
  assert.equal(rows[0].previewUrl,'/signed/private-main.jpg');assert.equal(rows[0].avatarPreviewUrl,'');
});
