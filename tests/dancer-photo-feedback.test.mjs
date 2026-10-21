import { refreshButtonModule } from './helpers/refresh-button.mjs';
import assert from "node:assert/strict";
import { readFileSync } from "./helpers/dashboard-test-fs.mjs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { mediaReview } from "./helpers/media-review-label.mjs";
import { preparePhotoUpload } from "../app/dashboard/prepare-photo-upload.ts";
import { runMediaUploadBatch } from "../app/dashboard/media-upload-batch.ts";

const source = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const photoSource = source.slice(source.indexOf("type DancerPhotoItem ="), source.indexOf("\nfunction InfoPanel("));
const compile = text => ts.transpileModule(text, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const code = compile(`${photoSource}\nexport { DancerPhotoPanel, dancerPhotoItemsFromProfile };`);
const empty = [];
const approved = (id = "saved", sort = 1, primary = false) => ({ id, imageUrl: `/${id}.jpg`, review_status: "approved", sort_order: sort, is_primary: primary });
const pending = (id = "review", sort = 1) => ({ id, previewUrl: `/${id}.jpg`, sort_order: sort });

// Exercise the real upload handlers, state updates, and profile mapping without uploading user data.
function photoHarness({ uploadOnly = false, profile = {}, pin = async (_kind, id, pinned) => ({ id, isPinned: pinned }), post = async () => ({ decision: "review", moderationRecordId: "review", photo: { id: "review", sortOrder: 1 } }), read = async () => ({ profile: { dancer_photos: [approved()] } }) } = {}) {
  const slots = [], posts = [], reads = [], profiles = [], pins = [], crops = [], previews = [], revoked = [];
  let cursor = 0, effects = [], dirty = true, tree;
  const exports = {};
  runInNewContext(code, {
    preparePhotoUpload, runMediaUploadBatch, RefreshButton: refreshButtonModule.default,
    exports, ...mediaReview, MAX_DANCER_PROFILE_PHOTOS: 30, MIN_DANCER_ONBOARDING_PHOTOS: 3, DancerRejectedUploadNotice: "RejectedUploadNotice", DancerUploadDisclosure: "UploadDisclosure", DancerMediaUploadRules: "MediaUploadRules", DancerMediaRetryButton: "MediaRetryButton", DancerMediaPinButton: "MediaPinButton", DancerInternalMainPhotoPicker: "InternalMainPhotoPicker",
    requestDancerMediaPin: (...args) => { pins.push(args); return pin(...args); },
    cropProfilePhoto: (...args) => { crops.push(args); throw new Error("Uploads must not open the manual crop editor."); },
    require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; dirty = true; }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
      }
    },
    readSession: () => ({ accessToken: "fixture" }),
    requestDancerPhotosJson: options => { posts.push(options); return post(options); },
    requestDancerProfileJson: options => { reads.push(options); return read(options); },
    URL: { createObjectURL: () => { const url = `blob:fixture-${previews.length}`; previews.push(url); return url; }, revokeObjectURL: url => revoked.push(url) },
    FormData, AbortController, Event, Error, crypto: globalThis.crypto,
    window: { dispatchEvent() {}, confirm: () => true },
  });
  function render() {
    for (let count = 0; dirty && count < 20; count++) {
      dirty = false; cursor = 0; effects = [];
      tree = exports.DancerPhotoPanel({ uploadOnly, profile, deletedPhotoIds: empty, deletedPhotoStoragePaths: empty, onProfileChange: next => profiles.push(next) });
      effects.forEach(effect => effect());
    }
    assert.equal(dirty, false, "photo updates must settle without looping");
  }
  function nodes(node = tree) { if (node?.type === refreshButtonModule.default) return nodes(node.type(node.props));
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  }
  render();
  return {
    posts, reads, profiles, pins, crops, previews, revoked, mapProfile: exports.dancerPhotoItemsFromProfile,
    get picker() { return nodes().find(node => node.type === "UploadDisclosure"); },
    get reviewsInsidePicker() { return nodes(this.picker).filter(node => node.props?.className?.startsWith("photo-review-card") || node.type === "RejectedUploadNotice"); },
    get pinButtons() { return nodes().filter(node => node.type === "MediaPinButton"); },
    get mainPhotoPicker() { return nodes().find(node => node.type === "InternalMainPhotoPicker"); },
    get notices() { return nodes().filter(node => node.type === "RejectedUploadNotice"); },
    get cards() { return nodes().filter(node => node.type === "RejectedUploadNotice" || /^(photo-review-card|photo-saved-preview)/.test(node.props?.className || "")); },
    get labels() { return this.cards.map(card => card.type === "RejectedUploadNotice" ? card.props.label : nodes(card).find(node => node.type === "strong").props.children); },
    get statuses() { return this.cards.map(card => card.type === "RejectedUploadNotice" ? "Not approved" : nodes(card).find(node => node.type === "small").props.children); },
    get notes() { return nodes().filter(node => node.type === "em" || node.type === "RejectedUploadNotice").map(node => node.type === "em" ? node.props.children : node.props.message); },
    get reviewButtons() { return nodes().filter(node => node.type === "MediaRetryButton"); },
    get buttons() { return nodes().filter(node => node.type === "button"); },
    get replacements() { return nodes().filter(node => node.type === "input" && /^Replace photo/.test(node.props['aria-label'] || '')); },
    get progress() { return nodes().filter(node => node.type === "progress"); },
    select(files = [new File(["fixture"], "solo.jpg", { type: "image/jpeg" })], source = "gallery") {
      nodes().find(node => node.type === "input" && node.props.className === "photo-source-input"
        && Boolean(node.props.capture) === (source === "camera")).props.onChange({ target: { files, value: "" } });
      render();
    },
    updateProfile(next) { profile = next; dirty = true; render(); },
    close() { slots.forEach(slot => slot?.cleanup?.()); tree = null; },
    reopen() { slots.length = 0; dirty = true; render(); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}

test("selecting several photos uploads the batch without opening a crop popup", async () => {
  const ui = photoHarness();
  ui.select([new File(["first"], "first.jpg", { type: "image/jpeg" }), new File(["second"], "second.jpg", { type: "image/jpeg" })]);
  await ui.settle();
  assert.equal(ui.crops.length, 0);
  assert.equal(ui.posts.length, 2);
  assert.equal(ui.reads.length, 1);
  assert.deepEqual(await Promise.all(ui.posts.map(post => post.body.get("file").text())), ["first", "second"]);
  assert.equal(ui.buttons.filter(button => button.props.children === "Retry").length, 0);
});

test("overlapping photo reviews reserve selection order and show real progress before results arrive", async () => {
  const releases = [];
  const ui = photoHarness({ uploadOnly: true,
    post: () => new Promise(resolve => releases.push(resolve)),
    read: async () => ({ profile: { dancer_photos: [approved('first', 1), approved('second', 2), approved('third', 3)] } }),
  });
  ui.select(['first', 'second', 'third'].map(name => new File([name], name + '.jpg', { type: 'image/jpeg' })));
  await ui.settle();
  assert.equal(ui.posts.length, 2, 'the second upload starts before the first review completes');
  ui.posts[0].onUploadProgress(43); ui.posts[1].onUploadProgress(100); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading 43%', 'Uploaded · Processing and reviewing', 'Waiting to upload']);
  assert.equal(ui.progress[0].props.value, 43);
  releases[1]({ decision: 'approved', photo: approved('second', 2) }); await ui.settle();
  assert.equal(ui.posts.length, 3, 'the third upload does not wait for the first review');
  assert.deepEqual(ui.posts.map(post => Number(post.body.get('sortOrder'))), [1, 2, 3]);
  releases[2]({ decision: 'approved', photo: approved('third', 3) }); await ui.settle();
  assert.equal(ui.reads.length, 0, 'final refresh waits for all in-flight reviews');
  releases[0]({ decision: 'approved', photo: approved('first', 1) }); await ui.settle();
  assert.equal(ui.reads.length, 1);
  assert.equal(ui.cards.length, 0);
});

test("collapsing photo upload controls leaves pending and rejected reviews outside the disclosure", () => {
  const ui = photoHarness({ uploadOnly: true, profile: { dancer_photos: [approved("a", 1), approved("b", 2), approved("c", 3)],
    pending_photo_reviews: [pending()], rejected_photo_reviews: [{ id: "rejected", message: "Choose a solo photo." }] } });
  assert.equal(ui.picker.props.defaultOpen, false);
  assert.equal(ui.reviewsInsidePicker.length, 0);
  assert.equal(ui.cards.length, 2);
  assert.equal(photoHarness({ uploadOnly: true }).picker.props.defaultOpen, true);
});

test("camera and library photos go directly to the moderated upload with their original bytes", async () => {
  for (const source of ["camera", "gallery"]) {
    const ui = photoHarness();
    ui.select([new File(["original-photo"], "solo.jpg", { type: "image/jpeg" })], source);
    await ui.settle();
    assert.equal(ui.crops.length, 0);
    assert.equal(ui.posts.length, 1);
    assert.equal(await ui.posts[0].body.get("file").text(), "original-photo");
    assert.equal(ui.posts[0].body.get("file").name, "solo.jpg");
  }
});

test("failed uploads retry the same original photo without a crop dialog or new upload key", async () => {
  let attempts = 0;
  const ui = photoHarness({ post: async () => {
    if (++attempts === 1) throw new Error("Connection lost.");
    return { decision: "approved", photo: approved() };
  } });
  ui.select(); await ui.settle();
  ui.buttons.find(button => button.props.children === "Retry").props.onClick();
  await ui.settle();
  assert.equal(ui.crops.length, 0);
  assert.equal(ui.posts.length, 2);
  assert.equal(ui.posts[0].headers["idempotency-key"], ui.posts[1].headers["idempotency-key"]);
  assert.equal(await ui.posts[1].body.get("file").text(), "fixture");
  assert.deepEqual(ui.statuses, ["Approved"]);
});

test("empty or unsupported files remain in the upload card without opening a popup or uploading", async () => {
  const ui = photoHarness();
  ui.select([new File([], "empty.jpg", { type: "image/jpeg" }), new File(["text"], "note.txt", { type: "text/plain" })]);
  await ui.settle();
  assert.equal(ui.crops.length, 0);
  assert.equal(ui.posts.length, 0);
  assert.deepEqual(ui.statuses, ["Upload failed", "Upload failed"]);
});

test("fresh approval replaces a locally checking photo even when the review and saved photo have different IDs", async () => {
  const ui = photoHarness();
  ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ["Approved"]);
  assert.equal(ui.cards[0].props.className, "photo-saved-preview is-approved");
  assert.deepEqual(ui.notes, []);
  assert.equal(ui.posts.length, 1);
  assert.equal(ui.buttons.some(button => button.props.children === "Retry"), false);
});

