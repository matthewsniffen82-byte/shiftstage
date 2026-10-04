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

test("a slow middle photo cannot hold back either neighboring card or another row", async () => {
  const delayed = photo("loading", () => assert.fail("The grid must not decode a loaded photo again"));
  const first = [card(), card(delayed), card()];
  const second = [card(), card(), card()];
  const h = harness([...first, ...second]);
  h.start();
  await flush();
  assert.equal(loading(first[0]), false);
  assert.equal(loading(first[1]), true);
  assert.equal(first[1].attributes.get("aria-busy"), "true");
  assert.equal(loading(first[2]), false);
  assert.ok(second.every((item) => !loading(item)));
  delayed.dataset.imageState = "ready";
  h.update();
  await flush();
  assert.ok(first.every((item) => !loading(item)));
  assert.equal(first[1].attributes.has("aria-busy"), false);
  assert.ok(h.observers.every((observer) => !observer.connected));
});

test("headings and incomplete rows do not couple unrelated cards", async () => {
  const delayed = card(photo("loading"));
  const ready = [card(), card()];
  const h = harness([heading(), delayed, heading(), ...ready]);
  h.start();
  await flush();
  assert.equal(loading(delayed), true);
  assert.ok(ready.every((item) => !loading(item)));
});

test("ready and failed photos never wait for an extra decode, even if it would hang", async () => {
  let decodes = 0;
  const cards = [card(photo("ready", () => { decodes++; return new Promise(() => {}); })), card(photo("error", () => assert.fail("Failed photos should not decode"))), card()];
  const h = harness(cards);
  h.start();
  await flush();
  assert.ok(cards.every((item) => item.attributes.size === 0));
  assert.equal(decodes, 0);
});

test("an old observer cannot reveal a replacement filter's cards", async () => {
  const h = harness([card(photo("loading"))]);
  h.start();
  const oldObserver = h.observers[0];
  const newPhoto = photo("loading");
  const newCard = card(newPhoto);
  h.replace([newCard]);
  h.start();
  h.update();
  oldObserver.callback();
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

test("a slow new neighbor never hides an already revealed portrait", async () => {
  let existingDecodes = 0;
  const existing = [card(photo("ready", () => { existingDecodes++; return Promise.resolve(); })), card()];
  const h = harness(existing);
  h.start();
  await flush();
  const delayed = photo("loading");
  const added = card(delayed);
  added.parentNode = h.grid;
  h.grid.children = [existing[0], added, existing[1]];
  h.start();
  assert.ok(existing.every(item => !loading(item)));
  assert.equal(loading(added), true);
  delayed.dataset.imageState = "ready";
  h.update();
  await flush();
  assert.equal(loading(added), false);
  assert.equal(existingDecodes, 0, "a newly loaded neighbor must not re-decode visible portraits");
});

test("background refreshes never re-decode already visible rows", async () => {
  let decodes = 0;
  const cards = Array.from({ length: 9 }, () => card(photo("ready", () => {
    decodes++;
    return Promise.resolve();
  })));
  const h = harness(cards);
  h.start();
  await flush();
  assert.equal(decodes, 0);
  for (let refresh = 0; refresh < 4; refresh++) {
    h.start();
    assert.ok(cards.every(item => !loading(item)));
    await flush();
  }
  assert.equal(decodes, 0);
  assert.ok(h.observers.every(observer => !observer.connected));
});

test("a replaced photo on a retained card waits for the new source to load", async () => {
  const retained = card();
  const h = harness([retained]);
  h.start();
  await flush();
  const replacement = photo("loading");
  retained.querySelectorAll = () => [replacement];
  h.start();
  assert.equal(loading(retained), true);
  replacement.dataset.imageState = "ready";
  h.update();
  await flush();
  assert.equal(loading(retained), false);
});

test("removing the first card does not abandon another card's pending photo", () => {
  const removed = card(photo("loading"));
  const delayed = photo("loading");
  const retained = card(delayed);
  const h = harness([removed, retained]);
  h.start();
  h.replace([retained]);
  h.update();
  assert.equal(loading(retained), true);
  assert.ok(h.observers.some(observer => observer.connected));
  delayed.dataset.imageState = "ready";
  h.update();
  assert.equal(loading(retained), false);
  assert.ok(h.observers.every(observer => !observer.connected));
});

test("one failed image clears only its own loading state while retries continue elsewhere", () => {
  const failed = photo("loading"), delayed = photo("loading");
  const cards = [card(failed), card(delayed), card()];
  const h = harness(cards);
  h.start();
  failed.dataset.imageState = "error";
  h.update();
  assert.deepEqual(cards.map(loading), [false, true, false]);
  delayed.dataset.imageState = "ready";
  h.update();
  assert.ok(cards.every(item => item.attributes.size === 0));
});
