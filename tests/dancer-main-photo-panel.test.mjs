import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { mediaReview } from './helpers/media-review-label.mjs';

const compile = path => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mapping = {};
runInNewContext(compile("app/dashboard/DancerPhotoPanel.tsx"), { exports: mapping, require: () => ({}) });
const code = compile("app/dashboard/DancerMainPhotoPanel.tsx");
const main = { id: "main", imageUrl: "/main.jpg", is_primary: true, review_status: "approved" };
const pending = { id: "review", previewUrl: "/private-review.jpg", is_primary: true, status: "pending_review" };

function fixture(profile = {}, result, { confirm = true, removeFails = false } = {}) {
  const slots = [], exports = {}, uploads = [], deletes = [];
  let cursor = 0, tree;
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => { slots[i] = next; }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect() {},
  };
  runInNewContext(code, {
    exports, AbortController, Error, crypto: globalThis.crypto, window: { confirm: () => confirm },
    require(name) {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "./DancerPhotoPanel") return mapping;
      if (name === '@/src/lib/dancr/media-review-label') return mediaReview;
      if (name === './dashboard-session') return {
        readSession: () => ({ account: { id: 'owner' } }),
        requestDancerPhotosJson: async request => { deletes.push(JSON.parse(request.body)); if (removeFails) throw Error('Deletion unavailable'); return { ok: true }; },
        requestDancerProfileJson: async () => ({ profile }),
      };
      if (name === "./DancerSavedPhotoCrop") return { default: "SavedCrop" };
      if (name === "./main-profile-photo-upload") return { uploadMainProfilePhoto: async (...args) => { uploads.push(args); return result; } };
      if (name.endsWith(".css")) return {};
      throw new Error(name);
    },
  });
  function render() {
    cursor = 0;
    tree = exports.DancerMainPhotoPanel({ profile, onProfileChange: next => { profile = next; } });
  }
  const nodes = (node = tree) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  render();
  return {
    uploads, deletes,
    get image() { return nodes().find(node => node.type === "img"); },
    get button() { return nodes().find(node => node.type === "button"); },
    get crop() { return nodes().find(node => node.type === "SavedCrop"); },
    get status() { return nodes().find(node => node.props?.role === "status").props.children; },
    get badge() { return nodes().find(node => node.props?.className === 'dancer-main-photo-state').props.children; },
    update(next) { profile = next; render(); },
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
    assert.equal(view.button.props.children, "Choose another photo");
    assert.equal(view.button.props.disabled, false);
    assert.equal(view.crop, undefined);
    assert.equal(view.badge, 'Awaiting review');
    assert.equal(view.status, '');
  }
  ui.update({ dancer_photos: [main] });
  assert.equal(ui.image.props.src, main.imageUrl);
  assert.equal(ui.button.props.disabled, false);
  assert.ok(ui.crop);
  assert.equal(ui.badge, 'Approved');
  assert.doesNotMatch(ui.status, /awaiting approval/);
});

test("a pending main replacement previews privately without changing the approved profile data", () => {
  const profile = { dancer_photos: [main], pending_photo_reviews: [pending] };
  const ui = fixture(profile);
  assert.equal(ui.image.props.src, pending.previewUrl);
  assert.equal(profile.dancer_photos[0], main);
  ui.update({ dancer_photos: [main] });
  assert.equal(ui.image.props.src, main.imageUrl);
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

test('choosing another pending main photo preserves the approved replacement identity', async () => {
  const ui = fixture({ dancer_photos: [main], pending_photo_reviews: [pending] }, { decision: 'review', profile: { pending_photo_reviews: [pending] } });
  await ui.upload();
  assert.equal(ui.uploads.length, 1);
  assert.equal(ui.uploads[0][1].replacementPhotoId, 'main');
  assert.equal(ui.uploads[0][1].pendingReviewId, 'review');
});

test('moderation work and delays use the same labels as the media library', () => {
  for (const [status, label] of [['moderating', 'Checking'], ['error', 'Review delayed'], ['pending_review', 'Awaiting review']]) {
    assert.equal(fixture({ pending_photo_reviews: [{ ...pending, status }] }).badge, label);
  }
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
