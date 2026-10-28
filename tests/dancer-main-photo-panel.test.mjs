import * as clubMedia from '../src/lib/dancr/club-media-status.ts';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { mediaReview } from './helpers/media-review-label.mjs';
import { photoUploadPercent } from '../app/dashboard/photo-upload-progress.ts';
import { mediaUploadError } from '../app/dashboard/media-upload-feedback.ts';

const compile = path => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mapping = {};
runInNewContext(compile("app/dashboard/DancerPhotoPanel.tsx"), { exports: mapping, require: name => name === '@/src/lib/dancr/media-review-label' ? mediaReview : {} });
const code = compile("app/dashboard/DancerMainPhotoPanel.tsx");
const main = { id: "main", imageUrl: "/main.jpg", is_primary: true, review_status: "approved" };
const pending = { id: "review", previewUrl: "/private-review.jpg", is_primary: true, status: "pending_review" };

function fixture(profile = {}, result, { confirm = true, removeFails = false, clubStatuses = [] } = {}) {
  const slots = [], exports = {}, uploads = [], deletes = [];
  let cursor = 0, tree;
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect() {},
  };
  runInNewContext(code, {
    exports, AbortController, Error, crypto: globalThis.crypto, window: { confirm: () => confirm },
    require(name) {
      if (name === "react") return hooks;
      if (name === "@/src/lib/dancr/club-media-status") return clubMedia;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "./DancerPhotoPanel") return mapping;
      if (name === "./photo-upload-progress") return { photoUploadPercent };
      if (name === "./media-upload-feedback") return { mediaUploadError };
      if (name === "./DancerUploadFeedback") return { DancerUploadsSavedNotice: "UploadsSavedNotice", usePendingUploadNotice() {} };
      if (name === '@/src/lib/dancr/media-review-label') return mediaReview;
      if (name === './dashboard-session') return {
        readSession: () => ({ account: { id: 'owner' } }),
        requestDancerPhotosJson: async request => { deletes.push(JSON.parse(request.body)); if (removeFails) throw Error('Deletion unavailable'); return { ok: true }; },
        requestDancerProfileJson: async () => ({ profile }),
      };
      if (name === "./DancerSavedPhotoCrop") return { default: "SavedCrop" };
      if (name === "./DancerMediaRetryButton") return { default: "MediaRetry" };
      if (name === "./DancerMediaUploadRules") return { default: "MediaUploadRules" };
      if (name === "./DancerPhotoControls") return { default: "PhotoControls" };
      if (name === "./main-profile-photo-upload") return { uploadMainProfilePhoto: async (...args) => { uploads.push(args); return result; } };
      if (name.endsWith(".css")) return {};
      throw new Error(name);
    },
  });
  function render() {
    cursor = 0;
    tree = exports.DancerMainPhotoPanel({ profile, clubStatuses, onProfileChange: next => { profile = next; } });
  }
  const nodes = (node = tree) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.primary, node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  render();
  return {
    uploads, deletes,
    get image() { return nodes().find(node => node.type === "img"); },
    get button() { return nodes().find(node => node.type === "button" && !node.props.className?.includes('dancer-photo-edit-target')); },
    get target() { return nodes().find(node => node.props.className?.includes('dancer-photo-edit-target')); },
    get controls() { return nodes().find(node => node.type === 'PhotoControls'); },
    get choices() { return nodes().filter(node => node.type === 'SavedCrop' && node.props.makeMain); },
    tapPhoto() { this.target.props.onClick(); render(); },
    connectInput(click) { nodes().find(node => node.type === 'input').props.ref.current = { click }; },
    get crop() { return nodes().find(node => node.type === "SavedCrop"); },
    get status() { return nodes().find(node => node.props?.className === "dancer-main-photo-status").props.children; },
    get progress() { return nodes().find(node => node.props?.role === 'progressbar')?.props['aria-valuenow']; },
    get reviewRetry() { return nodes().find(node => node.type === 'MediaRetry'); },
    get badge() { return nodes().find(node => node.props?.className === 'dancer-main-photo-state').props.children; },
    update(next) { profile = next; render(); },
    cancel() { nodes().find(node=>node.type==='button'&&node.props.children==='Cancel').props.onClick();render(); },
    async settle() { await new Promise(resolve=>setImmediate(resolve));render(); },
    async remove() { nodes().find(node => node.type === 'button' && /Remove/.test(node.props.children)).props.onClick(); await new Promise(resolve => setImmediate(resolve)); render(); },
    async upload() {
      nodes().find(node => node.type === "input").props.onChange({ target: { files: [new File(["photo"], "main.jpg", { type: "image/jpeg" })], value: "" } });
      await new Promise(resolve => setImmediate(resolve));
      render();
    },
  };
}