test("the Add photo box clears approved uploads while keeping them in the gallery", async () => {
  const ui = photoHarness({ uploadOnly: true, profile: { dancer_photos: [approved("existing")] }, post: async () => ({ decision: "approved", photo: approved() }) });
  assert.equal(ui.cards.length, 0);
  assert.equal(ui.pinButtons.length, 0);
  ui.select(); await ui.settle();
  assert.equal(ui.posts.length, 1);
  assert.equal(ui.profiles.length, 1);
  assert.equal(ui.cards.length, 0);
  assert.deepEqual(photoHarness({ profile: ui.profiles[0] }).statuses, ["Approved"]);
  assert.equal(ui.buttons.filter(button => button.props.className !== "photo-source-action").length, 0, "completed receipts cannot retry or remove saved photos");
  assert.equal(ui.progress.length, 0);
  assert.deepEqual(ui.revoked, [], "keep the local preview until the uploader closes");
  ui.updateProfile(ui.profiles[0]);
  assert.equal(ui.cards.length, 0, "profile refresh must not restore the approved receipt");
  ui.close();
  assert.deepEqual(ui.revoked, ui.previews);
  ui.reopen();
  assert.equal(ui.cards.length, 0, "reopening starts a new session even with saved photos");
});

test("the Add photo box clears an upload approved during the first profile refresh", async () => {
  const ui = photoHarness({ uploadOnly: true });
  ui.select(); await ui.settle();
  assert.equal(ui.cards.length, 0, "the published photo can have a different ID from its review");
  assert.deepEqual(photoHarness({ profile: ui.profiles[0] }).statuses, ["Approved"]);
});

