import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";

const live = fs.readFileSync("outputs/index.html", "utf8");
const carousel = fs.readFileSync("app/dancers/[slug]/DancerPhotoCarousel.tsx", "utf8");
const css = fs.readFileSync("public/profile-media-card-feed.css", "utf8");
const layout = fs.readFileSync("app/dancers/layout.tsx", "utf8");
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
  assert.match(layout, /import "\.\.\/\.\.\/public\/profile-media-card-feed\.css"/);
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
  assert.match(css, /@media \(max-width: 720px\)[^]*?--profile-media-card-gap: 12px/);
  assert.match(css, /scroll-snap-type: none !important/);
  assert.match(css, /scroll-snap-align: none !important/);
  assert.match(css, /scroll-snap-stop: normal !important/);
  postcss.parse(css).walkDecls(/^scroll-snap-(type|align)$/, declaration => {
    if (declaration.value === "none") return;
    assert.ok(declaration.parent.selector.startsWith(".profile-media-card-feed.is-media-fullscreen "),
      "snapping must be limited to expanded media, including mobile overrides");
  });
  assert.match(css, /border-radius: 18px !important/);
  assert.match(css, /overflow-x: hidden !important/);
  assert.doesNotMatch(css, /is-profile-card-expanded/);
});

test("profile media opens at normal size and expands only from its control", () => {
  for (const name of ["openPhotoViewerFromElement", "openProfileTvViewer"]) {
    assert.doesNotMatch(functionSource(name), /request.*Fullscreen/);
    assert.match(functionSource(name), /renderProfile(?:Photo|Tv)ViewerSlides/);
  }
  const open = carousel.split("  function openViewer(")[1].split("  function closeViewer(")[0];
  assert.doesNotMatch(open, /requestViewerFullscreen/);
  assert.match(open, /settleViewerAtIndex\(index\)/);
  assert.doesNotMatch(carousel, /requestFullscreen|webkitRequestFullscreen|viewerExpanded|profile-media-card-expand/);
  assert.doesNotMatch(live, /requestProfile(?:Photo|Tv)ViewerFullscreen|profile-media-card-expand|prepareProfileMediaCardExpand/);
  assert.match(carousel, /className="profile-media-control-fullscreen"/);
  assert.match(css, /\.profile-media-card-feed\.is-media-fullscreen/);
  assert.match(carousel, /controls=\{false\}/);
  assert.match(carousel, /toggleViewerPlayback\(event\.currentTarget, index\)/);
  assert.match(carousel, /aria-label=\{inlineMuted \? "Turn sound on" : "Mute video"\}/);
});

test("card offsets keep the correct selection through gaps and thirty-item galleries", () => {
  for (const [height, gap, inset] of [[520, 12, 72], [732, 16, 72], [760, 12, 92], [844, 0, 0]]) {
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
  // A full-size image box can still letterbox its contents. Check every fit
  // declaration, including later shared overrides, for both rendering methods.
  const fitDeclarations = [];
  postcss.parse(css).walkDecls(/^(object-fit|background-size)$/, declaration => {
    fitDeclarations.push(declaration);
    assert.equal(declaration.value, "cover", `${declaration.parent.selector}: ${declaration.prop} must fill its card`);
  });
  for (const property of ["object-fit", "background-size"]) {
    for (const viewer of [".profile-media-card-feed", ".profile-media-card-feed.is-media-fullscreen"]) {
      const photoSelector = `${viewer} [data-profile-photo-card] > :is(img, .profile-photo-viewer-slide-image)`;
      assert.ok(fitDeclarations.some(declaration => declaration.prop === property && declaration.important
        && declaration.parent.selectors.includes(photoSelector)), `${photoSelector} needs explicit ${property}: cover`);
    }
  }
  assert.match(live, /slide\.dataset\.profilePhotoCard = "true"/);
  assert.match(carousel, /data-profile-photo-card=\{item\.kind === "photo" \? "true" : undefined\}/);
  assert.match(live, /sizeProfilePhotoCard\(image\.parentElement, probe\.naturalWidth, probe\.naturalHeight\)/);
  assert.match(carousel, /sizeProfilePhotoCard\(event\.currentTarget\)/);
  assert.match(carousel, /sizeProfilePhotoCard\(image\)/);
  for (const source of [live, carousel]) {
    assert.match(source, /feed\.scrollTop \+ anchor\.offsetTop - before, behavior: "instant"/);
  }
});

test("normal photo cards use the same height as regular TV cards", () => {
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
    assert.ok(neighborPeek >= 18 && neighborPeek <= 24, "a centered card leaves just a sliver above and below");
  }
  assert.match(live, /\.home-tv-feed-loading \{[^}]*height: var\(--dancr-scroll-card-height\);[^}]*min-height: var\(--dancr-scroll-card-height\);[^}]*max-height: var\(--dancr-scroll-card-height\)/);
  assert.match(fs.readFileSync("public/profile-photo-crop.js", "utf8"), /height:var\(--profile-media-card-height\)/);
  const tvMobile = fs.readFileSync("src/live-shell/styles/override-styles-03-home-discovery-empty-action-is-secondary-hover-home-discovery-em.css", "utf8");
  const tvGap = tvMobile.match(/#results\.home-tv-feed \{[^}]*gap: (\d+)px !important/);
  assert.equal(gap, Number(tvGap?.[1]), "regular cards use the TV feed's mobile gap");
});