test("a first main upload appears in the main slot while awaiting approval, including after reload", async () => {
  const profile = { pending_photo_reviews: [pending] };
  const ui = fixture({}, { decision: "review", profile });
  await ui.upload();
  for (const view of [ui, fixture(profile)]) {
    assert.equal(view.image.props.src, pending.previewUrl);
    assert.equal(view.image.props.alt, "Main photo awaiting review");
    assert.equal(view.button.props.children, "Remove");
    assert.equal(view.button.props['aria-label'], "Remove pending main photo");
    assert.equal(view.button.props.disabled, false);
    assert.equal(view.crop, undefined);
    assert.equal(view.badge, 'Awaiting final approval');
    assert.equal(view.status, '');
  }
  ui.update({ dancer_photos: [main] });
  assert.equal(ui.image.props.src, main.imageUrl);
  assert.equal(ui.button.props.disabled, false);
  assert.ok(ui.crop);
  assert.equal(ui.badge, 'Approved');
  assert.doesNotMatch(ui.status, /awaiting approval/);
});

test('club rejection replaces the waiting label and unlocks main photo replacement', () => {
  const ui = fixture({ pending_photo_reviews: [pending] }, undefined, { clubStatuses: [
    { id: pending.id, kind: 'photo', venueId: 'club', venueName: 'Spearmint Rhino', status: 'rejected' },
  ] });
  assert.equal(ui.badge, 'Not approved — choose another picture');
  assert.equal(ui.target.props['data-needs-attention'], true);
  assert.equal(ui.target.props.disabled, false);
  assert.equal(ui.controls.props.primary.props.children, 'Replace');
});

test('main-photo Cancel aborts a transfer while preserving the current approved photo', async () => {
  let finish;const ui=fixture({dancer_photos:[main]},new Promise(resolve=>{finish=resolve;}));
  await ui.upload();ui.cancel();assert.equal(ui.uploads[0][1].signal.aborted,true);
  finish({decision:'moderating',profile:{pending_photo_reviews:[pending]}});await ui.settle();
  assert.equal(ui.image.props.src,main.imageUrl);assert.equal(ui.status,'Upload canceled.');
});

test('main-photo Cancel during server checks keeps the receipt available for deletion', async () => {
  let finish;const ui=fixture({dancer_photos:[main]},new Promise(resolve=>{finish=resolve;}));
  await ui.upload();const options=ui.uploads[0][1];options.onUploadProgress(100);await ui.settle();ui.cancel();
  assert.equal(options.signal.aborted,false);assert.equal(options.isCanceled(),true);
  finish({decision:'canceled',profile:{dancer_photos:[main]}});await ui.settle();
  assert.equal(ui.image.props.src,main.imageUrl);assert.equal(ui.status,'Upload canceled.');
});

test("a pending main replacement previews privately without changing the approved profile data", () => {
  const profile = { dancer_photos: [main], pending_photo_reviews: [pending] };
  const ui = fixture(profile);
  assert.equal(ui.image.props.src, pending.previewUrl);
  assert.equal(profile.dancer_photos[0], main);
  ui.update({ dancer_photos: [main] });
  assert.equal(ui.image.props.src, main.imageUrl);
});

test('main photo waiting for Club approval offers only Remove and blocks replacement', async () => {
  const ui = fixture({ dancer_photos: [main], pending_photo_reviews: [pending] });
  assert.equal(ui.controls, undefined);
  assert.equal(ui.choices.length, 0);
  assert.equal(ui.target.props.disabled, true);
  assert.equal(ui.button.props.children, 'Remove');
  assert.equal(ui.badge, 'Awaiting final approval');
  await ui.upload();
  assert.equal(ui.uploads.length, 0);
});

test("pending gallery photos do not occupy or disable the main photo slot", () => {
  const ui = fixture({ dancer_photos: [main], pending_photo_reviews: [{ ...pending, is_primary: false, sort_order: 2 }] });
  assert.equal(ui.image.props.src, main.imageUrl);
  assert.equal(ui.button.props.disabled, false);
  assert.ok(ui.crop);
});

test("a main upload identified by its upload context still appears in the main slot", () => {
  const ui = fixture({ pending_photo_reviews: [{ ...pending, is_primary: undefined, upload_context: "main_profile_photo" }] });
  assert.equal(ui.image.props.src, pending.previewUrl);
});