test("pending upload cards disappear after approval with either the same or a new photo ID", async () => {
  for (const approvedId of ["review", "published"]) {
    const ui = photoHarness({ uploadOnly: true, read: async () => ({ profile: { pending_photo_reviews: [pending()] } }) });
    ui.select(); await ui.settle();
    assert.deepEqual(ui.statuses, ["Checking"]);
    const refreshed = { dancer_photos: [approved(approvedId)], pending_photo_reviews: [pending("unrelated")] };
    ui.updateProfile(refreshed);
    assert.equal(ui.cards.length, 1, "the unrelated review remains in the upload area");
    assert.deepEqual(ui.statuses, ["Checking"]);
    assert.deepEqual(photoHarness({ profile: refreshed }).statuses, ["Checking", "Approved"]);
    assert.equal(ui.posts.length, 1, "approval must not upload the photo again");
    assert.deepEqual(ui.revoked, [], "gallery previews remain valid until the uploader closes");
  }
});

test("mixed batches clear approvals while keeping unresolved photos in selection order", async () => {
  const releases = [];
  const ui = photoHarness({ uploadOnly: true, post: () => new Promise(resolve => releases.push(resolve)), read: async () => ({ profile: { dancer_photos: [approved()], pending_photo_reviews: [{ ...pending(), status: "pending_review" }] } }) });
  ui.select(["first", "second", "third"].map(name => new File([name], `${name}.jpg`, { type: "image/jpeg" })));
  await ui.settle();
  releases[0]({ decision: "approved", photo: approved() }); await ui.settle();
  assert.deepEqual(ui.statuses, ["Approved", "Uploading 0%", "Uploading 0%"]);
  assert.deepEqual(ui.labels, ["Selected photo 1", "Selected photo 2", "Selected photo 3"]);
  releases[1]({ decision: "rejected", moderationRecordId: "rejected", message: "Choose a solo photo." }); await ui.settle();
  assert.deepEqual(ui.statuses, ["Approved", "Not approved", "Uploading 0%"]);
  releases[2]({ decision: "review", photo: { id: "review", reviewStatus: "pending" } }); await ui.settle();
  assert.deepEqual(ui.statuses, ["Not approved", "Pending club approval"]);
  assert.deepEqual(ui.labels, ["second.jpg", "Selected photo 3"]);
  assert.equal(ui.notes[0], "Choose a solo photo.");
  assert.match(ui.notes[1], /waiting for club approval/);
  assert.equal(ui.progress.length, 0);
  assert.equal(ui.buttons.filter(button => button.props.children === "Remove").length, 1);
  assert.deepEqual(ui.revoked, []);
  assert.equal(ui.notices.length, 1);
  assert.match(ui.cards[1].props.className, /is-pending/);
  assert.equal(ui.cards[1].props.children[0].props.style.backgroundImage, `url(${ui.previews[2]})`);
  ui.close(); assert.deepEqual(ui.revoked, ui.previews);
  ui.reopen(); assert.equal(ui.cards.length, 0);
});

