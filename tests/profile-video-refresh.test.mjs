import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = ["12-sync-profile-photo-viewer-window", "13-open-profile-modal"]
  .map(name => readFileSync(`src/live-shell/app/${name}.js`, "utf8")).join("\n");
const functionSource = name => source.match(new RegExp(`    (?:async )?function ${name}\\([^]*?\\n    \\}`))[0];
const profile = { id: "11111111-1111-4111-8111-111111111111", name: "Dancer", status: "Verified" };

function harness() {
  const requests = [], renders = [], counts = [];
  const gallery = {
    dataset: { profileMediaProfile: profile.id },
    parentElement: { querySelector: () => null },
    querySelectorAll: () => [],
    before() {},
  };
  const tab = { setAttribute() {}, removeAttribute() {} };
  const context = vm.createContext({
    modalGallery: gallery, modalMediaTvTab: tab, modalMediaTvCount: {},
    citySelect: { value: "Las Vegas" }, PROFILE_MEDIA_PAGE_SIZE: 12, MAX_DANCER_PROFILE_VIDEOS: 50,
    profileMediaObserver: null, profileMediaLastAppendScrollTop: 0,
    profilePhotoGalleryItems: () => [], profileMediaSentinel() {}, observeProfileMediaSentinel() {},
    window: { requestAnimationFrame() {} },
    document: { createElement: () => ({ dataset: {}, addEventListener() {} }) },
    renderProfileMediaLibrary: () => renders.push([...gallery.profileTvVideos]),
    syncProfileMediaTabCounts: (photos, videos) => counts.push(videos),
    requestProfileTvPayload: () => new Promise(resolve => requests.push(resolve)),
  });
  vm.runInContext(["initializeProfileMediaLibrary", "loadProfileMyDancrTv"].map(functionSource).join("\n"), context);
  context.initializeProfileMediaLibrary(profile, 0);
  return { context, gallery, requests, renders, counts };
}

test("same-profile reload retains video thumbnails while waiting and applies reorder/removal afterward", async () => {
  const ui = harness();
  let pending = ui.context.loadProfileMyDancrTv(profile);
  const videos = [{ id: "one" }, { id: "two" }];
  ui.requests.shift()({ ok: true, videos }); await pending;
  ui.context.initializeProfileMediaLibrary(profile, 0);
  assert.deepEqual([...ui.gallery.profileTvVideos], videos);
  pending = ui.context.loadProfileMyDancrTv(profile);
  assert.deepEqual([...ui.gallery.profileTvVideos], videos, "a pending request must not blank the grid");
  assert.equal(ui.gallery.profileVisibleVideoCount, 2);
  ui.requests.shift()({ ok: true, videos: [videos[1]] }); await pending;
  assert.deepEqual([...ui.gallery.profileTvVideos], [videos[1]]);
  assert.equal(ui.gallery.profileVisibleVideoCount, 1);
  assert.equal(ui.counts.at(-1), 1);
});

test("profile or visibility-context changes clear old previews and invalidate pending requests", async () => {
  for (const next of [{ ...profile, id: "22222222-2222-4222-8222-222222222222" }, { ...profile, internalRoster: true }, { ...profile, status: "Pending" }]) {
    const ui = harness();
    ui.gallery.profileTvVideos = [{ id: "old" }];
    const pending = ui.context.loadProfileMyDancrTv(profile);
    ui.context.initializeProfileMediaLibrary(next, 0);
    assert.equal(ui.gallery.profileTvVideos.length, 0);
    ui.requests.shift()({ ok: true, videos: [{ id: "stale" }] }); await pending;
    assert.equal(ui.gallery.profileTvVideos.length, 0, "a stale response cannot restore the previous profile");
  }
});

test("failed refresh removes unconfirmed videos and an older request cannot overwrite a newer result", async () => {
  const ui = harness();
  ui.gallery.profileTvVideos = [{ id: "old" }];
  const old = ui.context.loadProfileMyDancrTv(profile);
  const recent = ui.context.loadProfileMyDancrTv(profile);
  ui.requests[1]({ ok: true, videos: [{ id: "current" }] }); await recent;
  ui.requests[0]({ ok: true, videos: [{ id: "stale" }] }); await old;
  assert.equal(ui.gallery.profileTvVideos[0].id, "current");
  const failed = ui.context.loadProfileMyDancrTv(profile);
  ui.requests[2](null); await failed;
  assert.equal(ui.gallery.profileTvVideos.length, 0);
  assert.equal(ui.gallery.profileVisibleVideoCount, 0);
  assert.equal(ui.counts.at(-1), 0);
});
