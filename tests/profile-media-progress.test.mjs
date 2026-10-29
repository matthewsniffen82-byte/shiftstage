import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import mediaProgress from "../public/profile-media-progress.js";

function fixture() {
  class Node extends EventTarget {
    attributes = new Map();
    style = { setProperty: (key, value) => this.attributes.set(key, value) };
    setAttribute(key, value) { this.attributes.set(key, value); }
    replaceChildren(...children) { this.children = children; }
  }
  const host = new Node();
  host.ownerDocument = { createElement: () => new Node() };
  const video = new Node();
  Object.assign(video, { duration: NaN, currentTime: 0, paused: true });
  const dispose = mediaProgress.mount(video, host);
  const slider = host.children[1];
  const update = (name, values) => { Object.assign(video, values); video.dispatchEvent(new Event(name)); };
  const seek = (value) => { slider.value = String(value); slider.dispatchEvent(new Event("input")); };
  return { host, video, slider, update, seek, dispose };
}

test("gallery progress remains visible while loading, then follows full-duration playback and loops", () => {
  const f = fixture();
  assert.equal(f.host.children[0].className, "profile-media-video-track");
  assert.equal(f.slider.disabled, true);
  assert.equal(f.host.attributes.get("--profile-video-played"), "0%");
  f.update("loadedmetadata", { duration: 120 });
  assert.equal(f.slider.disabled, false);
  assert.equal(f.slider.max, "120");
  f.update("timeupdate", { currentTime: 75 });
  assert.equal(f.slider.value, "75");
  assert.equal(f.host.attributes.get("--profile-video-played"), "62.5%");
  assert.equal(f.slider.attributes.get("aria-valuetext"), "1:15 of 2:00");
  f.update("ended", { currentTime: 120 });
  assert.equal(f.host.attributes.get("--profile-video-played"), "100%");
  f.update("timeupdate", { currentTime: 0 });
  assert.equal(f.host.attributes.get("--profile-video-played"), "0%");
});

test("seeking belongs to its own video, clamps endpoints and does not change playback state", () => {
  const first = fixture(), second = fixture();
  first.seek(10);
  assert.equal(first.video.currentTime, 0, "unknown duration cannot seek");
  first.update("durationchange", { duration: 30 });
  second.update("durationchange", { duration: 90, currentTime: 20 });
  first.seek(12.5);
  assert.equal(first.video.currentTime, 12.5);
  assert.equal(first.video.paused, true);
  assert.equal(second.video.currentTime, 20);
  first.seek(999);
  assert.equal(first.video.currentTime, 30);
  first.seek(-10);
  assert.equal(first.video.currentTime, 0);
  first.seek("bad value");
  assert.equal(first.video.currentTime, 0);
  first.update("emptied", { duration: NaN });
  assert.equal(first.slider.disabled, true);
  assert.equal(first.slider.attributes.get("aria-valuetext"), "Video loading");
});

test("native range keeps touch and keyboard input and cleans up after the card unmounts", () => {
  const f = fixture();
  assert.equal(f.slider.type, "range");
  assert.equal(f.slider.attributes.get("aria-label"), "Video playback position");
  for (const type of ["click", "pointerdown", "pointerup", "keydown"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    let stopped = false;
    event.stopPropagation = () => { stopped = true; };
    f.slider.dispatchEvent(event);
    assert.ok(stopped);
    assert.equal(event.defaultPrevented, false, "native range interaction must remain enabled");
  }
  f.update("loadedmetadata", { duration: 60, currentTime: 10 });
  f.dispose();
  assert.deepEqual(f.host.children, []);
  f.seek(40);
  assert.equal(f.video.currentTime, 10);
  f.update("timeupdate", { currentTime: 20 });
  assert.equal(f.slider.value, "40", "removed listeners no longer update detached controls");
});

test("both gallery renderers mount the shared bar while MyDancr TV keeps its own controls", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync("public/profile-media-progress.js", "utf8"), context);
  assert.equal(typeof context.window.MyDancrMediaProgress.mount, "function");
  const live = fs.readFileSync("src/live-shell/app/13-open-profile-modal.js", "utf8");
  assert.match(live, /progress\.className = "profile-media-video-progress";[\s\S]*?window\.MyDancrMediaProgress\.mount\(video, progress\)/);
  const carousel = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
  assert.match(carousel, /item\.kind === "video" \? <ProfileVideoProgress \/> : null/);
  assert.match(carousel, /if \(container && video\) return mediaProgress\.mount\(video, container\)/);
  assert.match(fs.readFileSync("src/live-shell/shell.html", "utf8"), /src="\/profile-media-progress\.js/);
});