test("additional selections preserve results without counting completed receipts as occupied slots", async () => {
  const saved = Array.from({ length: 28 }, (_, index) => approved(`existing-${index}`, index + 1));
  let attempts = 0;
  const ui = photoHarness({ uploadOnly: true, profile: { dancer_photos: saved }, post: async () => {
    if (++attempts === 1) return { decision: "rejected", message: "Choose another photo." };
    const photo = approved(`new-${attempts}`, saved.length + 1); saved.push(photo);
    return { decision: "approved", photo };
  }, read: async () => ({ profile: { dancer_photos: [...saved] } }) });
  for (let i = 0; i < 3; i++) { ui.select(); await ui.settle(); }
  assert.equal(ui.posts.length, 3);
  assert.deepEqual(ui.statuses, ["Not approved"]);
  ui.select(); await ui.settle();
  assert.equal(ui.posts.length, 3, "the actual 30-photo library limit still applies");
});

test("a refresh failure preserves completed outcomes and retries only the failed photo in place", async () => {
  let attempts = 0;
  let refreshAvailable = false;
  const ui = photoHarness({ uploadOnly: true, post: async () => {
    if (++attempts === 1) return { decision: "approved", photo: approved() };
    if (attempts === 2) return { decision: "rejected", message: "Choose another photo." };
    if (attempts === 3) throw new Error("Connection lost.");
    return { decision: "approved", photo: approved("retried", 2) };
  }, read: async () => {
    if (!refreshAvailable) throw new Error("Unable to refresh uploaded photos.");
    return { profile: { dancer_photos: [approved(), approved("retried", 2)] } };
  } });
  ui.select(["first", "second", "third"].map(name => new File([name], `${name}.jpg`, { type: "image/jpeg" })));
  await ui.settle();
  assert.deepEqual(ui.statuses, ["Approved", "Not approved", "Upload failed"]);
  assert.deepEqual(ui.buttons.filter(button => button.props.className !== "photo-source-action").map(button => button.props["aria-label"] || button.props.children), ["Refresh photo library", "Retry", "Remove"]);
  ui.buttons.find(button => button.props.children === "Retry").props.onClick(); await ui.settle();
  assert.deepEqual(ui.statuses, ["Approved", "Not approved", "Approved"]);
  assert.equal(ui.posts[2].headers["idempotency-key"], ui.posts[3].headers["idempotency-key"]);
  refreshAvailable = true;
  ui.buttons.find(button => button.props["aria-label"] === "Refresh photo library").props.onClick(); await ui.settle();
  assert.deepEqual(ui.statuses, ["Not approved"]);
  assert.equal(ui.posts.length, 4, "refreshing never uploads approved photos again");
  assert.deepEqual(ui.labels, ["second.jpg"]);
  assert.deepEqual(ui.revoked, []);
});

