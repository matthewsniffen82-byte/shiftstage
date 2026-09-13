import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { hasVideoWarmupBuffer, observeVideoWarmup } from "../src/lib/dancr/video-buffer-policy.ts";

const shell = readFileSync("outputs/index.html", "utf8");
const context = vm.createContext({});
for (const name of ["hasVideoWarmupBuffer", "observeVideoWarmup"]) {
  const source = shell.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"))?.[0];
  assert.ok(source);
  vm.runInContext(source, context);
}

function player() {
  const video = new EventTarget();
  Object.assign(video, { currentTime: 0, duration: 15, readyState: 2, ranges: [[0, .5]] });
  video.buffered = {
    get length() { return video.ranges.length; },
    start: index => video.ranges[index][0], end: index => video.ranges[index][1],
  };
  return video;
}

for (const [surface, hasBuffer, observe] of [
  ["React profile", hasVideoWarmupBuffer, observeVideoWarmup],
  ["live TV and profile", context.hasVideoWarmupBuffer, context.observeVideoWarmup],
]) {
  test(`${surface}: adaptive warmup starts with a playable first segment and reacts to MSE appends`, () => {
    const video = player(); video.dataset = { adaptiveUrl: '/manifest' };
    let changes = 0; const cleanup = observe(video, () => changes++);
    video.ranges = [[0, 1.95]];
    video.dispatchEvent(new Event('mydancrvideobufferchange'));
    assert.equal(hasBuffer(video), true); assert.equal(changes, 1);
    video.dataset = {};
    assert.equal(hasBuffer(video), false, 'progressive downloads retain the larger safety margin');
    cleanup();
  });

  test(`${surface}: spare buffer is required before neighboring downloads`, () => {
    const video = player();
    assert.equal(hasBuffer(null), false);
    assert.equal(hasBuffer(video), false, "first frame with .5 seconds buffered is insufficient");
    video.ranges = [[0, 4]];
    assert.equal(hasBuffer(video), true);
    video.currentTime = 3;
    assert.equal(hasBuffer(video), false, "measure ahead of the playhead, not total downloaded seconds");
    video.ranges = [[0, 4], [6, 15]];
    assert.equal(hasBuffer(video), false, "a later range cannot bridge a seek gap");
    video.currentTime = 6;
    assert.equal(hasBuffer(video), true);
    video.readyState = 0;
    assert.equal(hasBuffer(video), false, "wait for a decoded frame too");
  });

  test(`${surface}: short and nearly completed clips still prepare both directions`, () => {
    const video = player();
    video.duration = 2;
    video.ranges = [[0, 1.99]];
    assert.equal(hasBuffer(video), true, "allow media timeline rounding at the end");
    video.duration = 15;
    video.currentTime = 14;
    video.ranges = [[10, 15]];
    assert.equal(hasBuffer(video), true);
    video.duration = NaN;
    assert.equal(hasBuffer(video), false);
    video.duration = Infinity;
    assert.equal(hasBuffer(video), false);
  });

  test(`${surface}: progress changes eligibility without repeated work or lingering listeners`, () => {
    const video = player();
    let changes = 0;
    const cleanup = observe(video, () => changes++);
    for (let i = 0; i < 30; i++) video.dispatchEvent(new Event("progress"));
    assert.equal(changes, 0);
    video.ranges = [[0, 4]];
    for (let i = 0; i < 30; i++) video.dispatchEvent(new Event("progress"));
    assert.equal(changes, 1, "one synchronization when enough buffer arrives");
    video.currentTime = 3.9;
    video.dispatchEvent(new Event("waiting"));
    assert.equal(changes, 2, "retain neighbors when the active clip stalls");
    cleanup();
    video.ranges = [[0, 15]];
    for (const type of ["loadeddata", "progress", "waiting", "emptied"]) video.dispatchEvent(new Event(type));
    assert.equal(changes, 2, "cleanup prevents updates after viewer changes or unmount");
  });
}
