import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import mediaFullscreen from "../public/profile-media-fullscreen.js";

function fixture() {
  const listeners = new Map(), clicks = new Map(), changes = [], requests = [];
  let layouts = 0, exits = 0;
  const doc = {
    fullscreenElement: null,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    exitFullscreen() {
      exits++;
      this.fullscreenElement = null;
      listeners.get("fullscreenchange")?.();
      return Promise.resolve();
    },
  };
  const surface = {
    ownerDocument: doc, isConnected: true,
    addEventListener: (name, fn) => clicks.set(name, fn),
    removeEventListener: (name) => clicks.delete(name),
    requestFullscreen(options) {
      requests.push(options);
      doc.fullscreenElement = surface;
      listeners.get("fullscreenchange")?.();
      return Promise.resolve();
    },
  };
  const controller = mediaFullscreen.createController(surface, {
    onChange: (active) => changes.push(active), onLayout: () => layouts++,
  });
  return { doc, surface, controller, changes, requests, listeners, clicks,
    get layouts() { return layouts; }, get exits() { return exits; } };
}

test("explicit expansion requests immersive browser fullscreen synchronously; Escape restores normal mode", async () => {
  const f = fixture();
  assert.deepEqual(f.requests, [], "opening a viewer never automatically enters fullscreen");
  const entering = f.controller.set(true);
  assert.deepEqual(f.requests, [{ navigationUI: "hide" }], "request stays inside the button's user activation");
  await entering;
  assert.deepEqual(f.changes, [true]);
  await f.doc.exitFullscreen();
  assert.deepEqual(f.changes, [true, false]);
  await f.controller.set(true);
  await f.controller.set(false);
  assert.deepEqual(f.changes, [true, false, true, false]);
  assert.equal(f.doc.fullscreenElement, null);
});

test("missing, denied, and synchronously failing native APIs keep a usable in-page fullscreen fallback", async () => {
  for (const request of [undefined, () => Promise.reject(new Error("Denied")), () => { throw new Error("Unsupported"); }]) {
    const f = fixture();
    f.surface.requestFullscreen = request;
    await f.controller.set(true);
    assert.deepEqual(f.changes, [true]);
    assert.ok(f.layouts > 0);
    await f.controller.set(false);
    assert.deepEqual(f.changes, [true, false]);
    assert.equal(f.exits, 0);
  }
});

test("WebKit fullscreen entry and browser exit keep the same mode state", async () => {
  const f = fixture();
  delete f.surface.requestFullscreen;
  delete f.doc.exitFullscreen;
  f.surface.webkitRequestFullscreen = () => {
    f.doc.webkitFullscreenElement = f.surface;
    f.listeners.get("webkitfullscreenchange")();
  };
  let exits = 0;
  f.doc.webkitExitFullscreen = () => {
    exits++;
    f.doc.webkitFullscreenElement = null;
    f.listeners.get("webkitfullscreenchange")();
  };
  await f.controller.set(true);
  await f.controller.set(false);
  assert.equal(exits, 1);
  assert.deepEqual(f.changes, [true, false]);
});

test("closing during a pending native request cannot reopen the viewer or leave fullscreen behind", async () => {
  const f = fixture();
  let resolve;
  f.surface.requestFullscreen = () => new Promise(done => { resolve = done; });
  const entering = f.controller.set(true);
  f.controller.dispose();
  f.surface.isConnected = false;
  assert.equal(f.listeners.size, 0);
  assert.equal(f.clicks.size, 0);
  f.doc.fullscreenElement = f.surface;
  resolve();
  await entering;
  assert.equal(f.exits, 1);
  assert.equal(f.doc.fullscreenElement, null);
  assert.deepEqual(f.changes, [true], "no state updates after unmount");
  assert.equal(f.layouts, 0);
});

test("cleanup and a late request never exit another component's fullscreen", async () => {
  const f = fixture();
  let resolve;
  f.surface.requestFullscreen = () => new Promise(done => { resolve = done; });
  const entering = f.controller.set(true);
  f.doc.fullscreenElement = { id: "another-viewer" };
  f.controller.dispose();
  resolve();
  await entering;
  assert.equal(f.exits, 0);
});

test("collapsing while entry is pending stays collapsed when the browser finally responds", async () => {
  const f = fixture();
  let resolve;
  f.surface.requestFullscreen = () => new Promise(done => { resolve = done; });
  const entering = f.controller.set(true);
  await f.controller.set(false);
  f.doc.fullscreenElement = f.surface;
  resolve();
  await entering;
  assert.deepEqual(f.changes, [true, false]);
  assert.equal(f.doc.fullscreenElement, null);
});

test("offer, account and report actions leave the native layer so their dialogs remain visible", async () => {
  const f = fixture();
  await f.controller.set(true);
  f.clicks.get("click")({ target: { closest: () => null } });
  assert.equal(f.exits, 0, "ordinary media controls retain fullscreen");
  f.clicks.get("click")({ target: { closest: selector => {
    for (const action of [".profile-media-entry", "[data-profile-photo-follow]", "[data-profile-tv-follow]", ".profile-media-viewer-report"]) assert.ok(selector.includes(action));
    return {};
  } } });
  assert.equal(f.exits, 1);
  assert.deepEqual(f.changes, [true, false]);
});

test("the classic shell and routed profile share the same fullscreen controller", () => {
  const browser = { window: {} };
  vm.runInNewContext(fs.readFileSync("public/profile-media-fullscreen.js", "utf8"), browser);
  assert.equal(typeof browser.window.MyDancrMediaFullscreen.createController, "function");
  const shell = fs.readFileSync("src/live-shell/shell.html", "utf8");
  const carousel = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
  assert.match(shell, /<script src="\/profile-media-fullscreen.js\?v=1"><\/script>/);
  assert.match(carousel, /import mediaFullscreen[^;]+@\/public\/profile-media-fullscreen/);
  assert.match(carousel, /mediaFullscreen.createController\(surface/);
  assert.match(carousel, /controller.dispose\(\)/);
});