test('choosing another processing main photo preserves the approved replacement identity', async () => {
  const ui = fixture({ dancer_photos: [main], pending_photo_reviews: [{ ...pending, status: 'moderating' }] }, { decision: 'review', profile: { pending_photo_reviews: [pending] } });
  await ui.upload();
  assert.equal(ui.uploads.length, 1);
  assert.equal(ui.uploads[0][1].replacementPhotoId, 'main');
  assert.equal(ui.uploads[0][1].pendingReviewId, 'review');
});

test('moderation work and delays use the same labels as the media library', () => {
  for (const [status, label] of [['moderating', 'Awaiting final approval'], ['error', 'Review delayed'], ['pending_review', 'Awaiting final approval']]) {
    const ui = fixture({ pending_photo_reviews: [{ ...pending, status }] });
    assert.equal(ui.badge, label);
    assert.equal(ui.progress, undefined, 'saved uploads use status text without a lingering progress bar');
    assert.equal(Boolean(ui.reviewRetry), status === 'error');
    assert.equal(Boolean(ui.target.props['data-needs-attention']), status === 'error');
  }
});

test('a rejected main photo shows the reason and preserves the current photo', async () => {
  const ui = fixture({ dancer_photos: [main] }, { decision: 'rejected', reasonCodes: ['multiple_people_detected'] });
  await ui.upload();
  assert.match(ui.status, /Not approved/);
  assert.doesNotMatch(ui.status, /Multiple people/);
  assert.equal(ui.status, 'Not approved — choose another picture');
  assert.equal(ui.progress, undefined);
  assert.equal(ui.image.props.src, main.imageUrl);
});

test('removing a pending main photo restores the approved photo; cancellation and failure preserve it', async () => {
  for (const options of [{}, { confirm: false }, { removeFails: true }]) {
    const ui = fixture({ dancer_photos: [main], pending_photo_reviews: [pending] }, undefined, options);
    await ui.remove();
    if (options.confirm === false) assert.equal(ui.deletes.length, 0);
    else assert.deepEqual(ui.deletes, [{ photoId: 'review' }]);
    assert.equal(ui.image.props.src, options.confirm === false || options.removeFails ? pending.previewUrl : main.imageUrl);
    assert.equal(ui.button.props.disabled, false);
  }
});

test('a legacy pending photo row is replaced by identity instead of automatically deleted', async () => {
  const ui = fixture({ dancer_photos: [{ ...main, review_status: 'pending' }] }, { decision: 'approved', profile: { dancer_photos: [main] } });
  await ui.upload();
  assert.equal(ui.uploads[0][1].replacementPhotoId, 'main');
  assert.equal(ui.uploads[0][1].pendingReviewId, undefined);
});

test('empty main target opens upload and an existing photo opens the compact editing menu', () => {
  const empty = fixture();let opened = 0;
  empty.connectInput(() => opened++);empty.tapPhoto();
  assert.equal(opened, 1);
  assert.equal(empty.target.props['data-empty'], true);
  assert.equal(empty.controls.props.hidden, true);
  const saved = fixture({ dancer_photos: [main] });saved.tapPhoto();
  assert.equal(saved.target.props['data-empty'], false);
  assert.equal(saved.controls.props.hidden, false);
  assert.equal(saved.controls.props.compact, true);
  assert.equal(saved.controls.props.openRequested, 1);
});

test('main photo choices use approved uploaded photos and keep pending photos out of the picker', () => {
  const ui = fixture({ dancer_photos: [main, { ...main, id:'gallery', is_primary:false }], pending_photo_reviews: [{ ...pending, is_primary:false }] });
  assert.equal(ui.choices.length, 1);
  assert.equal(ui.choices[0].props.photo.id, 'gallery');
  assert.ok(ui.choices[0].props.thumbnail);
  assert.equal(ui.uploads.length, 0);
});

test('removing the main photo leaves its slot empty even with an approved gallery, including after reload', async () => {
  const gallery = { ...main, id: 'gallery', imageUrl: '/gallery.jpg', is_primary: false };
  const ui = fixture({ dancer_photos: [main, gallery] });
  await ui.remove();
  assert.deepEqual(ui.deletes, [{ photoId: 'main' }]);
  for (const view of [ui, fixture({ dancer_photos: [gallery] })]) {
    assert.equal(view.target.props['aria-label'], 'Add main photo');
    assert.equal(view.target.props['data-empty'], true);
    assert.equal(view.controls.props.hidden, true);
    assert.equal(view.badge, 'Required');
    assert.equal(view.choices.length, 1);
    assert.equal(view.uploads.length, 0);
  }
});
