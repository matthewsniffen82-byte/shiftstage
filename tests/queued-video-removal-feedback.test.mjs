import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const studio = readFileSync(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8");
const handlers = studio.slice(studio.indexOf("  async function discardVideoUpload("), studio.indexOf("  async function uploadVideoBatch("));
const compiled = ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ reserved = true, saved = false } = {}) {
  const item = { id: "queue", uploadId: "upload", previewUrl: "blob:preview", reservationRequested: reserved, editorVenueId: "club" };
  const state = { queue: [item], batch: [item.uploadId], workspace: { videos: [] }, status: "", busy: false };
  const controller = new AbortController(), deletes = [], revoked = [];
  let resolve, reject;
  const context = vm.createContext({
    Error, mountedRef: { current: true }, queuedPreviewUrlsRef: { current: new Set([item.previewUrl]) },
    savedUploadIds: new Set(saved ? [item.uploadId] : []),
    URL: { revokeObjectURL: url => revoked.push(url) }, announceDancerProfileVideosChanged() {},
    beginVideoAction: () => state.busy ? null : { requestId: 1, controller },
    isCurrentVideoAction: () => !controller.signal.aborted, finishVideoAction: () => !controller.signal.aborted,
    setIsSubmitting: value => { state.busy = value; }, setStatus: value => { state.status = value; },
    setWorkspace: update => { state.workspace = update(state.workspace); },
    setQueuedVideos: update => { state.queue = update(state.queue); },
    setUploadBatchIds: update => { state.batch = update(state.batch); },
    requestDancerTvVideoJson: (id, options) => {
      deletes.push({ id, options });
      return new Promise((ok, fail) => { resolve = ok; reject = fail; });
    },
  });
  vm.runInContext(compiled, context);
  return { state, item, controller, deletes, revoked, remove: () => context.removeQueuedVideo(item),
    resolve: () => resolve(), reject: () => reject(new Error("Refresh the video status and try again.")) };
}

for (const flags of [{ reserved: true }, { reserved: false, saved: true }]) {
  test(`queue removal waits for the server, retains the preview on failure and can be retried (${JSON.stringify(flags)})`, async () => {
    const f = fixture(flags);
    const pending = f.remove();
    await f.remove();
    assert.equal(f.deletes.length, 1);
    assert.equal(f.deletes[0].options.headers["x-dancer-media-venue"], "club");
    assert.deepEqual(f.state.queue, [f.item]);
    f.reject(); await pending;
    assert.match(f.state.status, /refresh.*try again/i);
    assert.deepEqual(f.revoked, []);
    assert.deepEqual(f.state.batch, ["upload"]);
    assert.equal(f.state.busy, false);
    const retry = f.remove(); f.resolve(); await retry;
    assert.deepEqual(f.state.queue, []);
    assert.deepEqual(f.state.batch, []);
    assert.deepEqual(f.revoked, ["blob:preview"]);
    assert.match(f.state.status, /video removed/i);
  });
}

test("an invalid file can be removed locally while offline", async () => {
  const f = fixture({ reserved: false });
  await f.remove();
  assert.equal(f.deletes.length, 0);
  assert.deepEqual(f.state.queue, []);
  assert.match(f.state.status, /video removed/i);
});

test("a response after leaving the studio cannot change the next view", async () => {
  const f = fixture(), pending = f.remove();
  f.controller.abort(); f.resolve(); await pending;
  assert.deepEqual(f.state.queue, [f.item]);
  assert.equal(f.state.status, "");
});
