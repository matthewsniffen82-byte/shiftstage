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

test("both profile entry points share TV video sizing and screen-filling photo card styles", () => {
  assert.match(live, /href="\/profile-media-card-feed\.css\?v=\d+"/);
  assert.match(layout, /import "\.\.\/public\/profile-media-card-feed\.css"/);
  assert.match(live, /class="profile-photo-viewer profile-media-card-feed"/);
  assert.match(live, /class="profile-tv-viewer profile-media-card-feed"/);
  assert.match(carousel, /profile-media-viewer profile-media-card-feed/);
  for (const size of [
    "clamp(560px, calc(100svh - 80px), 920px)",
    "clamp(520px, calc(100svh - 64px), 1040px)",
  ]) {
    assert.ok(css.includes(size));
  }
  assert.match(css, /--profile-media-card-height: var\(--dancr-scroll-card-height\)/);
  assert.match(live, /\.home-tv-feed-slide \{[^}]*height: var\(--dancr-scroll-card-height\);[^}]*min-height: var\(--dancr-scroll-card-height\);[^}]*max-height: var\(--dancr-scroll-card-height\)/);
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
  assert.match(carousel, /toggleViewerPlayback\(event\.currentTarget, index\)/);
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

test("photo cards fill the available width and height without changing video sizing", () => {
  assert.match(css, /\[data-profile-photo-card\] \{[^}]*width: 100% !important;[^}]*height: var\(--profile-media-card-height\) !important;[^}]*min-height: var\(--profile-media-card-height\) !important;[^}]*max-height: var\(--profile-media-card-height\) !important;[^}]*aspect-ratio: auto/);
  assert.match(css, /\[data-profile-photo-card\] > :is\(img, \.profile-photo-viewer-slide-image\) \{[^}]*width: 100% !important;[^}]*height: 100% !important/);
  assert.match(live, /slide\.dataset\.profilePhotoCard = "true"/);
  assert.match(carousel, /data-profile-photo-card=\{item\.kind === "photo" \? "true" : undefined\}/);
  assert.match(live, /sizeProfilePhotoCard\(image\.parentElement, probe\.naturalWidth, probe\.naturalHeight\)/);
  assert.match(carousel, /sizeProfilePhotoCard\(event\.currentTarget\)/);
  assert.match(carousel, /sizeProfilePhotoCard\(image\)/);
  for (const source of [live, carousel]) {
    assert.match(source, /feed\.scrollTop \+ anchor\.offsetTop - before, behavior: "instant"/);
  }
});

test("photo cards use the same height and spacing as regular TV cards", () => {
  assert.doesNotMatch(css, /--profile-photo-card-height-limit/);
  assert.doesNotMatch(css, /--profile-photo-card-ratio|--profile-photo-card-control-space|data-photo-shape/);
  assert.match(css, /height: var\(--profile-media-card-height\) !important/);
});

test("taller shared phone cards leave only a small neighboring-card peek", () => {
  const mobile = css.split("@media (max-width: 720px)")[1];
  const heightRule = mobile.match(/--dancr-scroll-card-height: clamp\((\d+)px, calc\(100svh - (\d+)px\), (\d+)px\)/);
  assert.ok(heightRule);
  const [, minimum, inset, maximum] = heightRule.map(Number);
  const gap = Number(mobile.match(/--profile-media-card-gap: (\d+)px/)[1]);
  for (const viewport of [667, 800, 844, 852, 915, 932]) {
    const card = Math.min(maximum, Math.max(minimum, viewport - inset));
    const oldCard = Math.min(920, Math.max(520, viewport - 112));
    assert.equal(card - oldCard, 48, "grow the card without changing its width or gap");
    const neighborPeek = (viewport - card) / 2 - gap;
    assert.ok(neighborPeek >= 16 && neighborPeek <= 24, "a centered card leaves just a sliver above and below");
  }
  assert.match(live, /\.home-tv-feed-loading \{[^}]*height: var\(--dancr-scroll-card-height\);[^}]*min-height: var\(--dancr-scroll-card-height\);[^}]*max-height: var\(--dancr-scroll-card-height\)/);
  assert.match(fs.readFileSync("public/profile-photo-crop.js", "utf8"), /height:var\(--profile-media-card-height\)/);
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