test("closing during an upload aborts it and ignores its late result after reopening", async () => {
  let release;
  const ui = photoHarness({ uploadOnly: true, post: () => new Promise(resolve => { release = resolve; }) });
  ui.select(); await ui.settle();
  ui.close();
  assert.equal(ui.posts[0].signal.aborted, true);
  assert.deepEqual(ui.revoked, ui.previews);
  ui.reopen();
  release({ decision: "approved", photo: approved() }); await ui.settle();
  assert.equal(ui.cards.length, 0);
  assert.equal(ui.reads.length, 0);
  assert.equal(ui.profiles.length, 0);
});

test("the Add photo box retains failed upload feedback and retry", async () => {
  const ui = photoHarness({ uploadOnly: true, post: async () => { throw new Error("Connection lost."); } });
  ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ["Upload failed"]);
  assert.ok(ui.buttons.some(button => button.props.children === "Retry"));
});

test("saved pending and rejected photos stay above the library with reasons after reopening", () => {
  const ui = photoHarness({ uploadOnly: true, profile: {
    dancer_photos: [approved()], pending_photo_reviews: [pending()],
    rejected_photo_reviews: [{ id: 'denied', message: 'Only you can appear in a profile photo.' }],
  } });
  assert.deepEqual(ui.statuses, ['Checking', 'Not approved']);
  assert.match(ui.notes[0], /AI checks are running/);
  assert.equal(ui.notes[1], 'Only you can appear in a profile photo.');
  assert.equal(ui.replacements.length, 1);
  ui.close(); ui.reopen();
  assert.deepEqual(ui.statuses, ['Checking', 'Not approved']);
  assert.equal(ui.pinButtons.length, 0);
});

test("an asynchronous rejection updates the same card with the saved reason", async () => {
  const ui = photoHarness({ uploadOnly: true, read: async () => ({ profile: { pending_photo_reviews: [pending()] } }) });
  ui.select(); await ui.settle();
  ui.updateProfile({ rejected_photo_reviews: [{ id: 'review', message: 'Remove the contact overlay.' }] });
  assert.deepEqual(ui.statuses, ['Not approved']);
  assert.deepEqual(ui.notes, ['Remove the contact overlay.']);
  ui.updateProfile({ rejected_photo_reviews: [{ id: "review", message: "Remove the contact overlay." }] });
  assert.deepEqual(ui.statuses, ['Not approved']);
  ui.notices[0].props.onDismiss(); await ui.settle();
  assert.equal(ui.cards.length, 0);
  assert.deepEqual(ui.revoked, ui.previews);
  ui.updateProfile({ rejected_photo_reviews: [{ id: 'review', message: 'Stale refresh' }], pending_photo_reviews: [pending('other')] });
  assert.deepEqual(ui.statuses, ['Checking'], 'stale data cannot restore a cleared rejection');
});

