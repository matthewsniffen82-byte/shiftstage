import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/video-autoplay-recovery.js", import.meta.url), "utf8");

function fixture() {
  let mutation, frame, plays = 0, scans = 0;
  const events = {}, videoEvents = {};
  class Element {
    constructor(video = false) { this.video = video; }
    matches() { return this.video; }
    querySelector() { return this.child || null; }
  }
  const slide = { dataset: {}, getAttribute: () => "true", classList: { add() {}, remove() {} } };
  const video = Object.assign(new Element(true), {
    paused: true, muted: true, closest: () => slide, setAttribute() {}, removeAttribute() {},
    addEventListener(name, callback) { videoEvents[name] = callback; },
    async play() { plays++; throw Object.assign(new Error("Autoplay denied"), { name: "NotAllowedError" }); },
  });
  const document = { documentElement: {}, visibilityState: "visible",
    querySelectorAll() { scans++; return [video]; }, querySelector: () => null,
    addEventListener(name, callback) { events[name] = callback; },
  };
  vm.runInNewContext(source, { document, Element,
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    requestAnimationFrame(callback) { frame = callback; return 1; }, cancelAnimationFrame() { frame = null; },
    window: { addEventListener(name, callback) { events[name] = callback; } },
  });
  const flush = async () => { const next = frame; frame = null; next?.(); await Promise.resolve(); await Promise.resolve(); };
  return { document, slide, events, videoEvents, video, Element, flush,
    mutate: records => mutation(records), counts: () => ({ plays, scans }) };
}

test("unrelated DOM updates cannot retrigger blocked autoplay or scan the feed", async () => {
  const f = fixture(); await f.flush();
  assert.deepEqual(f.counts(), { plays: 1, scans: 1 });
  for (let i = 0; i < 30; i++) {
    f.mutate([{ addedNodes: [{ nodeType: 3 }, new f.Element()], removedNodes: [] }]);
    await f.flush();
  }
  assert.deepEqual(f.counts(), { plays: 1, scans: 1 });
});

test("new video cards are prepared and repeated additions share one scan", async () => {
  const f = fixture(); await f.flush();
  const card = new f.Element(); card.child = f.video;
  for (let i = 0; i < 4; i++) f.mutate([{ addedNodes: [card], removedNodes: [] }]);
  await f.flush();
  assert.deepEqual(f.counts(), { plays: 2, scans: 2 });
  f.mutate([{ addedNodes: [f.video], removedNodes: [] }]); await f.flush();
  assert.equal(f.counts().scans, 3);
});

test("media readiness and page return still recover autoplay while manual pause is preserved", async () => {
  const f = fixture(); await f.flush();
  f.videoEvents.canplay(); await f.flush(); assert.equal(f.counts().plays, 2);
  f.document.visibilityState = "hidden"; f.videoEvents.loadeddata(); await f.flush();
  assert.equal(f.counts().plays, 2);
  f.document.visibilityState = "visible"; f.events.visibilitychange(); await f.flush();
  assert.equal(f.counts().plays, 3);
  f.slide.dataset.userPaused = "true"; f.events.pageshow(); await f.flush();
  assert.equal(f.counts().plays, 3);
});
