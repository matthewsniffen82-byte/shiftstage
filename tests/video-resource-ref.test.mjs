import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const source = readFileSync("src/lib/dancr/video-resource-ref.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = vm.createContext({ exports: {} });
vm.runInContext(compiled, context);
const { videoResourceRef } = context.exports;
function video() {
  return { paused: false, preload: "auto", dataset: { frameReady: "true" }, source: true, loads: 0, pauses: 0,
    pause() { this.paused = true; this.pauses++; },
    hasAttribute(name) { return name === "src" && this.source; },
    removeAttribute(name) { if (name === "src") this.source = false; },
    load() { this.loads++; } };
}
test("attaching preserves playback; detaching releases the exact retained element", () => {
  const active = video();
  const cleanup = videoResourceRef(active);
  assert.equal(active.pauses, 0);
  assert.equal(active.source, true);
  cleanup();
  assert.equal(active.paused, true);
  assert.equal(active.source, false);
  assert.equal(active.preload, "none");
  assert.equal(active.loads, 1);
  assert.equal(active.dataset.frameReady, undefined);
  cleanup();
  assert.equal(active.loads, 1, "an already released source is not loaded again");
});
test("removing one video never interrupts another mounted player", () => {
  const previous = video(), current = video();
  const cleanup = videoResourceRef(previous);
  videoResourceRef(current);
  cleanup();
  assert.equal(current.paused, false);
  assert.equal(current.source, true);
  assert.equal(current.loads, 0);
  assert.equal(videoResourceRef(null), undefined);
});
test("the profile uses one stable resource ref across ordinary renders", () => {
  const carousel = readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
  assert.match(carousel, /import \{ videoResourceRef \} from "@\/src\/lib\/dancr\/video-resource-ref"/);
  assert.match(carousel, /<video\s+ref=\{videoResourceRef\}/);
});
