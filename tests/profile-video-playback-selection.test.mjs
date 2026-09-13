import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
const start = source.indexOf("  function toggleViewerPlayback(");
const end = source.indexOf("  function viewerShareUrl(", start);
assert.ok(start >= 0 && end > start);
const handler = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(activeIndex, { unbufferedIndex } = {}) {
  const selections = [];
  const starts = [];
  const videos = [0, 1, 2].map((index) => ({
    paused: index !== activeIndex,
    src: index === unbufferedIndex ? "" : `/video-${index}.mp4`,
    dataset: { videoUrl: `/video-${index}.mp4` },
    hasAttribute(name) { return name === "src" && Boolean(this.src); },
    play() {
      assert.ok(this.src, "the selected source must be attached before playback");
      starts.push({ index, othersPlaying: videos.some((other) => other !== this && !other.paused) });
      this.paused = false;
      return Promise.resolve();
    },
    pause() { this.paused = true; },
  }));
  const context = vm.createContext({
    viewerIndex: activeIndex,
    playbackTapIndex: { current: null },
    viewerFeed: { current: { querySelectorAll: () => videos } },
    setViewer: (selection) => {
      selections.push({ ...selection });
      context.viewerIndex = selection.index;
    },
  });
  vm.runInContext(handler, context);
  return { videos, selections, starts, context, tap: (index) => context.toggleViewerPlayback(videos[index], index) };
}

test("tapping either buffered neighbor selects it and pauses other videos before playback", () => {
  for (const [active, selected] of [[0, 1], [1, 0]]) {
    const h = harness(active);
    h.tap(selected);
    assert.deepEqual(h.videos.map((video) => video.paused), [0, 1, 2].map((index) => index !== selected));
    assert.deepEqual(h.selections, [{ kind: "video", index: selected }]);
    assert.deepEqual(h.starts, [{ index: selected, othersPlaying: false }]);
    assert.equal(h.context.playbackTapIndex.current, selected);
  }
});

test("tapping an unbuffered video attaches only its source during the playback gesture", () => {
  const h = harness(0, { unbufferedIndex: 1 });
  h.videos[2].src = "";
  h.tap(1);
  assert.equal(h.videos[1].src, "/video-1.mp4");
  assert.equal(h.videos[2].src, "");
  assert.deepEqual(h.videos.map((video) => video.paused), [true, false, true]);
  assert.deepEqual(h.selections, [{ kind: "video", index: 1 }]);
  assert.deepEqual(h.starts, [{ index: 1, othersPlaying: false }]);
});

test("tapping the active video still pauses and resumes without changing selection", () => {
  const h = harness(1);
  h.tap(1);
  assert.equal(h.videos[1].paused, true);
  assert.equal(h.videos[1].dataset.userPaused, "true");
  h.tap(1);
  assert.equal(h.videos[1].paused, false);
  assert.equal(h.videos[1].dataset.userPaused, undefined);
  assert.deepEqual(h.selections, []);
  assert.deepEqual(h.starts, [{ index: 1, othersPlaying: false }]);
});
