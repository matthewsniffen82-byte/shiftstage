import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync("public/profile-photo-crop.js", "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const nodes = new Map(), viewport = new EventTarget();
  viewport.height = 500;
  let decode;
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, Object.assign(new EventTarget(), {
      hidden: true, disabled: true, focus() {}, setPointerCapture() {},
      getBoundingClientRect: () => ({ width: 250, height: selector === "[data-crop-header]" ? 80 : 150 }),
      getContext: () => ({ drawImage() {} }),
    }));
    return nodes.get(selector);
  };
  const dialog = Object.assign(new EventTarget(), {
    open: false, openings: 0, removed: false, clientWidth: 334,
    style: { setProperty() {} }, setAttribute() {}, querySelector: node,
    showModal() { this.open = true; this.openings++; }, close() { this.open = false; }, remove() { this.removed = true; },
  });
  const window = Object.assign(new EventTarget(), { innerHeight: 700, visualViewport: viewport });
  vm.runInNewContext(source, {
    window, AbortController, DOMException, Error,
    Image: class { naturalWidth = 900; naturalHeight = 1200; decode() { return new Promise(resolve => { decode = resolve; }); } },
    document: { activeElement: null, createElement: () => dialog, body: { append() {} } },
    getComputedStyle: () => ({ maxHeight: "676px", paddingTop: "18px", paddingBottom: "18px", paddingLeft: "18px", paddingRight: "18px", borderTopWidth: "1px", borderBottomWidth: "1px", marginBottom: "12px" }),
  });
  const controller = new AbortController();
  return { dialog, node, viewport, controller,
    decode: () => decode(),
    start: prepare => window.DancrPhotoCrop.crop({ size: 100 }, { aspectRatio: .75, prepare, signal: controller.signal }),
  };
}

test("the editor first opens with a decoded photo and sizes it around the controls in the visible viewport", async () => {
  const f = fixture();
  let prepared;
  const result = f.start(() => new Promise(resolve => { prepared = resolve; }));
  assert.equal(f.dialog.openings, 0);
  prepared("data:image/jpeg;base64,fixture");
  await tick();
  assert.equal(f.dialog.openings, 0, "decoding must also finish before opening");
  f.decode(); await tick();
  assert.equal(f.dialog.openings, 1);
  assert.equal(f.node("[data-crop-confirm]").disabled, false);
  assert.equal(f.node("[data-crop-frame]").hidden, false);
  const canvas = f.node("canvas");
  assert.ok(canvas.height / 2 + 80 + 150 + 38 + 12 <= 476, "photo plus real controls must fit the viewport");
  f.viewport.height = 400;
  f.viewport.dispatchEvent(new Event("resize"));
  assert.ok(canvas.height / 2 + 80 + 150 + 38 + 12 <= 376, "browser chrome changes must resize the photo");
  f.node("[data-crop-cancel]").dispatchEvent(new Event("click"));
  assert.equal(await result, null);
  assert.equal(f.dialog.removed, true);
});

test("failed preparation opens retry feedback without showing unusable crop actions", async () => {
  const f = fixture();
  const result = f.start(async () => { throw new Error("Unable to prepare this photo."); });
  await tick();
  assert.equal(f.dialog.openings, 1);
  assert.equal(f.node("[data-crop-retry]").hidden, false);
  assert.equal(f.node("[data-crop-confirm]").hidden, true);
  assert.match(f.node("[data-crop-status]").textContent, /Unable to prepare/);
  f.node("[data-crop-cancel]").dispatchEvent(new Event("click"));
  assert.equal(await result, null);
});

test("canceling while the photo decodes never opens a late dialog", async () => {
  const f = fixture();
  const result = f.start(async () => "data:image/jpeg;base64,fixture");
  const rejected = assert.rejects(result, { name: "AbortError" });
  await tick();
  f.controller.abort();
  f.decode(); await rejected; await tick();
  assert.equal(f.dialog.openings, 0);
  assert.equal(f.dialog.removed, true);
});
