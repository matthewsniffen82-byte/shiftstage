import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const bootstrap = html.slice(html.indexOf("    const STABLE_IMAGE_TIMEOUT_MS"), html.indexOf("    const markets = {"));
const transformed = "https://images.supabase.co/storage/v1/render/image/public/dancer-photos/approved.w640.webp?width=320&quality=80";

function harness() {
  const timers = new Map();
  const handlers = new Map();
  const observed = new Set();
  let tick = 0;
  let intersection;
  let insertion;
  class Image {
    constructor(url = transformed) {
      this.dataset = { imageState: "loading" };
      this.isConnected = true;
      this.loading = "eager";
      this.complete = false;
      this.naturalWidth = 0;
      this.currentSrc = url;
      this.attrs = new Map([["src", url], ["srcset", `${url} 320w`], ["data-image-state", "loading"]]);
      this.requests = [];
    }
    hasAttribute(name) { return this.attrs.has(name); }
    getAttribute(name) { return this.attrs.get(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    querySelectorAll() { return []; }
    matches() { return false; }
    set src(url) {
      this.requests.push(url);
      this.attrs.set("src", url);
      this.currentSrc = url;
      this.complete = false;
      this.naturalWidth = 0;
    }
  }
  const ctx = vm.createContext({
    URL, HTMLImageElement: Image,
    document: { body: {}, querySelectorAll: () => [], addEventListener: (type, fn) => handlers.set(type, fn) },
    window: {
      location: { href: "https://www.mydancr.com/" }, addEventListener() {},
      setTimeout(fn) { timers.set(++tick, fn); return tick; },
      clearTimeout(id) { timers.delete(id); },
    },
    IntersectionObserver: class {
      constructor(fn) { intersection = fn; }
      observe(image) { observed.add(image); }
      unobserve(image) { observed.delete(image); }
    },
    MutationObserver: class {
      constructor(fn) { insertion = fn; }
      observe() {}
    },
    fitVenueLogoImage() {},
  });
  vm.runInContext(bootstrap, ctx);
  return {
    ctx, Image, timers, observed,
    load(image) { image.complete = true; image.naturalWidth = 640; handlers.get("load")({ target: image }); },
    fail(image) { image.complete = true; image.naturalWidth = 0; handlers.get("error")({ target: image }); },
    insert(image) { insertion([{ addedNodes: [image] }]); },
    visible(image) { intersection([{ target: image, isIntersecting: true }]); },
    expire() { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); },
  };
}

test("a failed responsive photo recovers using the same approved stored object", () => {
  const h = harness();
  const image = new h.Image();
  h.fail(image);
  assert.equal(image.dataset.imageState, "loading");
  assert.equal(image.hasAttribute("srcset"), false);
  const retry = new URL(image.requests[0]);
  assert.equal(retry.pathname, "/storage/v1/object/public/dancer-photos/approved.w640.webp");
  assert.equal(retry.searchParams.has("width"), false);
  assert.equal(retry.searchParams.get("image_retry"), "1");
  h.load(image);
  assert.equal(image.dataset.imageState, "ready");
  assert.equal(h.timers.size, 0);
});

test("a stalled visible mobile image gets a deadline and a working fallback", () => {
  const h = harness();
  const image = new h.Image();
  h.insert(image);
  assert.equal(h.timers.size, 1);
  h.expire();
  assert.equal(image.requests.length, 1);
  assert.match(image.requests[0], /\/object\/public\//);
  h.load(image);
  assert.equal(image.dataset.imageState, "ready");
});

test("offscreen lazy photos stay deferred until they approach the viewport", () => {
  const h = harness();
  const image = new h.Image();
  image.loading = "lazy";
  h.insert(image);
  assert.equal(h.observed.has(image), true);
  assert.equal(h.timers.size, 0);
  assert.equal(image.loading, "lazy");
  h.visible(image);
  assert.equal(image.loading, "eager");
  assert.equal(h.timers.size, 1);
  h.load(image);
  assert.equal(h.observed.has(image), false);
});

test("cached images inserted after their load event are revealed immediately", () => {
  const h = harness();
  const image = new h.Image();
  image.complete = true;
  image.naturalWidth = 320;
  h.insert(image);
  assert.equal(image.dataset.imageState, "ready");
  assert.equal(image.requests.length, 0);
  assert.equal(h.timers.size, 0);
});

test("unavailable images have bounded retries and removed cards stop requesting", () => {
  const h = harness();
  const image = new h.Image();
  h.fail(image);
  h.fail(image);
  h.fail(image);
  h.fail(image);
  assert.equal(image.requests.length, 2);
  assert.equal(image.dataset.imageState, "error");
  assert.equal(h.timers.size, 0);
  const removed = new h.Image();
  h.insert(removed);
  removed.isConnected = false;
  h.expire();
  assert.equal(removed.requests.length, 0);
});

test("recovery never rewrites signed/private or third-party URLs as public objects", () => {
  const h = harness();
  for (const source of [
    "https://images.supabase.co/storage/v1/object/sign/private/photo.jpg?token=example",
    "https://example.com/storage/v1/render/image/public/photo.jpg?width=320",
  ]) {
    assert.equal(h.ctx.stableImageRetryUrl(new h.Image(source), 1), source);
  }
});

test("photo readiness and logo fitting use listeners compatible with the production CSP", () => {
  assert.doesNotMatch(html, /data-image-state="loading"[^>]*\bon(?:load|error)=/);
  const h = harness();
  let fitted = false;
  h.ctx.fitVenueLogoImage = () => { fitted = true; };
  const image = new h.Image();
  image.matches = () => true;
  h.load(image);
  assert.equal(fitted, true);
  assert.equal(image.dataset.imageState, "ready");
});