test("mixed-height photo feeds select the visible card and can reach a short final photo", () => {
  vm.runInContext(functionSource("profilePhotoCardScrollIndex"), context);
  const offsets = [72, 1284, 1688, 1900];
  assert.equal(context.profilePhotoCardScrollIndex(0, offsets, 700, 2130), 0);
  assert.equal(context.profilePhotoCardScrollIndex(1000, offsets, 700, 2130), 0);
  assert.equal(context.profilePhotoCardScrollIndex(1284, offsets, 700, 2130), 1);
  assert.equal(context.profilePhotoCardScrollIndex(1430, offsets, 700, 2130), 3);
  assert.equal(context.profilePhotoCardScrollIndex(0, [], 700, 700), 0);
  assert.match(live, /profilePhotoViewerImage\.scrollTop \+ profileMediaCardScrollInset\(profilePhotoViewerImage\)/);
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
  const headerRule = css.match(/\.profile-media-card-header \{[^}]*\}/)?.[0];
  assert.ok(headerRule);
  assert.doesNotMatch(headerRule, /position: (?:fixed|sticky)/);
  assert.match(css, /padding: 0 5px 24px !important/);
  assert.match(css, /scroll-padding: 0 !important/);
  assert.match(carousel, /data-profile-media-scroll-feed[^]*?<div className="profile-media-card-header">[^]*?viewerItems\.map/);
  for (const name of ["renderProfilePhotoViewerSlides", "renderProfileTvViewerSlides"]) {
    assert.match(functionSource(name), /mountProfileMediaCardHeader[^]*?innerHTML = ""[^]*?mountProfileMediaCardHeader/);
  }
  assert.match(functionSource("mountProfileMediaCardHeader"), /host\.prepend\(header\)/);
});

