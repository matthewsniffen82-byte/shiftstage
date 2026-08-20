import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeSource = fs.readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");

test("mobile destinations can be changed with an easy deliberate horizontal swipe", () => {
  assert.match(
    homeSource,
    /const homeDestinationOrder = \["dancers", "tv", "venues"\]/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab, options = \{\}\) \{[\s\S]*?activeTab = nextTab;[\s\S]*?render\(\);[\s\S]*?options\.scroll !== false[\s\S]*?focusHomeResults\(\)/,
  );
  assert.match(
    homeSource,
    /HOME_DESTINATION_SWIPE_MIN_PX = 34[\s\S]*?HOME_DESTINATION_SWIPE_FLICK_MIN_PX = 22[\s\S]*?HOME_DESTINATION_SWIPE_FLICK_VELOCITY = \.32[\s\S]*?HOME_DESTINATION_SWIPE_MAX_MS = 1400[\s\S]*?HOME_DESTINATION_SWIPE_EDGE_GUARD_PX = 20/,
  );
  assert.match(
    homeSource,
    /addEventListener\("touchstart"[\s\S]*?window\.innerWidth > 720[\s\S]*?event\.touches\.length !== 1[\s\S]*?homeDestinationSwipeBlocked\(event\.target\)[\s\S]*?homeDestinationSwipe\.tracking = true/,
  );
  assert.match(
    homeSource,
    /addEventListener\("touchmove"[\s\S]*?HOME_DESTINATION_SWIPE_DIRECTION_LOCK_PX[\s\S]*?HOME_DESTINATION_SWIPE_HORIZONTAL_RATIO[\s\S]*?setHomeDestinationSwipeOffset\(deltaX\)[\s\S]*?event\.preventDefault\(\)/,
  );
  assert.match(
    homeSource,
    /addEventListener\("touchend"[\s\S]*?distanceX >= HOME_DESTINATION_SWIPE_MIN_PX[\s\S]*?HOME_DESTINATION_SWIPE_FLICK_MIN_PX[\s\S]*?HOME_DESTINATION_SWIPE_FLICK_VELOCITY[\s\S]*?moveToAdjacentHomeDestination\(deltaX < 0 \? 1 : -1\)[\s\S]*?event\.preventDefault\(\)/,
  );
});

test("TV cards and full profiles allow destination swipes while galleries keep their gestures", () => {
  const swipeBlocker = homeSource.match(
    /function homeDestinationSwipeBlocked\(target\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  assert.doesNotMatch(swipeBlocker, /profileBackdrop\.classList\.contains/);
  assert.doesNotMatch(swipeBlocker, /profile-full-view-open|venue-full-view-open/);
  assert.match(
    swipeBlocker,
    /#modalImage,[\s\S]*?#modalGallery,[\s\S]*?profile-photo-viewer,[\s\S]*?profile-tv-strip-list,[\s\S]*?profile-tv-viewer/,
  );
  assert.doesNotMatch(swipeBlocker, /home-tv-feed-slide/);
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab, options = \{\}\) \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\);[\s\S]*?deactivateHomeTvFeed\(\)/,
  );
  assert.doesNotMatch(
    homeSource,
    /function activateHomeDestination\(nextTab, options = \{\}\) \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)\) return false;/,
  );
  assert.match(
    homeSource,
    /touch\.clientX <= HOME_DESTINATION_SWIPE_EDGE_GUARD_PX[\s\S]*?touch\.clientX >= window\.innerWidth - HOME_DESTINATION_SWIPE_EDGE_GUARD_PX/,
  );
  assert.match(
    homeSource,
    /document\.addEventListener\("touchcancel", resetHomeDestinationSwipe, \{ passive: true, capture: true \}\)/,
  );
});

test("bottom navigation taps are not captured by the destination swipe gesture", () => {
  const swipeBlocker = homeSource.match(
    /function homeDestinationSwipeBlocked\(target\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  assert.match(swipeBlocker, /#discoveryTabs/);
  assert.match(swipeBlocker, /\.global-mobile-bottom-nav/);
});

test("global destination swiping still rejects vertical scrolling and browser-edge gestures", () => {
  assert.match(
    homeSource,
    /distanceY > distanceX \* HOME_DESTINATION_SWIPE_HORIZONTAL_RATIO[\s\S]*?resetHomeDestinationSwipe\(\)/,
  );
  assert.match(
    homeSource,
    /touch\.clientX <= HOME_DESTINATION_SWIPE_EDGE_GUARD_PX[\s\S]*?touch\.clientX >= window\.innerWidth - HOME_DESTINATION_SWIPE_EDGE_GUARD_PX/,
  );
});

test("the current discovery content follows the finger and settles smoothly", () => {
  assert.match(
    homeSource,
    /body\.home-destination-swipe-active \.content-head,[\s\S]*?body\.home-destination-swipe-active #results[\s\S]*?translate3d\(var\(--home-destination-swipe-offset, 0px\), 0, 0\)[\s\S]*?transition: none/,
  );
  assert.match(
    homeSource,
    /function setHomeDestinationSwipeOffset\(deltaX\)[\s\S]*?resistance = canMove \? \.16 : \.05[\s\S]*?--home-destination-swipe-offset[\s\S]*?home-destination-swipe-active/,
  );
  assert.match(
    homeSource,
    /prefers-reduced-motion: reduce[\s\S]*?\.content-head,[\s\S]*?#results[\s\S]*?transition: none/,
  );
});

test("buttons and swipe gestures share the same production destination activation path", () => {
  assert.match(
    homeSource,
    /homeBottomTv\?\.addEventListener\("click"[\s\S]*?activateHomeDestination\("tv"\)/,
  );
  assert.match(
    homeSource,
    /document\.querySelectorAll\("\.tab"\)\.forEach\(\(tab\) => \{[\s\S]*?activateHomeDestination\(tab\.dataset\.tab \|\| ""\)/,
  );
  assert.match(
    homeSource,
    /function moveToAdjacentHomeDestination\(direction\) \{[\s\S]*?homeDestinationOrder\.indexOf\(activeTab\)[\s\S]*?activateHomeDestination\(homeDestinationOrder\[nextIndex\]\)/,
  );
});
