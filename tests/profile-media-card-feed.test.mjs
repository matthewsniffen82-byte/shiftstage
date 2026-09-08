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

test("both profile entry points share TV video sizing and natural-photo card styles", () => {
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
  assert.match(css, /scroll-snap-type: none !important/);
  assert.match(css, /scroll-snap-align: none !important/);
  assert.match(css, /scroll-snap-stop: normal !important/);
  assert.match(css, /border-radius: 18px !important/);
  assert.match(css, /overflow-x: hidden !important/);
  assert.doesNotMatch(css, /is-profile-card-expanded/);
});

test("profile media has no expand controls or native fullscreen requests", () => {
  for (const name of ["openPhotoViewerFromElement", "openProfileTvViewer"]) {
    assert.doesNotMatch(functionSource(name), /request.*Fullscreen/);
    assert.match(functionSource(name), /renderProfile(?:Photo|Tv)ViewerSlides/);
  }
  const open = carousel.split("  function openViewer(")[1].split("  function closeViewer(")[0];
  assert.doesNotMatch(open, /requestViewerFullscreen/);
  assert.match(open, /settleViewerAtIndex\(index\)/);
  assert.doesNotMatch(carousel, /requestFullscreen|webkitRequestFullscreen|viewerExpanded|profile-media-card-expand/);
  assert.doesNotMatch(live, /requestProfile(?:Photo|Tv)ViewerFullscreen|profile-media-card-expand|prepareProfileMediaCardExpand/);
  assert.match(carousel, /controls=\{false\}/);
  assert.match(carousel, /toggleViewerPlayback\(event\.currentTarget\)/);
  assert.match(carousel, /aria-label=\{inlineMuted \? "Turn sound on" : "Mute video"\}/);
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
    assert.match(functionSource(name), /top: (?:activePhotoIndex|index) === 0 \? 0 : Math\.max\(0, activeSlide\?\.offsetTop \?\? 0\)/);
  }
  assert.match(carousel, /options\.instant[^]*?\? "instant"\s*: "smooth"/);
});

test("photo card height follows the source ratio without changing video card height", () => {
  assert.match(css, /\[data-profile-photo-card\] \{[^}]*height: auto !important;[^}]*min-height: 0 !important;[^}]*max-height: none !important;[^}]*aspect-ratio: var\(--profile-photo-card-ratio, 9 \/ 16\)/);
  assert.match(css, /\[data-profile-photo-card\] > :is\(img, \.profile-photo-viewer-slide-image\) \{[^}]*width: 100% !important;[^}]*height: auto !important/);
  assert.match(live, /slide\.dataset\.profilePhotoCard = "true"/);
  assert.match(carousel, /data-profile-photo-card=\{item\.kind === "photo" \? "true" : undefined\}/);
  assert.match(live, /sizeProfilePhotoCard\(image\.parentElement, probe\.naturalWidth, probe\.naturalHeight\)/);
  assert.match(carousel, /sizeProfilePhotoCard\(event\.currentTarget\)/);
  assert.match(carousel, /sizeProfilePhotoCard\(image\)/);
  for (const source of [live, carousel]) {
    assert.match(source, /feed\.scrollTop \+ anchor\.offsetTop - before, behavior: "instant"/);
  }
});

test("complete photo cards scale down and center within the usable mobile screen", () => {
  assert.match(css, /--profile-photo-card-height-limit: max\(1px, calc\(100svh - var\(--profile-media-card-header\) - 24px - env\(safe-area-inset-bottom, 0px\)\)\)/);
  assert.match(css, /\[data-profile-photo-card\] \{[^}]*width: min\(100%, calc\(\(var\(--profile-photo-card-height-limit\) - var\(--profile-photo-card-control-space, 0px\)\) \* var\(--profile-photo-card-ratio, 9 \/ 16\)\)\) !important;[^}]*margin-inline: auto !important/);
  assert.match(css, /\[data-photo-shape="panorama"\] \{[^}]*--profile-photo-card-control-space: 70px/);
  assert.match(css, /height: var\(--profile-media-card-height\) !important/);
});

test("mixed-height photo feeds select the visible card and can reach a short final photo", () => {
  vm.runInContext(functionSource("profilePhotoCardScrollIndex"), context);
  const offsets = [72, 1284, 1688, 1900];
  assert.equal(context.profilePhotoCardScrollIndex(0, offsets, 700, 2130), 0);
  assert.equal(context.profilePhotoCardScrollIndex(1000, offsets, 700, 2130), 0);
  assert.equal(context.profilePhotoCardScrollIndex(1284, offsets, 700, 2130), 1);
  assert.equal(context.profilePhotoCardScrollIndex(1430, offsets, 700, 2130), 3);
  assert.equal(context.profilePhotoCardScrollIndex(0, [], 700, 700), 0);
  assert.match(carousel, /viewerKind === "photo"[^]*?profilePhotoCardScrollIndex\(scrollTop, slides\.map/);
});

test("one in-flow header scrolls away, with no header padding repeated on later cards", () => {
  assert.match(css, /\.profile-media-card-header \{[^}]*position: relative;[^}]*height: var\(--profile-media-card-header\)/);
  assert.doesNotMatch(css, /position: (?:fixed|sticky)/);
  assert.match(css, /padding: 0 5px 24px !important/);
  assert.match(css, /scroll-padding: 0 !important/);
  assert.match(carousel, /data-profile-media-scroll-feed[^]*?<div className="profile-media-card-header">[^]*?viewerItems\.map/);
  for (const name of ["renderProfilePhotoViewerSlides", "renderProfileTvViewerSlides"]) {
    assert.match(functionSource(name), /mountProfileMediaCardHeader[^]*?innerHTML = ""[^]*?mountProfileMediaCardHeader/);
  }
  assert.match(functionSource("mountProfileMediaCardHeader"), /host\.prepend\(header\)/);
});

test("profile cards keep complete photos visible while videos use TV edge-to-edge fill", () => {
  assert.match(css, /\.profile-photo-viewer-slide-image \{[^}]*background-size: contain !important;[^}]*background-repeat: no-repeat !important/);
  assert.match(css, /> :is\(img, video\) \{[^}]*object-fit: cover !important;[^}]*object-position: center !important/);
  assert.match(css, /\.profile-media-viewer-slide > img \{[^}]*object-fit: contain !important/);
  assert.match(css, /background: #000 !important/);
});

test("all profile media controls use the regular TV translucent glass material", () => {
  const aesthetic = fs.readFileSync("public/dancr-aesthetic.v1.css", "utf8");
  for (const material of [
    "border: 1px solid rgba(255, 255, 255, 0.28) !important",
    "background-color: rgba(18, 18, 28, 0.38) !important",
    "0 8px 22px rgba(0, 0, 0, 0.3) !important",
    "-webkit-backdrop-filter: blur(16px) saturate(1.18) !important",
    "backdrop-filter: blur(16px) saturate(1.18) !important",
    "background-color: rgba(28, 28, 40, 0.48) !important",
  ]) {
    assert.ok(css.includes(material), material);
    assert.ok(aesthetic.includes(material), "match existing TV: " + material);
  }
  for (const prefix of ["profile-photo", "profile-tv", "profile-media"]) {
    assert.ok(css.includes(`.${prefix}-viewer-actions > button`));
    assert.ok(css.includes(`.${prefix}-viewer-previous`));
    assert.ok(css.includes(`.${prefix}-viewer-next`));
  }
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