test("expanded photos and videos use TV's full-viewport paging and overlay controls for every media shape", () => {
  const root = postcss.parse(css);
  const tv = postcss.parse(fs.readFileSync("src/live-shell/styles/override-styles-01-main-stack-main-stack.css", "utf8"));
  const values = (tree, match) => {
    const rule = tree.nodes.find(node => node.type === "rule" && match(node.selector));
    assert.ok(rule, "expected layout rule");
    return Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  };
  const full = ".profile-media-card-feed.is-media-fullscreen";
  const variables = values(root, selector => selector === full);
  const stage = values(root, selector => selector === `${full} :is(.profile-photo-viewer-image, .profile-tv-viewer-stage, .profile-media-viewer-stage)`);
  const slide = values(root, selector => selector === `${full} :is(.profile-photo-viewer-slide, .profile-tv-viewer-slide, .profile-media-viewer-slide)`);
  const tvStage = values(tv, selector => selector.endsWith("#results.home-tv-feed.is-fullscreen-feed"));
  const tvSlide = values(tv, selector => selector.endsWith("#results.home-tv-feed.is-fullscreen-feed > .home-tv-feed-slide"));
  assert.equal(variables["--profile-media-card-height"], tvSlide.height);
  assert.equal(variables["--profile-media-card-height"], "100dvh");
  assert.equal(slide.height, "var(--profile-media-card-height)");
  assert.equal(slide["min-height"], slide.height);
  for (const property of ["margin", "border-radius", "scroll-snap-align", "scroll-snap-stop", "box-shadow"]) {
    assert.equal(slide[property], tvSlide[property], property);
  }
  assert.equal(variables["--profile-media-card-gap"], "0px");
  assert.equal(stage.padding, tvStage.padding);
  assert.equal(stage["scroll-snap-type"], tvStage["scroll-snap-type"]);
  const media = values(root, selector => selector.startsWith(full) && selector.endsWith("> :is(img, video, .profile-photo-viewer-slide-image)"));
  const tvMedia = values(tv, selector => selector === ".home-tv-feed-video");
  for (const property of ["position", "inset", "width", "height", "object-fit"]) {
    assert.equal(media[property], tvMedia[property], property);
  }
  assert.equal(media["aspect-ratio"], "auto", "source proportions must not resize the viewport card");
  assert.doesNotMatch(css, /data-media-controls|var\(--profile-media-card-ratio/);
  const footer = values(root, selector => selector === ".profile-media-card-feed :is(.profile-photo-viewer-footer, .profile-tv-viewer-footer, .profile-media-viewer-footer)");
  const actions = values(root, selector => selector === ".profile-media-card-feed :is(.profile-photo-viewer-actions, .profile-tv-viewer-actions, .profile-media-viewer-actions)");
  assert.equal(footer.position, "absolute");
  assert.equal(footer.inset, "0");
  assert.equal(actions.position, "absolute");
  assert.equal(actions.display, "grid", "actions remain a vertical overlay instead of moving below wide photos");
});

test("each media card has a back arrow that closes only its own viewer", () => {
  const backContext = vm.createContext({
    document: {
      createElement: () => ({
        attributes: {}, listeners: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, handler) { this.listeners[name] = handler; },
      }),
    },
  });
  vm.runInContext(functionSource("appendProfileMediaBackButton"), backContext);
  let photosClosed = 0;
  let videosClosed = 0;
  const photo = { appendChild(button) { this.back = button; } };
  const video = { appendChild(button) { this.back = button; } };
  backContext.appendProfileMediaBackButton(photo, () => { photosClosed += 1; });
  backContext.appendProfileMediaBackButton(video, () => { videosClosed += 1; });
  for (const [card, expected] of [[photo, [1, 0]], [video, [1, 1]]]) {
    let prevented = false;
    let stopped = false;
    card.back.listeners.click({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
    assert.deepEqual([photosClosed, videosClosed], expected);
    assert.ok(prevented && stopped, "back must not trigger video playback or a parent profile action");
    assert.equal(card.back.attributes["aria-label"], "Back to dancer profile");
    assert.equal(card.back.type, "button");
  }
  assert.match(functionSource("renderProfilePhotoViewerSlides"), /appendProfileMediaBackButton\(slide, closeProfilePhotoViewer\)/);
  assert.match(functionSource("renderProfileTvViewerSlides"), /appendProfileMediaBackButton\(slide, closeProfileTvViewer\)/);
  assert.match(carousel, /viewerItems\.map[^]*?className="profile-media-card-back"[^]*?onClick=\{closeViewer\}/);
  assert.doesNotMatch(carousel, /className="profile-media-viewer-close"/);
  assert.doesNotMatch(live, /<button[^>]*class="[^"]*profile-(?:photo|tv)-viewer-close/);
  assert.doesNotMatch(functionSource("mountProfileMediaCardHeader"), /appendChild\(close\)/);
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
  assert.match(functionSource("renderProfilePhotoViewerSlides"), /mountProfilePhotoCardControls\(slide, item, index, profileName\)/);
  assert.match(functionSource("renderProfileTvViewerItem"), /mountProfileMediaCardControls/);
  assert.match(carousel, /\{renderViewerControls\(item, index, openDeal\)\}\s*<\/section>/);
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
