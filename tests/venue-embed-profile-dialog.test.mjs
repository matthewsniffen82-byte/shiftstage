import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Isolated DOM/history fixture: no application server, browser journey, or network.
function fixture() {
  const origin = "https://www.mydancr.com";
  const nodes = new Map(), timers = new Map(), intervals = [], messages = new Map(), scrolls = [], requests = [];
  let timerId = 0, index = 0, responder = () => ({ ok: true, venue: { slug: "rhino", name: "Rhino" }, dancers: [], nextCursor: null });
  const states = [{ unrelated: "retained" }];
  class Node extends EventTarget {
    hidden = false; open = false; isConnected = true; attributes = new Map(); children = [];
    dataset = {}; style = { setProperty() {}, removeProperty() {} }; innerHTML = "";
    setAttribute(key, value) { this.attributes.set(key, value); }
    getAttribute(key) { return this.attributes.get(key); }
    hasAttribute(key) { return this.attributes.has(key); }
    removeAttribute(key) { this.attributes.delete(key); }
    querySelectorAll(selector) { return selector === "a[href]" ? [link] : []; }
    contains(child) { return child === link; }
    closest() { return this; }
    focus(options) { this.focusOptions = options; document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event("close")); }
    append(child) { this.children.push(child); }
    remove() { this.isConnected = false; }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const classes = new Set(), styles = new Map();
  const document = new EventTarget();
  document.getElementById = node;
  document.createElement = name => { const result = new Node(); if (name === "iframe") result.contentWindow = {}; return result; };
  document.body = {
    dataset: { venueSlug: "rhino" },
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    style: { setProperty: (key, value) => styles.set(key, value), removeProperty: key => styles.delete(key) },
  };
  const link = new Node();
  link.href = `${origin}/embed/venues/rhino/dancers/kelly?from=club-dashboard`;
  link.setAttribute("aria-label", "Open Kelly's full profile");
  const window = {
    location: { origin, href: `${origin}/embed/venues/rhino?from=club-dashboard` },
    scrollX: 0, scrollY: 940, crypto: { randomUUID: () => "session" },
    history: {
      get state() { return states[index]; },
      pushState(state) { this.gridLockedAtPush = classes.has("venue-profile-open"); states.splice(++index, Infinity, state); },
      replaceState(state) { states[index] = state; },
      back() { this.backCalls++; index--; queueMicrotask(() => messages.get("popstate")({ state: states[index] })); },
      backCalls: 0,
    },
    addEventListener: (name, callback) => messages.set(name, callback),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => intervals.push(fn), scrollTo: options => scrolls.push(options),
    fetch: async (url, options) => { requests.push({ url, options }); return Response.json(await responder()); },
  };
  const context = { window, URL, URLSearchParams, AbortSignal };
  vm.runInNewContext(read("public/dancer-grid-card.js"), context);
  window.MydancrDancerGrid = { ...window.MydancrDancerGrid, update(element, markup) { element.innerHTML = markup; } };
  vm.runInNewContext(read("public/venue-grid-embed.js"), context);
  function click(options = {}) {
    const event = new Event("click", { cancelable: true });
    for (const [key, value] of Object.entries({ target: link, button: 0, ...options })) Object.defineProperty(event, key, { value });
    node("results").dispatchEvent(event);
    return event.defaultPrevented;
  }
  const frame = () => node("venue-profile-dialog").children.at(-1);
  function receive(type, options = {}) { messages.get("message")({ origin, source: frame().contentWindow, data: { type: `mydancr:embed-profile-${type}` }, ...options }); }
  return { window, document, node, classes, styles, scrolls, timers, intervals, requests, link, click, frame, receive,
    mount: () => window.MydancrVenueEmbed.mountProfileDialog(document),
    respond: fn => { responder = fn; },
    pop(state) { window.history.replaceState(state); messages.get("popstate")({ state }); },
  };
}