test('batch rejection cleanup removes every seen rejection from profile feedback without touching pending or approved photos', async () => {
  const ui = photoHarness({ uploadOnly: true, profile: { dancer_photos: [approved()], pending_photo_reviews: [pending()],
    rejected_photo_reviews: [{ id: 'first', message: 'First reason' }, { id: 'second', message: 'Second reason' }] } });
  ui.notices.forEach(notice => notice.props.onDismiss()); await ui.settle();
  assert.deepEqual(ui.statuses, ['Checking']);
  assert.equal(ui.profiles.at(-1).rejected_photo_reviews.length, 0);
  assert.equal(ui.profiles.at(-1).dancer_photos.length, 1);
  ui.updateProfile(ui.profiles.at(-1)); ui.close(); ui.reopen();
  assert.deepEqual(ui.statuses, ['Checking']);
});

test("a profile refresh retains a failed photo and replacement cancellation leaves it untouched", async () => {
  const ui = photoHarness({ uploadOnly: true, post: async () => { throw new Error('Connection lost.'); } });
  ui.select(); await ui.settle(); ui.updateProfile({});
  assert.deepEqual(ui.statuses, ['Upload failed']);
  ui.replacements[0].props.onChange({ target: { files: [], value: '' } });
  await ui.settle();
  assert.equal(ui.posts.length, 1);
  assert.deepEqual(ui.notes, ['Connection lost.']);
  ui.updateProfile({});
  assert.equal(ui.replacements.length, 1);
});

test("replacement failure stays in the upload area and retries the new photo without deleting twice", async () => {
  let attempts = 0;
  const ui = photoHarness({ uploadOnly: true, profile: { pending_photo_reviews: [pending('waiting')] }, post: async options => {
    if (options.method === 'DELETE') return { ok: true };
    if (++attempts === 1) throw new Error('Connection lost.');
    return { decision: 'approved', photo: approved() };
  } });
  ui.replacements[0].props.onChange({ target: { files: [new File(['replacement'], 'new.jpg', { type: 'image/jpeg' })], value: '' } });
  await ui.settle();
  assert.deepEqual(ui.statuses, ['Upload failed']);
  assert.deepEqual(ui.posts.map(post => post.method), ['DELETE', 'POST']);
  ui.buttons.find(button => button.props.children === 'Retry').props.onClick(); await ui.settle();
  assert.deepEqual(ui.posts.map(post => post.method), ['DELETE', 'POST', 'POST']);
  assert.equal(await ui.posts[2].body.get('file').text(), 'replacement');
  assert.equal(ui.cards.length, 0);
});

test("a real pending replacement stays checking until the server approves it", async () => {
  const ui = photoHarness({ read: async () => ({ profile: { dancer_photos: [approved("old")], pending_photo_reviews: [pending()] } }) });
  ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ["Checking", "Approved"]);
  assert.equal(ui.notes.length, 1);
  assert.match(ui.notes[0], /AI checks are running/);
  ui.updateProfile({ dancer_photos: [approved("replacement")] });
  assert.deepEqual(ui.statuses, ["Approved"]);
});

