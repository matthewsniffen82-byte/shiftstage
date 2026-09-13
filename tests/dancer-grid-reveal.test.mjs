import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const source = html.match(/function revealDancerGridTogether\(grid\) \{[\s\S]*?(?=\n    function renderHomeDancerGrid)/)[0];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const photo = (state, decode = () => Promise.resolve()) => ({ dataset: { imageState: state }, decode });

function harness(photos) {
  const observers = [];
  const grid = {
    photos,
    attributes: new Map([["data-grid-loading", "true"], ["aria-busy", "true"]]),
    querySelector() { return this.status; },
    querySelectorAll() { return this.photos; },
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const status = () => ({ parentNode: grid, remove() { this.parentNode = null; grid.status = null; } });
  grid.status = status();
  const ctx = vm.createContext({
    Promise,
    settleCompletedStableImages() {},
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
  });
  vm.runInContext(source, ctx);
  return {
    grid, observers,
    start() { ctx.revealDancerGridTogether(grid); },
    update() { observers.filter((observer) => observer.connected).forEach((observer) => observer.callback()); },
    replace(nextPhotos) { grid.status.parentNode = null; grid.status = status(); grid.photos = nextPhotos; },
  };
}

test("the entire grid waits for the last photo and its decoding before one reveal", async () => {
  let finishDecode;
  const last = photo("loading", () => new Promise((resolve) => { finishDecode = resolve; }));
  const h = harness([photo("ready"), last]);
  h.start();
  await flush();
  assert.equal(h.grid.attributes.get("data-grid-loading"), "true");
  last.dataset.imageState = "ready";
  h.update();
  await flush();
  assert.equal(h.grid.attributes.get("aria-busy"), "true");
  finishDecode();
  await flush();
  assert.equal(h.grid.attributes.size, 0);
  assert.equal(h.grid.status, null);
  assert.ok(h.observers.every((observer) => !observer.connected));
});

test("failed photos and decode rejections cannot keep the other cards hidden", async () => {
  const h = harness([
    photo("ready", () => Promise.reject(new Error("Decode failed"))),
    photo("error", () => assert.fail("Failed photos should not decode")),
  ]);
  h.start();
  await flush();
  assert.equal(h.grid.attributes.size, 0);
  assert.equal(h.grid.status, null);
});

test("a stale decode cannot reveal a replacement filter's cards", async () => {
  let finishOldDecode;
  const h = harness([photo("ready", () => new Promise((resolve) => { finishOldDecode = resolve; }))]);
  h.start();
  const newPhoto = photo("loading");
  h.replace([newPhoto]);
  h.start();
  h.update();
  finishOldDecode();
  await flush();
  assert.equal(h.grid.attributes.get("data-grid-loading"), "true");
  assert.ok(h.grid.status);
  newPhoto.dataset.imageState = "ready";
  h.update();
  await flush();
  assert.equal(h.grid.attributes.size, 0);
});

test("leaving the grid disconnects its observer and clears its loading state", () => {
  const h = harness([photo("loading")]);
  h.start();
  h.grid.status.remove();
  h.update();
  assert.equal(h.grid.attributes.size, 0);
  assert.ok(h.observers.every((observer) => !observer.connected));
});

test("cached photos and grids without photos reveal without waiting for another event", async () => {
  for (const photos of [[], [photo("ready"), photo("ready")]]) {
    const h = harness(photos);
    h.start();
    await flush();
    assert.equal(h.grid.attributes.size, 0);
    assert.equal(h.grid.status, null);
  }
});
