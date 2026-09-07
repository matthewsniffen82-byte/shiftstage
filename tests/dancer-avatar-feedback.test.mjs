import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { AVATAR_REJECTED_MESSAGE, avatarUploadPresentation } from "../app/dashboard/avatar-upload-state.ts";
import { DashboardDataRequestError, persistDashboardSession, requestDancerAvatarJson } from "../app/dashboard/dashboard-session.ts";

const source = await readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const component = source.slice(source.indexOf("function DancerAvatarPanel("), source.indexOf("\nfunction DancerShiftPanel("));
const code = ts.transpileModule(`${component}\nexport { DancerAvatarPanel };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Drive the real component's event handlers and effects without a server or production uploads.
function avatarHarness({ profile = {}, post = async () => ({ decision: "approved", moderationRecordId: "new" }), read = async () => ({ profile: { avatarPhotoUrl: "approved.jpg" } }) } = {}) {
  const slots = [], revoked = [], posts = [];
  let cursor = 0, effects = [], dirty = true, tree, busy = false, blobId = 0;
  const exports = {};
  const reportBusy = value => { busy = value; };
  runInNewContext(code, {
    exports, require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }),
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => {
        const next = typeof value === "function" ? value(slots[index]) : value;
        if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true; }
      }];
    },
    useRef(initial) { const index = cursor++; return slots[index] ||= { current: initial }; },
    useContext: () => reportBusy,
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
      }
    },
    AvatarUploadBusyContext: {}, AVATAR_REJECTED_MESSAGE, avatarUploadPresentation, DashboardDataRequestError,
    readSession: () => ({ accessToken: "fixture" }),
    requestDancerAvatarJson: options => { posts.push(options); return post(options); },
    requestDancerProfileJson: options => read(options),
    URL: { createObjectURL: () => `blob:avatar-${++blobId}`, revokeObjectURL: url => revoked.push(url) },
    FormData, AbortController, crypto: globalThis.crypto, window: { confirm: () => true },
  });
  function render() {
    for (let count = 0; dirty && count < 20; count++) {
      dirty = false; cursor = 0; effects = [];
      tree = exports.DancerAvatarPanel({ profile, onProfileChange: next => { profile = next; dirty = true; } });
      effects.forEach(effect => effect());
    }
    assert.equal(dirty, false, "background updates must settle without a render loop");
  }
  function nodes(node = tree) {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  }
  function select(file = new File(["fixture"], "avatar.jpg", { type: "image/jpeg" })) {
    nodes().find(node => node.props?.["aria-label"] === "Choose avatar from your photo library").props.onChange({ target: { files: file ? [file] : [], value: "" } });
    render();
  }
  render();
  return {
    select, revoked, posts,
    get busy() { return busy; },
    get badge() { return nodes().find(node => node.props?.className?.startsWith("dancer-avatar-state"))?.props.children; },
    get image() { return nodes().find(node => node.type === "img")?.props.src; },
    get approvedPreview() { return nodes().find(node => node.props?.["data-avatar-approved-preview"]); },
    get message() { return nodes().find(node => node.props?.role === "status")?.props.children; },
    get retry() { return nodes().find(node => node.type === "button" && node.props.children === "Retry avatar upload"); },
    updateProfile(next) { profile = next; dirty = true; render(); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}

test("a no-face rejection is explicit and cannot retry the rejected file", async () => {
  const ui = avatarHarness({ post: async () => { throw new DashboardDataRequestError("Choose a clear face photo.", 422); } });
  ui.select();
  assert.equal(ui.badge, "Checking");
  assert.equal(ui.busy, true);
  await ui.settle();
  assert.equal(ui.badge, "Not approved");
  assert.equal(ui.message, AVATAR_REJECTED_MESSAGE);
  assert.equal(ui.retry, undefined);
  assert.equal(ui.image, "blob:avatar-1");
  assert.deepEqual(ui.revoked, []);
  assert.equal(ui.busy, false);
});

test("confirmed approval survives a failed profile refresh without offering another upload", async () => {
  const ui = avatarHarness({ read: async () => { throw new Error("offline"); } });
  ui.select();
  await ui.settle();
  assert.equal(ui.badge, "Approved");
  assert.match(ui.message, /Avatar approved and saved/);
  assert.equal(ui.retry, undefined);
  assert.equal(ui.posts.length, 1);
  assert.equal(ui.image, "blob:avatar-1");
  assert.deepEqual(ui.revoked, []);
});

test("only a failed request offers retry and it reuses the original idempotency key", async () => {
  let attempts = 0;
  const ui = avatarHarness({ post: async () => {
    if (++attempts === 1) throw new Error("Connection lost. Try again.");
    return { decision: "approved", moderationRecordId: "new" };
  } });
  ui.select(); await ui.settle();
  assert.equal(ui.badge, "Not uploaded");
  assert.ok(ui.retry);
  await ui.retry.props.onClick(); await ui.settle();
  assert.equal(ui.badge, "Approved");
  assert.equal(ui.retry, undefined);
  assert.equal(ui.posts[0].headers["idempotency-key"], ui.posts[1].headers["idempotency-key"]);
});

test("the selected preview changes to the approved centered image only after it loads", async () => {
  const ui = avatarHarness({ read: async () => ({ profile: { avatarPhotoUrl: "centered.jpg", avatar_review: { id: "new", decision: "approved" } } }) });
  ui.select(); await ui.settle();
  assert.equal(ui.image, "blob:avatar-1");
  assert.equal(ui.approvedPreview.props.src, "centered.jpg");
  ui.approvedPreview.props.onLoad(); await ui.settle();
  assert.equal(ui.image, "centered.jpg");
  assert.equal(ui.badge, "Approved");
  assert.equal(ui.retry, undefined);
  assert.deepEqual(ui.revoked, ["blob:avatar-1"]);
});

test("background approval and rejection settle the current pending upload without flickering its preview", async () => {
  for (const decision of ["approved", "rejected"]) {
    const ui = avatarHarness({ post: async () => ({ decision: "review", moderationRecordId: "new" }), read: async () => ({ profile: { pending_avatar_review: { id: "new", previewUrl: "signed-1" } } }) });
    ui.select(); await ui.settle();
    assert.equal(ui.badge, "Checking");
    assert.equal(ui.retry, undefined);
    ui.updateProfile({ pending_avatar_review: { id: "new", previewUrl: "signed-2" } });
    assert.equal(ui.image, "blob:avatar-1");
    ui.updateProfile({ avatar_review: { id: "new", decision }, avatarPhotoUrl: decision === "approved" ? "approved.jpg" : "" });
    assert.equal(ui.badge, decision === "approved" ? "Approved" : "Not approved");
    assert.equal(ui.image, "blob:avatar-1");
    assert.deepEqual(ui.revoked, []);
    assert.equal(ui.retry, undefined);
  }
});

test("reopened pending previews keep their source stable through refreshed signed URLs", () => {
  const ui = avatarHarness({ profile: { pending_avatar_review: { id: "same", previewUrl: "signed-1" } } });
  ui.updateProfile({ pending_avatar_review: { id: "same", previewUrl: "signed-2" } });
  assert.equal(ui.image, "signed-1");
  assert.equal(ui.badge, "Checking");
  ui.updateProfile({ pending_avatar_review: { id: "different", previewUrl: "signed-3" } });
  assert.equal(ui.image, "signed-3");
});

test("canceling the picker leaves the existing avatar and status intact", () => {
  const ui = avatarHarness({ profile: { avatarPhotoUrl: "approved.jpg" } });
  ui.select(null);
  assert.equal(ui.image, "approved.jpg");
  assert.equal(ui.badge, "Approved");
  assert.equal(ui.posts.length, 0);
});

test("invalid file feedback does not claim an upload started or offer a futile retry", async () => {
  const ui = avatarHarness();
  ui.select(new File(["not an image"], "note.txt", { type: "text/plain" }));
  await ui.settle();
  assert.equal(ui.badge, "Not uploaded");
  assert.match(ui.message, /Choose a JPEG/);
  assert.equal(ui.retry, undefined);
  assert.equal(ui.posts.length, 0);
});

test("a rejected replacement does not label the existing approved image as rejected on reopening", () => {
  const ui = avatarHarness({ profile: { avatarPhotoUrl: "approved.jpg", avatar_review: { id: "rejected-replacement", decision: "rejected" } } });
  assert.equal(ui.badge, "Approved");
  assert.equal(ui.image, "approved.jpg");
  assert.match(ui.message, /New avatar not approved/);
  assert.equal(ui.retry, undefined);
});

test("the avatar request preserves a structured rejection while ordinary 422 errors remain errors", async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const stored = new Map();
  globalThis.window = { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } };
  try {
    persistDashboardSession({ accessToken: "fixture", refreshToken: "fixture-refresh", account: { id: "owner", role: "dancer" } });
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, decision: "rejected", moderationRecordId: "r" }), { status: 422 });
    assert.equal((await requestDancerAvatarJson({ method: "POST" })).decision, "rejected");
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "Choose a clear face photo." }), { status: 422 });
    await assert.rejects(requestDancerAvatarJson({ method: "POST" }), error => error instanceof DashboardDataRequestError && error.status === 422);
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch; }
});
