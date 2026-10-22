import assert from "node:assert/strict";
import test from "node:test";
import { metadataReaderFixture } from "./helpers/local-video-metadata.mjs";

for (const kind of ["dashboard", "legacy"]) {
  const released = f => {
    const state = f.state();
    assert.equal(state.urls, 0); assert.equal(state.timers, 0);
    assert.equal(state.paused, true); assert.equal(state.source, false);
    assert.equal(state.handlers, false); assert.equal(state.loads, 1);
  };
  test(`${kind}: inspect the original video without an editor and release resources`, async () => {
    const f = metadataReaderFixture(kind);
    f.video.onloadedmetadata(); await f.promise;
    assert.equal(f.state().outcome, "resolved");
    assert.deepEqual({ ...f.state().value }, { duration: 12, width: 720, height: 1280 });
    released(f);
  });
  test(`${kind}: timeout, unreadable, invalid and aborted videos release resources`, async () => {
    for (const action of ["timeout", "error", "duration", "landscape", "small", "abort"]) {
      const controller = new AbortController(), f = metadataReaderFixture(kind, { signal: controller.signal });
      if (action === "timeout") await f.expire();
      else if (action === "error") f.video.onerror();
      else if (action === "abort") controller.abort();
      else {
        if (action === "duration") f.video.duration = 31;
        if (action === "landscape") f.video.videoWidth = 1920;
        if (action === "small") f.video.videoWidth = 200;
        f.video.onloadedmetadata();
      }
      await f.promise;
      assert.equal(f.state().outcome, "rejected", action); released(f);
    }
  });
  test(`${kind}: accept 30 seconds and 25 MB; reject bad files before allocating video resources`, async () => {
    const allowed = metadataReaderFixture(kind, { file: { type: "video/quicktime", size: 25 * 1024 * 1024 } });
    allowed.video.duration = 30; allowed.video.onloadedmetadata(); await allowed.promise;
    assert.equal(allowed.state().outcome, "resolved"); released(allowed);
    const controller = new AbortController(); controller.abort();
    for (const options of [
      { file: { type: "video/mp4", size: 25 * 1024 * 1024 + 1 } },
      { file: { type: "image/jpeg", size: 100 } },
      { file: { type: "video/mp4", size: 0 } },
      { signal: controller.signal },
    ]) {
      const f = metadataReaderFixture(kind, options); await f.promise;
      assert.equal(f.state().outcome, "rejected");
      assert.equal(f.state().urls, 0); assert.equal(f.state().timers, 0); assert.equal(f.state().loads, 0);
    }
  });
}

for (const kind of ['dashboard', 'legacy']) test(`${kind}: videos over 30 seconds are explicitly rejected before uploading`, async () => {
  const f = metadataReaderFixture(kind); f.video.duration = 30.001; f.video.onloadedmetadata(); await f.promise;
  assert.equal(f.state().outcome, 'rejected'); assert.equal(f.state().value, 'Over 30 seconds');
  assert.equal(f.state().urls, 0); assert.equal(f.state().timers, 0);
});
