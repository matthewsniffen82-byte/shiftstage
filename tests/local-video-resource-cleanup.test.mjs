import assert from "node:assert/strict";
import test from "node:test";
import { metadataReaderFixture } from "./helpers/local-video-metadata.mjs";

for (const kind of ["legacy", "dashboard"]) {
  function assertReleased(fixture) {
    const state = fixture.state();
    assert.equal(state.urls, 0);
    assert.equal(state.timers, 0);
    assert.equal(state.source, false);
    assert.equal(state.handlers, false);
    assert.equal(state.paused, true);
    assert.equal(state.loads, 1);
  }
  test(`${kind}: successful metadata preserves dimensions and releases temporary media`, async () => {
    const fixture = metadataReaderFixture(kind);
    fixture.video.onloadedmetadata();
    await fixture.promise;
    assert.equal(fixture.state().outcome, "resolved");
    assert.equal(fixture.state().value.duration, 12);
    assert.equal(fixture.state().value.width, 720);
    assert.equal(fixture.state().value.height, 1280);
    assertReleased(fixture);
  });
  test(`${kind}: unreadable and invalid videos release their temporary media`, async () => {
    for (const invalidDimensions of [false, true]) {
      const fixture = metadataReaderFixture(kind);
      if (invalidDimensions) { fixture.video.videoHeight = 100; fixture.video.onloadedmetadata(); }
      else fixture.video.onerror();
      await fixture.promise;
      assert.equal(fixture.state().outcome, "rejected");
      assertReleased(fixture);
    }
  });
  test(`${kind}: a browser that never emits metadata cannot retain the file indefinitely`, async () => {
    const fixture = metadataReaderFixture(kind);
    assert.equal([...fixture.timers.values()][0].delay, 20_000);
    await fixture.expire();
    await fixture.promise;
    assert.equal(fixture.state().outcome, "rejected");
    assert.match(fixture.state().value, /too long to read/);
    assertReleased(fixture);
  });
}
