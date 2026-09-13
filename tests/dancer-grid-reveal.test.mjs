import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const source = html.match(/function revealDancerGridRows\(grid\) \{[\s\S]*?(?=\n    function renderHomeDancerGrid)/)[0];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const photo = (state, decode = () => Promise.resolve()) => ({ dataset: { imageState: state }, decode });
function card(image = photo("ready")) {
  return {
    attributes: new Map(),
    matches: () => true,
    querySelectorAll: () => image ? [image] : [],
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
  };
}
const heading = () => ({ matches: () => false });
const loading = (card) => card.attributes.get("data-row-loading") === "true";

function harness(children) {
  const observers = [];
  const grid = { children };
  children.forEach((child) => { child.parentNode = grid; });
  const ctx = vm.createContext({
    Promise,
    settleCompletedStableImages() {},
    homeTvLandingPreload: { schedule() {} },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
  });
  vm.runInContext(source, ctx);
  return {
    grid, observers,
    start() { ctx.revealDancerGridRows(grid); },
    update() { observers.filter((observer) => observer.connected).forEach((observer) => observer.callback()); },
    replace(next) {
      grid.children.forEach((child) => { child.parentNode = null; });
      grid.children = next;
      next.forEach((child) => { child.parentNode = grid; });
    },
  };
}

test("a ready row appears while another waits, and each row waits for all three photos to decode", async () => {
  let finishDecode;
  const delayed = photo("loading", () => new Promise((resolve) => { finishDecode = resolve; }));
  const first = [card(), card(delayed), card()];
  const second = [card(), card(), card()];
  const h = harness([...first, ...second]);
  h.start();
  await flush();
  assert.ok(first.every(loading));
  assert.ok(second.every((item) => !loading(item)));
  delayed.dataset.imageState = "ready";
  h.update();
  await flush();
  assert.ok(first.every(loading));
  finishDecode();
  await flush();
  assert.ok(first.every((item) => !loading(item)));
  assert.ok(h.observers.every((observer) => !observer.connected));
});

test("section headings start new rows and incomplete rows reveal independently", async () => {
  const delayed = card(photo("loading"));
  const ready = [card(), card()];
  const h = harness([heading(), delayed, heading(), ...ready]);
  h.start();
  await flush();
  assert.equal(loading(delayed), true);
  assert.ok(ready.every((item) => !loading(item)));
});

test("failed photos and decode rejections cannot keep a row hidden", async () => {
  const cards = [card(photo("ready", () => Promise.reject(new Error("Decode failed")))), card(photo("error", () => assert.fail("Failed photos should not decode"))), card()];
  const h = harness(cards);
  h.start();
  await flush();
  assert.ok(cards.every((item) => item.attributes.size === 0));
});

test("a stale decode cannot reveal a replacement filter's row", async () => {
  let finishOldDecode;
  const h = harness([card(photo("ready", () => new Promise((resolve) => { finishOldDecode = resolve; })))]);
  h.start();
  const newPhoto = photo("loading");
  const newCard = card(newPhoto);
  h.replace([newCard]);
  h.start();
  h.update();
  finishOldDecode();
  await flush();
  assert.equal(loading(newCard), true);
  newPhoto.dataset.imageState = "ready";
  h.update();
  await flush();
  assert.equal(loading(newCard), false);
});

test("leaving the grid disconnects its row observer", () => {
  const h = harness([card(photo("loading"))]);
  h.start();
  h.replace([]);
  h.update();
  assert.ok(h.observers.every((observer) => !observer.connected));
});

test("cached photos, initials-only cards and empty grids need no further load event", async () => {
  for (const cards of [[], [card(), card(null)]]) {
    const h = harness(cards);
    h.start();
    await flush();
    assert.ok(cards.every((item) => item.attributes.size === 0));
    assert.ok(h.observers.every((observer) => !observer.connected));
  }
});
