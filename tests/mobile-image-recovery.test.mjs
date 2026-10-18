import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../src/live-shell/app/01-user-agent.js", import.meta.url), "utf8");
const bootstrap = source.slice(source.indexOf("    const STABLE_IMAGE_TIMEOUT_MS"), source.indexOf("    const markets = {"));
const transformed = "https://images.supabase.co/storage/v1/render/image/public/dancer-photos/approved.w640.webp?width=320&quality=80";

function harness() {
  const timers = new Map();
  const handlers = new Map();
  const windowHandlers = new Map();
  const images = [];
  const observed = new Set();
  const observers = [];
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
      this.attrs = new Map([["src", url], ["srcset", `${url} 320w`], ["data-image-state", "loading"]]);
      this.requests = [];
      images.push(this);
    }
    hasAttribute(name) { return this.attrs.has(name); }
    getAttribute(name) { return this.attrs.get(name); }
    setAttribute(name, value) { this.attrs.set(name, value); if (name === "src") this.src = value; }
    removeAttribute(name) { this.attrs.delete(name); }
    closest() { return this.picture || null; }
    querySelectorAll() { return []; }
    matches() { return false; }
    get currentSrc() {
      const candidates = this.picture?.querySelectorAll("source").find(source => source.hasAttribute("srcset"))?.getAttribute("srcset")
        || this.attrs.get("srcset");
      return candidates?.split(/\s+/)[0] || this.attrs.get("src") || "";
    }
    set src(url) {
      this.requests.push(url);
      this.attrs.set("src", url);
      this.complete = false;
      this.naturalWidth = 0;
    }
  }
  const ctx = vm.createContext({
    URL, HTMLImageElement: Image,
    document: { body: {}, visibilityState: "visible", querySelectorAll: selector => images.filter(image => image.isConnected
      && selector === `img[data-image-state="${image.dataset.imageState}"]`), addEventListener: (type, fn) => handlers.set(type, fn) },
    window: {
      location: { href: "https://www.mydancr.com/" }, addEventListener: (type, fn) => windowHandlers.set(type, fn),
      setTimeout(fn) { timers.set(++tick, fn); return tick; },
      clearTimeout(id) { timers.delete(id); },
    },
    IntersectionObserver: class {
      constructor(fn, options) { intersection = fn; this.options = options; observers.push(this); }
      observe(image) { observed.add(image); this.lastImage = image; }
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
    ctx, Image, timers, observed, observers,
    dispatch(type) { windowHandlers.get(type)(); },
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

test("mobile picture candidates cannot override the authorized photo retry", () => {
  const h = harness();
  const path = "owner/approved.r320-640.m640x960.jpg.w320.webp";
  const endpoint = "https://www.mydancr.com/api/media/dancer-photo?path=" + encodeURIComponent(path);
  const image = new h.Image(endpoint);
  const attrs = new Map([["srcset", `${endpoint}&width=160 160w`], ["data-grid-srcset", `${endpoint}&width=160 160w`]]);
  const source = { hasAttribute: key => attrs.has(key), getAttribute: key => attrs.get(key), removeAttribute: key => attrs.delete(key) };
  image.picture = { querySelectorAll: () => [source] };
  image.attrs.set("data-grid-src", endpoint);
  image.attrs.set("data-grid-srcset", `${endpoint} 320w`);
  assert.equal(new URL(image.currentSrc).searchParams.get("width"), "160");
  h.fail(image);
  assert.equal(attrs.size, 0, "neither live nor deferred picture sources can reselect the broken candidate");
  assert.equal(image.hasAttribute("data-grid-src"), false);
  assert.equal(image.hasAttribute("data-grid-srcset"), false);
  assert.equal(image.currentSrc, image.requests[0]);
  const retry = new URL(image.currentSrc);
  assert.equal(retry.pathname, "/api/media/dancer-photo");
  assert.equal(retry.searchParams.get("path"), path);
  assert.equal(retry.searchParams.has("width"), false);
  assert.equal(retry.searchParams.get("image_retry"), "1");
  h.load(image);
  assert.equal(image.dataset.imageState, "ready");
  assert.equal(h.timers.size, 0);
});

test("authorized image retries preserve preview tokens and video-poster identities", () => {
  const h = harness();
  for (const source of [
    "https://www.mydancr.com/api/media/dancer-photo?path=owner%2Fphoto.jpg&width=320&preview=signed-preview",
    "https://www.mydancr.com/api/media/dancer-video?id=video-id&poster=1&width=320&preview=signed-preview",
  ]) {
    const image = new h.Image(source);
    const before = new URL(source);
    const after = new URL(h.ctx.stableImageRetryUrl(image, 2));
    before.searchParams.delete("width");
    before.searchParams.set("image_retry", "2");
    assert.equal(after.href, before.href);
  }
  for (const source of [
    "https://www.mydancr.com/api/media/dancer-video?id=video-id",
    "https://elsewhere.example/api/media/dancer-photo?path=photo.jpg&preview=signed",
    "https://www.mydancr.com/other-image?width=320&token=signed",
  ]) assert.equal(h.ctx.stableImageRetryUrl(new h.Image(source), 1), source);
});

test("a late successful load cancels a backed-off retry", () => {
  const h = harness();
  const image = new h.Image();
  h.fail(image);
  h.fail(image);
  assert.equal(image.requests.length, 1);
  assert.equal(h.timers.size, 1);
  h.fail(image);
  assert.equal(h.timers.size, 1, "duplicate error events do not consume another retry");
  h.load(image);
  assert.equal(image.dataset.imageState, "ready");
  assert.equal(image.requests.length, 1);
  assert.equal(h.timers.size, 0);
});

test("reconnection or page restoration gives failed photos one fresh visible retry without a reload loop", () => {
  for (const event of ["online", "pageshow"]) {
    const h = harness();
    const image = new h.Image("https://www.mydancr.com/api/media/dancer-photo?path=owner%2Fphoto.jpg");
    image.matches = selector => selector === ".home-dancer-grid-photo";
    h.fail(image); h.fail(image); h.expire(); h.fail(image);
    assert.equal(image.dataset.imageState, "error");
    assert.equal(image.requests.length, 2);
    h.dispatch(event);
    assert.equal(image.dataset.imageState, "loading");
    assert.equal(h.observed.has(image), true);
    assert.equal(h.timers.size, 0, "offscreen recovery waits for visibility");
    h.visible(image); h.expire();
    assert.equal(image.requests.length, 3);
    assert.equal(new URL(image.currentSrc).searchParams.get("image_retry"), "3");
    h.fail(image);
    h.dispatch("online"); h.dispatch("pageshow");
    assert.equal(image.dataset.imageState, "error");
    assert.equal(image.requests.length, 3);
    assert.equal(h.timers.size, 0);
    // A restored, already decoded image must still reveal even after the budget.
    image.complete = true; image.naturalWidth = 640;
    h.dispatch("pageshow");
    assert.equal(image.dataset.imageState, "ready");
  }
});

test("detached images and hidden pages never restart failed photo requests", () => {
  const h = harness();
  const image = new h.Image();
  h.fail(image); h.fail(image);
  image.isConnected = false;
  h.expire();
  assert.equal(image.requests.length, 1);
  assert.equal(h.timers.size, 0);
  const hidden = new h.Image();
  h.fail(hidden); h.fail(hidden); h.expire(); h.fail(hidden);
  h.ctx.document.visibilityState = "hidden";
  h.dispatch("online"); h.dispatch("pageshow");
  assert.equal(hidden.dataset.imageState, "error");
  assert.equal(hidden.requests.length, 2);
  assert.equal(h.timers.size, 0);
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

test("dancer grid preloads nearby rows without arming retries for the whole directory", () => {
  const h = harness();
  const images = Array.from({ length: 500 }, (_, index) => {
    const image = new h.Image();
    image.loading = index < 12 ? "eager" : "lazy";
    image.matches = selector => selector === ".home-dancer-grid-photo";
    h.insert(image);
    return image;
  });
  assert.equal(h.timers.size, 12);
  const observer = h.observers.find(item => item.lastImage === images[499]);
  assert.equal(observer.options.rootMargin, "1200px 0px");
  h.visible(images[12]);
  assert.equal(images[12].loading, "eager");
  assert.equal(images[499].loading, "lazy");
  assert.equal(h.timers.size, 13);
  h.load(images[12]);
  assert.equal(h.observed.has(images[12]), false);
});

test("deferred grid photos activate their original picture sources once when approaching the viewport", () => {
  const h = harness();
  const image = new h.Image();
  image.loading = "lazy";
  image.complete = true; // An img without src is complete, but is not a failed photo.
  image.matches = selector => selector === ".home-dancer-grid-photo";
  image.attrs.delete("src");
  image.attrs.delete("srcset");
  image.attrs.set("data-grid-src", transformed);
  image.attrs.set("data-grid-srcset", `${transformed} 320w`);
  const source = new h.Image();
  source.attrs = new Map([["data-grid-srcset", "https://images.example/small 160w"]]);
  image.picture = { querySelectorAll: () => [source] };
  h.insert(image);
  assert.equal(image.requests.length, 0);
  assert.equal(h.timers.size, 0);
  h.visible(image);
  assert.deepEqual(image.requests, [transformed]);
  assert.equal(source.getAttribute("srcset"), "https://images.example/small 160w");
  assert.equal(image.getAttribute("srcset"), `${transformed} 320w`);
  assert.equal(image.hasAttribute("data-grid-src"), false);
  assert.equal(image.hasAttribute("data-grid-srcset"), false);
  assert.equal(source.hasAttribute("data-grid-srcset"), false);
  h.visible(image);
  assert.equal(image.requests.length, 1);
  h.load(image);
  assert.equal(image.dataset.imageState, "ready");
});

test("club lineup thumbnails start ahead of the card without eagerly loading distant portraits", () => {
  const h = harness();
  const avatar = new h.Image();
  avatar.loading = "lazy";
  avatar.matches = selector => selector === ".venue-lineup-avatar-photo";
  h.insert(avatar);
  const photo = new h.Image();
  photo.loading = "lazy";
  h.insert(photo);
  assert.equal(h.observers.find(observer => observer.lastImage === avatar).options.rootMargin, "1200px 0px");
  assert.equal(h.observers.find(observer => observer.lastImage === photo).options.rootMargin, "300px");
  assert.equal(h.timers.size, 0, "offscreen requests stay deferred");
  h.visible(avatar);
  assert.equal(avatar.loading, "eager");
  assert.equal(photo.loading, "lazy");
  h.load(avatar);
  assert.equal(h.observed.has(avatar), false);
});

test("unavailable images have bounded retries and removed cards stop requesting", () => {
  const h = harness();
  const image = new h.Image();
  h.fail(image);
  h.fail(image);
  assert.equal(image.requests.length, 1, "the second retry backs off");
  h.expire();
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
