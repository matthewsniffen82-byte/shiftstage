import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const live = fs.readFileSync("outputs/index.html", "utf8");
const carousel = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
const css = fs.readFileSync("public/profile-media-card-feed.css", "utf8");
const layout = fs.readFileSync("app/layout.tsx", "utf8");
const functionSource = (name) => {
  const source = live.match(new RegExp("    function " + name + "\\([^]*?\\n    \\}"))?.[0];
  assert.ok(source, name + " must exist");
  return source;
};
const context = vm.createContext({});
vm.runInContext([
  functionSource("profileMediaCardScrollIndex"),
  functionSource("profileTvViewerScrollTarget"),
].join("\n"), context);

test("both profile entry points load the same TV-sized card feed styles", () => {
  assert.match(live, /href="\/profile-media-card-feed\.css\?v=\d+"/);
  assert.match(layout, /import "\.\.\/public\/profile-media-card-feed\.css"/);
  assert.match(live, /class="profile-photo-viewer profile-media-card-feed"/);
  assert.match(live, /class="profile-tv-viewer profile-media-card-feed"/);
  assert.match(carousel, /profile-media-viewer profile-media-card-feed/);
  for (const size of [
    "clamp(560px, calc(100svh - 140px), 760px)",
    "clamp(520px, calc(100svh - 112px), 920px)",
  ]) {
    assert.ok(live.includes(size), "dimensions must match regular MyDancr TV");
    assert.ok(css.includes(size));
  }
  assert.match(css, /--profile-media-card-gap: 16px/);
  assert.match(css, /--profile-media-card-gap: 12px/);
  assert.match(css, /scroll-snap-type: y proximity !important/);
  assert.match(css, /scroll-snap-stop: normal !important/);
  assert.match(css, /border-radius: 18px !important/);
  assert.match(css, /overflow-x: hidden !important/);
  assert.match(css, /:not\(\.is-profile-card-expanded\)/);
});

test("opening profile media never automatically requests native fullscreen", () => {
  for (const name of ["openPhotoViewerFromElement", "openProfileTvViewer"]) {
    assert.doesNotMatch(functionSource(name), /request.*Fullscreen/);
    assert.match(functionSource(name), /prepareProfileMediaCardExpand/);
  }
  const open = carousel.split("  function openViewer(")[1].split("  function closeViewer(")[0];
  assert.doesNotMatch(open, /requestViewerFullscreen/);
  assert.match(open, /settleViewerAtIndex\(index\)/);
  assert.match(carousel, /onClick=\{toggleViewerExpanded\}/);
  assert.match(live, /if \(expanded\) void requestProfilePhotoViewerFullscreen/);
  assert.match(live, /if \(expanded\) void requestProfileTvViewerFullscreen/);
});

test("card offsets keep the correct selection through gaps and thirty-item galleries", () => {
  for (const [height, gap, inset] of [[520, 12, 72], [732, 12, 72], [760, 16, 92], [844, 0, 0]]) {
    const offsets = Array.from({ length: 30 }, (_, i) => inset + i * (height + gap));
    for (let index = 0; index < offsets.length; index += 1) {
      const top = offsets[index] - inset;
      assert.equal(context.profileMediaCardScrollIndex(top, offsets, inset), index);
      assert.equal(context.profileMediaCardScrollIndex(top + height * .2, offsets, inset), index);
      const video = context.profileTvViewerScrollTarget(undefined, top, 844, offsets, inset);
      assert.equal(video.index, index);
      assert.equal(video.locked, false);
      const opening = context.profileTvViewerScrollTarget(String(index), 0, 844, offsets, inset);
      assert.equal(opening.index, index);
      assert.equal(opening.locked, true);
    }
    assert.equal(context.profileMediaCardScrollIndex(-100, offsets, inset), 0);
    assert.equal(context.profileMediaCardScrollIndex(100000, offsets, inset), 29);
  }
  assert.equal(context.profileMediaCardScrollIndex(0, [], 72), 0);
  assert.match(carousel, /feed\.scrollTop \+ \(parseFloat\(getComputedStyle\(feed\)\.scrollPaddingTop\)/);
});

test("instant opening bypasses smooth CSS scrolling in every profile viewer", () => {
  for (const name of ["scrollProfilePhotoViewerTo", "scrollProfileTvViewerTo"]) {
    assert.match(functionSource(name), /options\.instant[^]*?\? "instant" : "smooth"/);
    assert.match(functionSource(name), /offsetTop[^]*?- profileMediaCardScrollInset/);
  }
  assert.match(carousel, /options\.instant[^]*?\? "instant"\s*: "smooth"/);
});

test("live controls are preserved before clearing slides and follow the active card", () => {
  for (const name of ["renderProfilePhotoViewerSlides", "renderProfileTvViewerSlides"]) {
    assert.match(functionSource(name), /mountProfileMediaCardControls[^]*?innerHTML = ""/);
  }
  for (const name of ["closeProfilePhotoViewer", "closeProfileTvViewer"]) {
    assert.match(functionSource(name), /mountProfileMediaCardControls[^]*?innerHTML = ""/);
  }
  assert.match(functionSource("syncProfilePhotoViewerPosition"), /mountProfileMediaCardControls/);
  assert.match(functionSource("renderProfileTvViewerItem"), /mountProfileMediaCardControls/);
  assert.match(carousel, /ref=\{index === viewerIndex \? setViewerControlsHost : undefined\}/);
  assert.match(carousel, /viewerControlsHost \? createPortal\(/);
  assert.match(css, /position: absolute !important;[^]*?pointer-events: none/);
});

test("moving live controls never clones them or loses bound handlers", () => {
  const controls = Array.from({ length: 3 }, () => ({ parentElement: null }));
  let queries = 0;
  const makeHost = () => ({
    appendChild(control) { control.parentElement = this; },
  });
  const shell = makeHost();
  const slide = makeHost();
  const nextSlide = makeHost();
  const overlay = {
    querySelectorAll() { queries += 1; return controls; },
    querySelector() { return shell; },
  };
  vm.runInContext([
    functionSource("profileMediaCardControls"),
    functionSource("mountProfileMediaCardControls"),
  ].join("\n"), context);
  for (const target of [slide, nextSlide, null, slide]) {
    context.mountProfileMediaCardControls(overlay, target);
    assert.ok(controls.every((control) => control.parentElement === (target || shell)));
  }
  assert.equal(queries, 1, "cache the original control nodes once per viewer");
});
