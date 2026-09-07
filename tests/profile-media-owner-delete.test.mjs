import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const shell = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const carousel = await readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8");
const dancer = await readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8");
const tv = await readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8");
const start = shell.indexOf("    const deletedProfileMedia = new Set();");
const end = shell.indexOf("    function profilePhotoThumbMarkup", start);
assert.ok(start > 0 && end > start);

function setup({ confirm = true, ok = true, role = "dancer" } = {}) {
  const calls = [];
  const messages = [];
  const gallery = {
    dataset: { profileMediaProfile: "owner" },
    profilePhotoItems: [{ id: "p1" }, { id: "p2" }],
    profileTvVideos: [{ id: "v1" }, { id: "v2" }],
    innerHTML: "grid",
  };
  const context = vm.createContext({
    modalGallery: gallery,
    profilePhotoViewerStatus: { textContent: "" },
    document: { getElementById: () => null },
    authSession: { accessToken: "token", account: { role } },
    isDancerSession: () => role === "dancer",
    getAuthenticatedJson: async () => ({ ok: true, profile: { id: "owner" } }),
    window: { confirm: () => confirm },
    authenticatedRequestHeaders: () => ({ Authorization: "Bearer token" }),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok, json: async () => ({ ok, error: ok ? undefined : "Please try again" }) };
    },
    applyResponseSession: () => {},
    profileNavigationPrefetchCache: new Map([["cached", {}]]),
    closeProfilePhotoViewer: () => calls.push("closePhoto"),
    closeProfileTvViewer: () => calls.push("closeVideo"),
    appendNextProfileMediaBatch: () => {},
    syncProfileMediaTabCounts: (photos, videos) => calls.push({ photos, videos }),
    setProfileMediaTab: () => {},
    modalMediaPhotoTab: { focus() {} },
    modalMediaTvTab: { focus() {} },
    showToast: (message) => messages.push(message),
    hydrateDancerApprovalProgress: async () => {},
  });
  vm.runInContext(shell.slice(start, end), context);
  vm.runInContext("syncProfileMediaDeleteControls = () => {};", context);
  return { context, gallery, calls, messages };
}

test("delete controls require the verified profile owner and current dancer session", async () => {
  for (const role of ["customer", "venue", "admin", "dancer"]) {
    const { context } = setup({ role });
    await context.verifyProfileMediaOwner("owner");
    assert.equal(context.ownsOpenProfileMedia(), role === "dancer");
    context.modalGallery.dataset.profileMediaProfile = "someone-else";
    assert.equal(context.ownsOpenProfileMedia(), false);
  }
  const { context } = setup();
  await context.verifyProfileMediaOwner("owner");
  context.authSession.accessToken = "different-account";
  assert.equal(context.ownsOpenProfileMedia(), false);
});

test("late ownership responses cannot enable deletion on a different profile", async () => {
  const { context } = setup();
  let finish;
  context.getAuthenticatedJson = () => new Promise((resolve) => { finish = resolve; });
  const pending = context.verifyProfileMediaOwner("owner");
  context.modalGallery.dataset.profileMediaProfile = "other";
  finish({ ok: true, profile: { id: "owner" } });
  await pending;
  assert.equal(context.ownsOpenProfileMedia(), false);
});

test("canceling confirmation never sends a deletion or changes the grid", async () => {
  const { context, gallery, calls } = setup({ confirm: false });
  await context.verifyProfileMediaOwner("owner");
  await context.deleteOpenProfileMedia("photo", { id: "p1" });
  assert.equal(calls.length, 0);
  assert.equal(gallery.profilePhotoItems.length, 2);
});

for (const kind of ["photo", "video"]) {
  test(`confirmed ${kind} deletion removes only the selected item and updates counts`, async () => {
    const { context, gallery, calls } = setup();
    await context.verifyProfileMediaOwner("owner");
    await context.deleteOpenProfileMedia(kind, { id: kind === "photo" ? "p1" : "v1" });
    const request = calls[0];
    assert.equal(request.options.method, "DELETE");
    assert.equal(request.url, kind === "photo" ? "/api/dancer/photos" : "/api/dancer/tv/videos/v1");
    if (kind === "photo") assert.deepEqual(JSON.parse(request.options.body), { photoId: "p1" });
    assert.equal(gallery.profilePhotoItems.length, kind === "photo" ? 1 : 2);
    assert.equal(gallery.profileTvVideos.length, kind === "video" ? 1 : 2);
    assert.equal(context.profileNavigationPrefetchCache.size, 0);
    assert.ok(calls.some((call) => call.photos === gallery.profilePhotoItems.length && call.videos === gallery.profileTvVideos.length));
  });
}

test("failed deletion leaves media available and reports the failure", async () => {
  const { context, gallery, calls, messages } = setup({ ok: false });
  await context.verifyProfileMediaOwner("owner");
  await context.deleteOpenProfileMedia("photo", { id: "p1" });
  assert.equal(gallery.profilePhotoItems.length, 2);
  assert.equal(calls.length, 1);
  assert.match(messages[0], /try again/);
});

test("duplicate taps cannot submit a second deletion while the first is pending", async () => {
  const { context } = setup();
  await context.verifyProfileMediaOwner("owner");
  let finish;
  let requests = 0;
  context.fetch = () => { requests += 1; return new Promise((resolve) => { finish = resolve; }); };
  const pending = context.deleteOpenProfileMedia("photo", { id: "p1" });
  await context.deleteOpenProfileMedia("photo", { id: "p1" });
  assert.equal(requests, 1);
  finish({ ok: true, json: async () => ({ ok: true }) });
  await pending;
});

test("React grid and viewer share confirmed owner deletion and preserve media until success", () => {
  assert.match(carousel, /data\.profile\?\.id === dancerId/);
  assert.match(carousel, /className="profile-media-grid-cell"/);
  assert.match(carousel, /className="profile-media-delete"[^>]*onClick=\{\(\) => void deleteMedia\(item\)\}/);
  assert.match(carousel, /className="profile-media-viewer-delete"[^>]*onClick=\{\(\) => void deleteMedia\(activeViewerItem\)\}/);
  assert.ok(carousel.indexOf("if (!window.confirm") < carousel.indexOf('method: "DELETE"'));
  assert.ok(carousel.indexOf("if (!response.ok || !data.ok)") < carousel.indexOf("setDeletedMedia((current)"));
  assert.match(dancer, /\.eq\("id", photoId\)[\s\S]*?\.eq\("dancer_id", profile\.id\)/);
  assert.match(tv, /function hideOwnMyDancrTvVideo[\s\S]*?\.eq\("id", videoId\)[\s\S]*?\.eq\("submitted_by", userId\)/);
});