test("photo windows load the lower card before the previous card fully leaves the screen", () => {
  const images = Array.from({ length: 50 }, (_, index) => ({
    dataset: { profilePhotoUrl: `https://media.test/photo-${index}.jpg`, profilePhotoSized: "true" },
    style: {
      backgroundImage: "",
      removeProperty(name) { if (name === "background-image") this.backgroundImage = ""; },
    },
  }));
  const photoContext = vm.createContext({
    profilePhotoViewerImage: { querySelectorAll: () => images },
    safeCssUrl: (url) => url,
  });
  vm.runInContext([
    functionSource("profilePhotoCardScrollIndex"),
    functionSource("syncProfilePhotoViewerWindow"),
  ].join("\n"), photoContext);
  const reactWindow = carousel.match(/src=\{(Math\.abs\(index - viewerIndex\) <= \d+) \? item\.imageUrl : undefined\}/)?.[1];
  assert.ok(reactWindow, "React photo sources must have a bounded preload window");
  const reactShouldLoad = vm.runInNewContext(`(index, viewerIndex) => ${reactWindow}`);
  const offsets = images.map((_, index) => 72 + index * (780 + 12));
  for (const previous of [0, 1, 12, 35, 47, 12, 1, 0]) {
    // The previous card still has a small sliver onscreen, while the card after the
    // central one is already visible below it. Selection has not advanced yet.
    const scrollTop = offsets[previous + 1] - 32;
    const active = photoContext.profilePhotoCardScrollIndex(scrollTop, offsets, 844, offsets.at(-1) + 780 + 24);
    assert.equal(active, previous);
    assert.ok(offsets[previous + 2] < scrollTop + 844, "lower card is onscreen");
    photoContext.syncProfilePhotoViewerWindow(active);
    for (const visible of [previous, previous + 1, previous + 2]) {
      assert.ok(images[visible].style.backgroundImage, `live photo ${visible} must already have its source`);
      assert.equal(reactShouldLoad(visible, active), true, `React photo ${visible} must already have its source`);
    }
    assert.ok(images.filter((image) => image.style.backgroundImage).length <= 5, "do not load all fifty photos");
    assert.ok(images.filter((_, index) => reactShouldLoad(index, active)).length <= 5);
  }
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

test("profile photos and videos use edge-to-edge fill with centered cropping", () => {
  assert.match(css, /\.profile-photo-viewer-slide-image \{[^}]*background-size: cover !important;[^}]*background-position: center !important;[^}]*background-repeat: no-repeat !important/);
  assert.match(css, /> :is\(img, video\) \{[^}]*object-fit: cover !important;[^}]*object-position: center !important/);
  assert.doesNotMatch(css, /(?:object-fit|background-size): contain/);
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

test("video controls are preserved while photo controls stay attached to their own cards", () => {
  for (const name of ["renderProfilePhotoViewerSlides", "renderProfileTvViewerSlides"]) {
    assert.match(functionSource(name), /mountProfileMediaCardControls[^]*?innerHTML = ""/);
  }
  for (const name of ["closeProfilePhotoViewer", "closeProfileTvViewer"]) {
    assert.match(functionSource(name), /mountProfileMediaCardControls[^]*?innerHTML = ""/);
  }
  assert.doesNotMatch(functionSource("syncProfilePhotoViewerPosition"), /mountProfileMediaCardControls/);
  assert.match(functionSource("renderProfilePhotoViewerSlides"), /mountProfilePhotoCardControls\(slide, item, index, items\.length, profileName\)/);
  assert.match(functionSource("renderProfileTvViewerItem"), /mountProfileMediaCardControls/);
  assert.match(carousel, /\{renderViewerControls\(item, index\)\}\s*<\/section>/);
  assert.doesNotMatch(carousel, /viewerControlsHost|createPortal/);
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
