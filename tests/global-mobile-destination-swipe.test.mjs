import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const navigationSource = fs.readFileSync(
  new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
  "utf8",
);

test("Next pages use the same consolidated three-destination full-screen swipe order", () => {
  assert.match(
    navigationSource,
    /id: "dancers"[\s\S]*?id: "tv"[\s\S]*?id: "venues"/,
  );
  assert.doesNotMatch(navigationSource, /id: "(?:tonight|trending)"/);
  assert.match(
    navigationSource,
    /destinations\.findIndex[\s\S]*?isActiveDestination\(pathname, destination\.id\)/,
  );
  assert.match(
    navigationSource,
    /const direction = deltaX < 0 \? 1 : -1;[\s\S]*?const nextIndex = currentIndex \+ direction;[\s\S]*?window\.location\.assign\(destinationHref\(destinations\[nextIndex\], city\)\)/,
  );
});

test("global swiping locks horizontal intent early without interrupting vertical scrolling", () => {
  assert.match(
    navigationSource,
    /MOBILE_SWIPE_DIRECTION_LOCK_PX = 10[\s\S]*?MOBILE_SWIPE_MIN_DISTANCE_PX = 34[\s\S]*?MOBILE_SWIPE_FLICK_DISTANCE_PX = 22[\s\S]*?MOBILE_SWIPE_FLICK_VELOCITY_PX_MS = 0\.32/,
  );
  assert.match(
    navigationSource,
    /const onTouchMove[\s\S]*?distanceY > distanceX \* MOBILE_SWIPE_HORIZONTAL_RATIO[\s\S]*?resetGesture\(\)[\s\S]*?gesture\.axis = "horizontal"[\s\S]*?event\.preventDefault\(\)/,
  );
  assert.match(
    navigationSource,
    /addEventListener\("touchmove", onTouchMove, \{[\s\S]*?passive: false,[\s\S]*?capture: true/,
  );
});

test("media carousels and form controls keep their own horizontal gestures", () => {
  assert.match(
    navigationSource,
    /MOBILE_SWIPE_BLOCKED_SELECTOR[\s\S]*?"input"[\s\S]*?"\[role='slider'\]"[\s\S]*?"\[data-carousel-swipe-surface\]"[\s\S]*?"\.tv-video-viewer"[\s\S]*?"\.profile-tv-viewer"/,
  );
  assert.match(
    navigationSource,
    /mobileNavigationSwipeBlocked\(event\.target\)/,
  );
});

test("swipe feedback previews the next destination and supports reduced motion", () => {
  assert.match(
    navigationSource,
    /className="global-mobile-swipe-indicator"[\s\S]*?data-mobile-swipe-arrow[\s\S]*?data-mobile-swipe-label/,
  );
  assert.match(
    navigationSource,
    /const updateIndicator = \(deltaX: number\)[\s\S]*?destinations\[nextIndex\]\.label[\s\S]*?is-ready[\s\S]*?is-visible/,
  );
  assert.match(
    navigationSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?global-mobile-swipe-indicator[\s\S]*?transition: none/,
  );
});
