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
  const timers = new Map();
  let nextTimer = 0;
  const grid = { children };
  children.forEach((child) => { child.parentNode = grid; });
  const ctx = vm.createContext({
    Promise,
    window: {
      setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
      clearTimeout(id) { timers.delete(id); },
    },
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
    grid, observers, timers,
    start() { ctx.revealDancerGridRows(grid); },
    expire() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); },
    update() { observers.filter((observer) => observer.connected).forEach((observer) => observer.callback()); },
    replace(next) {
      grid.children.forEach((child) => { child.parentNode = null; });
      grid.children = next;
      next.forEach((child) => { child.parentNode = grid; });
    },
  };
}

test("opening photos paint together as soon as the whole opening batch is ready", async () => {
  const delayed = photo("loading", () => assert.fail("The grid must not decode a loaded photo again"));
  const first = [card(), card(delayed), card()];
  const second = [card(), card(), card()];
  const h = harness([...first, ...second]);
  h.start();
  await flush();
  assert.equal(loading(first[0]), true);
  assert.equal(loading(first[1]), true);
  assert.equal(first[1].attributes.get("aria-busy"), "true");
  assert.equal(loading(first[2]), true);
  assert.ok(second.every(loading));
  delayed.dataset.imageState = "ready";
  h.update();
  await flush();
  assert.ok(first.every((item) => !loading(item)));
  assert.ok(second.every((item) => !loading(item)));
  assert.equal(h.timers.size, 0);
  assert.equal(first[1].attributes.has("aria-busy"), false);
  assert.ok(h.observers.every((observer) => !observer.connected));
});

test("a stalled opening photo has a bounded wait, with headings excluded from the batch", async () => {
  const delayed = card(photo("loading"));
  const ready = [card(), card()];
  const h = harness([heading(), delayed, heading(), ...ready]);
  h.start();
  await flush();
  assert.equal(loading(delayed), true);
  assert.ok(ready.every(loading));
  assert.equal([...h.timers.values()][0].delay, 1000);
  h.expire();
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

test("failed photos count as settled and do not prevent the opening batch from appearing", () => {
  const failed = photo("loading"), delayed = photo("loading");
  const cards = [card(failed), card(delayed), card()];
  const h = harness(cards);
  h.start();
  failed.dataset.imageState = "error";
  h.update();
  assert.ok(cards.every(loading));
  delayed.dataset.imageState = "ready";
  h.update();
  assert.ok(cards.every(item => item.attributes.size === 0));
});

test("the opening batch never waits for the hundreds of offscreen photos", () => {
  const opening = Array.from({ length: 12 }, () => photo("loading"));
  const cards = [...opening.map(image => card(image)), ...Array.from({ length: 488 }, () => card(photo("loading")))];
  const h = harness(cards);
  h.start();
  opening.forEach(image => { image.dataset.imageState = "ready"; });
  h.update();
  assert.ok(cards.slice(0, 12).every(item => !loading(item)));
  assert.ok(cards.slice(12).every(loading));
  assert.equal(h.timers.size, 0);
});

test("a replaced filter cancels the old batch deadline and cannot reveal its new photos", () => {
  const h = harness([card(photo("loading"))]);
  h.start();
  const oldDeadline = [...h.timers.values()][0].callback;
  const replacement = [card(), card(photo("loading"))];
  h.replace(replacement);
  h.start();
  assert.equal(h.timers.size, 1);
  oldDeadline();
  assert.ok(replacement.every(loading));
  h.expire();
  assert.equal(loading(replacement[0]), false);
  assert.equal(loading(replacement[1]), true);
});