test("a card opens over the preserved grid and Back restores scroll and keyboard focus", async () => {
  const f = fixture(), viewer = f.mount();
  f.node("results").innerHTML = "existing cards and loaded pages";
  assert.equal(f.click(), true);
  assert.equal(viewer.isOpen(), true);
  assert.equal(f.node("venue-profile-dialog").open, true);
  assert.equal(f.styles.get("--venue-profile-scroll-y"), "-940px");
  const frame = f.frame();
  assert.equal(frame.src, "https://www.mydancr.com/embed/venues/rhino/dancers/kelly?from=club-dashboard&overlay=1");
  assert.equal(frame.dataset.loading, "true");
  assert.equal(f.window.history.state.unrelated, "retained");
  assert.equal(f.window.history.gridLockedAtPush, false, "browser Back must capture the grid scroll before locking it");
  f.receive("ready");
  assert.equal(frame.dataset.loading, "false");
  assert.equal(f.document.activeElement, frame);
  assert.equal(f.timers.size, 0);
  f.receive("close");
  await Promise.resolve();
  assert.equal(viewer.isOpen(), false);
  assert.equal(frame.isConnected, false);
  assert.equal(f.classes.has("venue-profile-open"), false);
  assert.equal(f.styles.has("--venue-profile-scroll-y"), false);
  assert.equal(f.scrolls.at(-1).top, 940);
  assert.equal(f.document.activeElement, f.link);
  assert.equal(f.link.focusOptions.preventScroll, true);
  assert.equal(f.node("results").innerHTML, "existing cards and loaded pages");
  assert.equal(f.window.history.backCalls, 1);
});

test("modified clicks, badge buttons and links outside this club keep normal behavior", () => {
  const f = fixture(); f.mount();
  for (const event of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { target: { closest: () => null } }]) assert.equal(f.click(event), false);
  for (const href of ["https://other.example/embed/venues/rhino/dancers/kelly", "/embed/venues/another/dancers/kelly", "/dashboard/venue", "/embed/venues/rhino/dancers/kelly/settings", "javascript:alert(1)"]) {
    f.link.href = href; assert.equal(f.click(), false);
  }
  f.link.href = "/embed/venues/rhino/dancers/kelly";
  f.link.target = "_blank"; assert.equal(f.click(), false);
  f.link.target = ""; f.link.setAttribute("download", ""); assert.equal(f.click(), false);
  assert.equal(f.frame(), undefined);
});

test("only the active same-origin frame can reveal or close a profile", () => {
  const f = fixture(), viewer = f.mount(); f.click();
  for (const type of ["ready", "close"]) {
    f.receive(type, { origin: "https://other.example" });
    f.receive(type, { source: {} });
    assert.equal(viewer.isOpen(), true);
    assert.equal(f.frame().dataset.loading, "true");
  }
  const oldFrame = f.frame();
  const entry = f.window.history.state;
  f.pop({});
  assert.equal(viewer.isOpen(), false);
  assert.equal(f.window.history.backCalls, 0);
  f.pop(entry);
  assert.equal(viewer.isOpen(), true);
  assert.notEqual(f.frame(), oldFrame);
  f.receive("close", { source: oldFrame.contentWindow });
  assert.equal(viewer.isOpen(), true);
  f.pop({ mydancrVenueProfile: { href: "https://other.example/profile" } });
  assert.equal(viewer.isOpen(), false);
});

test("load failures keep a usable back control and direct-link fallback", async () => {
  const f = fixture(), viewer = f.mount(); f.click();
  [...f.timers.values()][0]();
  assert.match(f.node("venue-profile-status").textContent, /could not load/);
  assert.equal(f.node("venue-profile-fallback").hidden, false);
  assert.equal(f.node("venue-profile-fallback").href, "/embed/venues/rhino/dancers/kelly?from=club-dashboard");
  // A slow response can still recover after the timeout.
  f.receive("ready");
  assert.equal(f.node("venue-profile-loading").hidden, true);
  const cancel = new Event("cancel", { cancelable: true });
  f.node("venue-profile-dialog").dispatchEvent(cancel);
  await Promise.resolve();
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(viewer.isOpen(), false);
  assert.equal(f.timers.size, 0);
});

test("background roster refreshes cannot replace cards while a profile is open", async () => {
  const f = fixture();
  await f.window.MydancrVenueEmbed.mount(f.document);
  f.node("results").innerHTML = "loaded grid";
  let resolve;
  f.respond(() => new Promise(done => { resolve = done; }));
  const refresh = f.intervals[0]();
  f.click();
  resolve({ ok: true, venue: { slug: "rhino", name: "Rhino" }, dancers: [], nextCursor: null });
  await refresh;
  await new Promise(done => setImmediate(done));
  assert.equal(f.node("results").innerHTML, "loaded grid");
  const count = f.requests.length;
  f.intervals[0]();
  assert.equal(f.requests.length, count);
});