test("saved manual-review reasons remain visible after reopening and clear on approval", () => {
  const profile = { pending_photo_reviews: [{ ...pending(), status: "pending_review", reason_codes: ["person_count_uncertain"] }] };
  const ui = photoHarness({ uploadOnly: true, profile });
  assert.match(ui.notes[0], /couldn't confirm that you are the only person/);
  ui.close(); ui.reopen();
  assert.match(ui.notes[0], /couldn't confirm that you are the only person/);
  ui.updateProfile({ dancer_photos: [approved()] });
  assert.deepEqual(ui.notes, []);
});

test("initial and retried upload outcomes preserve their reasons when the library cannot supply one", async () => {
  const ui = photoHarness({ uploadOnly: true, post: async () => ({ decision: "review", moderationRecordId: "review", reasonCodes: ["branding_or_logo_uncertain"] }), read: async () => { throw new Error("Refresh unavailable."); } });
  ui.select(); await ui.settle();
  assert.match(ui.notes[0], /Possible branding or a logo/);
  ui.reviewButtons[0].props.onRetried({ result: { decision: "review", reasonCodes: ["person_count_uncertain"] } });
  await ui.settle();
  assert.match(ui.notes[0], /couldn't confirm that you are the only person/);
});

test("the dashboard keeps same-position pending uploads and the current approved photo distinct", () => {
  const ui = photoHarness({ profile: {
    dancer_photos: [approved("current", 1)],
    pending_photo_reviews: [pending("first", 1), pending("second", 1)],
  } });
  assert.deepEqual(ui.statuses, ["Checking", "Checking", "Approved"]);
  assert.deepEqual(Array.from(ui.mapProfile({ pending_photo_reviews: [pending("first", 1), pending("second", 1)] }), item => item.id), ["first", "second"]);
  ui.updateProfile({ dancer_photos: [approved("current", 1), approved("published", 2)], pending_photo_reviews: [pending("first", 1)] });
  assert.deepEqual(ui.statuses, ["Checking", "Approved", "Approved"]);
});

test("pending replacements stay manageable even when the approved library fills every slot", () => {
  const ui = photoHarness({ profile: {
    dancer_photos: Array.from({ length: 30 }, (_, index) => approved(`saved-${index}`, index + 1)),
    pending_photo_reviews: [pending("replacement", 1)],
  } });
  assert.equal(ui.cards.length, 31);
  assert.equal(ui.statuses.filter(status => status === "Checking").length, 1);
});

test("completed checks awaiting review are distinct from active checks and become approved after refresh", () => {
  const ui = photoHarness({ profile: {
    status: "approved",
    dancer_photos: [approved("first", 1)],
    pending_photo_reviews: [{ ...pending("waiting", 2), status: "pending_review" }, { ...pending("checking", 3), status: "moderating" }],
  } });
  assert.deepEqual(ui.statuses, ["Pending club approval", "Checking", "Approved"]);
  assert.equal(ui.pinButtons.length, 1, "unapproved uploads do not have library controls");
  ui.updateProfile({ dancer_photos: [approved("first", 1), approved("reviewed", 2)], pending_photo_reviews: [{ ...pending("checking", 3), status: "moderating" }] });
  assert.deepEqual(ui.statuses, ["Checking", "Approved", "Approved"]);
  assert.equal(ui.pinButtons[1].props.available, true);
});

test("an accepted upload is never offered for retry after its profile refresh fails", async () => {
  const ui = photoHarness({ post: async () => ({ decision: "approved", photo: approved() }), read: async () => { throw new Error("Unable to refresh uploaded photos."); } });
  ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ["Approved"]);
  assert.equal(ui.buttons.some(button => button.props.children === "Retry"), false);
  assert.equal(ui.posts.length, 1);
});

test("a failed upload remains available for a deliberate retry", async () => {
  const ui = photoHarness({ post: async () => { throw new Error("Connection lost."); } });
  ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ["Upload failed"]);
  assert.ok(ui.buttons.find(button => button.props.children === "Retry"));
  assert.equal(ui.reads.length, 0);
});

test("gallery uploads and photo management leave the shared main photo to its dedicated panel", () => {
  for (const uploadOnly of [true, false]) {
    const ui = photoHarness({ uploadOnly, profile: { avatarPhotoUrl: "/avatar.jpg", dancer_photos: [approved()] } });
    assert.equal(ui.mainPhotoPicker, undefined);
    assert.equal(ui.buttons.some(button => button.props.children === "Make main"), false);
  }
});

test("pinning a photo keeps it first across refreshes without changing the avatar or legacy slots", async () => {
  let savedPin = false;
  const first = approved("first", 0, true), second = { ...approved("second", 1), is_pinned: true };
  const ui = photoHarness({
    profile: { avatarPhotoUrl: "/avatar.jpg", dancer_photos: [first, { ...second, is_pinned: false }] },
    pin: async (_kind, id, pinned) => { savedPin = pinned; return { id, isPinned: pinned }; },
    read: async () => ({ profile: { avatarPhotoUrl: "/avatar.jpg", dancer_photos: [first, { ...second, is_pinned: savedPin }] } }),
  });
  assert.equal(ui.buttons.some(button => button.props.className === "photo-order-action"), false);
  const button = ui.pinButtons[1];
  button.props.onClick(); button.props.onClick();
  await ui.settle();
  assert.equal(ui.pins.length, 1);
  assert.deepEqual(ui.pins[0].slice(0, 3), ["photo", "second", true]);
  assert.equal(ui.pinButtons[0].props.pinned, true);
  assert.deepEqual(ui.labels, ["Photo 1", "Photo 2"]);
  assert.equal(ui.profiles[0].avatarPhotoUrl, "/avatar.jpg");
  assert.equal(ui.profiles[0].dancer_photos[0].is_primary, true);
  ui.updateProfile(ui.profiles[0]);
  assert.equal(ui.pinButtons[0].props.pinned, true);
  ui.pinButtons[0].props.onClick(); await ui.settle();
  assert.deepEqual(ui.pins[1].slice(0, 3), ["photo", "second", false]);
  assert.equal(ui.pinButtons[0].props.pinned, false);
});

test("failed pin requests leave the photo order intact and release the controls", async () => {
  const ui = photoHarness({ profile: { dancer_photos: [approved("first", 0, true), approved("second", 1)] }, pin: async () => { throw new Error("Connection lost."); } });
  ui.pinButtons[1].props.onClick(); await ui.settle();
  assert.equal(ui.pinButtons[1].props.pinned, false);
  assert.equal(ui.pinButtons[1].props.disabled, false);
  assert.equal(ui.reads.length, 0);
});

test("compact photo previews delete through the existing action without altering the avatar", async () => {
  const ui = photoHarness({
    profile: { avatarPhotoUrl: "/avatar.jpg", dancer_photos: [approved("delete-me")] },
    read: async () => ({ profile: { avatarPhotoUrl: "/avatar.jpg", dancer_photos: [] } }),
  });
  const trash = ui.buttons.find(button => button.props["aria-label"] === "Delete photo 1");
  assert.ok(trash);
  trash.props.onClick(); trash.props.onClick(); await ui.settle();
  assert.equal(ui.posts.length, 1);
  assert.equal(ui.posts[0].method, "DELETE");
  assert.deepEqual(JSON.parse(ui.posts[0].body), { photoId: "delete-me" });
  assert.equal(ui.cards.length, 0);
  assert.equal(ui.profiles[0].avatarPhotoUrl, "/avatar.jpg");
});

test("new pictures always append to the gallery without replacing a legacy primary photo", async () => {
  const ui = photoHarness({ profile: { dancer_photos: [approved("first", 0, true)] } });
  ui.select(); await ui.settle();
  assert.equal(ui.posts[0].body.get("isPrimary"), "false");
  assert.equal(ui.posts[0].body.get("replaceExisting"), "false");
  assert.equal(ui.posts[0].body.get("sortOrder"), "1");
});

const refreshSource = source.slice(source.indexOf("  const hasPendingAvatar ="), source.indexOf("  const refreshDancerProfile ="));
test("draft and approved profiles refresh pending photos with one visible-page request at a time", async () => {
  for (const effectiveStatus of ["draft", "approved"]) {
    const ui = photoHarness();
    const requests = [], listeners = new Map();
    let cleanup, tick, resolveRequest;
    const visibility = { visibilityState: "visible", addEventListener: (event, handler) => listeners.set(event, handler), removeEventListener: event => listeners.delete(event) };
    runInNewContext(compile(refreshSource), {
      profile: { pending_photo_reviews: [pending()] }, effectiveStatus, isApproved: effectiveStatus === "approved",
      dancerPhotoItemsFromProfile: ui.mapProfile,
      useEffect: effect => { cleanup = effect(); },
      readSession: () => ({ accessToken: "fixture" }), AbortController, document: visibility,
      window: { setInterval: (handler, delay) => { assert.equal(delay, 8000); tick = handler; return 1; }, clearInterval: () => { tick = undefined; } },
      onProfileChange: next => ui.updateProfile(next),
      requestDancerProfileJson: options => { requests.push(options); return new Promise(resolve => { resolveRequest = resolve; }); },
    });
    assert.equal(requests.length, 1);
    await tick();
    assert.equal(requests.length, 1, "an in-flight refresh must not overlap");
    resolveRequest({ profile: { dancer_photos: [approved()] } }); await ui.settle();
    assert.deepEqual(ui.statuses, ["Approved"]);
    visibility.visibilityState = "hidden";
    await tick();
    assert.equal(requests.length, 1, "hidden pages must not poll");
    cleanup();
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(tick, undefined);
    assert.equal(listeners.size, 0);
  }
});

test("settled photos alone do not start a background refresh loop", () => {
  const ui = photoHarness();
  for (const effectiveStatus of ["draft", "approved"]) {
    runInNewContext(compile(refreshSource), {
      profile: { dancer_photos: [approved()] }, effectiveStatus, isApproved: effectiveStatus === "approved",
      dancerPhotoItemsFromProfile: ui.mapProfile, onProfileChange() {},
      useEffect: effect => assert.equal(effect(), undefined),
    });
  }
});
