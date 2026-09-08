import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

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
function photoHarness({ profile = {}, post = async () => ({ decision: "review", moderationRecordId: "review", photo: { id: "review", sortOrder: 1 } }), read = async () => ({ profile: { dancer_photos: [approved()] } }) } = {}) {
  const slots = [], posts = [], reads = [], profiles = [];
  let cursor = 0, effects = [], dirty = true, tree;
  const exports = {};
  runInNewContext(code, {
    exports, MAX_DANCER_PROFILE_PHOTOS: 30,
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
    URL: { createObjectURL: () => "blob:fixture", revokeObjectURL() {} },
    FormData, AbortController, Event, crypto: globalThis.crypto,
    window: { dispatchEvent() {}, confirm: () => true },
  });
  function render() {
    for (let count = 0; dirty && count < 20; count++) {
      dirty = false; cursor = 0; effects = [];
      tree = exports.DancerPhotoPanel({ profile, deletedPhotoIds: empty, deletedPhotoStoragePaths: empty, onProfileChange: next => profiles.push(next) });
      effects.forEach(effect => effect());
    }
    assert.equal(dirty, false, "photo updates must settle without looping");
  }
  function nodes(node = tree) {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  }
  render();
  return {
    posts, reads, profiles, mapProfile: exports.dancerPhotoItemsFromProfile,
    get cards() { return nodes().filter(node => /^(photo-review-card|photo-saved-preview)/.test(node.props?.className || "")); },
    get labels() { return this.cards.map(card => nodes(card).find(node => node.type === "strong").props.children); },
    get statuses() { return this.cards.map(card => nodes(card).find(node => node.type === "small").props.children); },
    get notes() { return nodes().filter(node => node.type === "em").map(node => node.props.children); },
    get buttons() { return nodes().filter(node => node.type === "button"); },
    select() {
      nodes().find(node => node.props?.["aria-label"] === "Choose profile photos from your library").props.onChange({ target: { files: [new File(["fixture"], "solo.jpg", { type: "image/jpeg" })], value: "" } });
      render();
    },
    updateProfile(next) { profile = next; dirty = true; render(); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}

test("fresh approval replaces a locally checking photo even when the review and saved photo have different IDs", async () => {
  const ui = photoHarness();
  ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ["Approved"]);
  assert.equal(ui.cards[0].props.className, "photo-saved-preview is-approved");
  assert.deepEqual(ui.notes, []);
  assert.equal(ui.posts.length, 1);
  assert.equal(ui.buttons.some(button => button.props.children === "Retry"), false);
});

test("a real pending replacement stays checking until the server approves it", async () => {
  const ui = photoHarness({ read: async () => ({ profile: { dancer_photos: [approved("old")], pending_photo_reviews: [pending()] } }) });
  ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ["Checking"]);
  assert.deepEqual(ui.notes, []);
  ui.updateProfile({ dancer_photos: [approved("replacement")] });
  assert.deepEqual(ui.statuses, ["Approved"]);
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

test("an avatar stays separate and gallery photos have no main-photo action", () => {
  const ui = photoHarness({ profile: { avatarPhotoUrl: "/avatar.jpg", dancer_photos: [approved()] } });
  assert.deepEqual(ui.labels, ["Photo 1"]);
  assert.equal(ui.cards.length, 1);
  assert.equal(ui.buttons.some(button => button.props.children === "Make main"), false);
});

test("all gallery photos can be reordered without changing the avatar or showing a main label", async () => {
  const ui = photoHarness({
    profile: { avatarPhotoUrl: "/avatar.jpg", dancer_photos: [approved("first", 0, true), approved("second", 1)] },
    read: async () => ({ profile: { avatarPhotoUrl: "/avatar.jpg", dancer_photos: [approved("second", 0, true), approved("first", 1)] } }),
  });
  assert.equal(ui.buttons.some(button => button.props.className === "photo-order-action"), false);
  ui.buttons.find(button => button.props["aria-label"] === "Reorder photos").props.onClick();
  await ui.settle();
  ui.buttons.find(button => button.props["aria-label"] === "Move Photo 2 earlier").props.onClick();
  await ui.settle();
  assert.deepEqual(JSON.parse(ui.reads[0].body), { mainPhotoUrl: "/second.jpg", galleryPhotoUrls: ["/first.jpg"] });
  assert.deepEqual(ui.labels, ["Photo 1", "Photo 2"]);
  assert.equal(ui.buttons.some(button => button.props.children === "Make main"), false);
  assert.equal(ui.profiles[0].avatarPhotoUrl, "/avatar.jpg");
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
