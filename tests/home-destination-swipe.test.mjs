import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const homeSource = fs.readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");

test("mobile destinations can be changed with an easy deliberate horizontal swipe", () => {
  assert.match(
    homeSource,
    /const homeDestinationOrder = \["tonight", "dancers", "tv", "venues", "trending"\]/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab\) \{[\s\S]*?activeTab = nextTab;[\s\S]*?render\(\);[\s\S]*?focusAndLockHomeTvFeed[\s\S]*?focusHomeResults/,
  );
  assert.match(
    homeSource,
    /HOME_DESTINATION_SWIPE_MIN_PX = 44[\s\S]*?HOME_DESTINATION_SWIPE_MAX_MS = 1200[\s\S]*?HOME_DESTINATION_SWIPE_EDGE_GUARD_PX = 24/,
  );
  assert.match(
    homeSource,
    /addEventListener\("touchstart"[\s\S]*?window\.innerWidth > 720[\s\S]*?event\.touches\.length !== 1[\s\S]*?homeDestinationSwipeBlocked\(event\.target\)[\s\S]*?homeDestinationSwipe\.tracking = true/,
  );
  assert.match(
    homeSource,
    /addEventListener\("touchend"[\s\S]*?Math\.abs\(deltaX\) < HOME_DESTINATION_SWIPE_MIN_PX[\s\S]*?Math\.abs\(deltaX\) <= Math\.abs\(deltaY\) \* 1\.15[\s\S]*?moveToAdjacentHomeDestination\(deltaX < 0 \? 1 : -1\)[\s\S]*?event\.preventDefault\(\)/,
  );
});

test("swipe navigation works from controls and open profiles without stealing local media gestures", () => {
  const swipeBlocker = homeSource.match(
    /function homeDestinationSwipeBlocked\(target\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  assert.match(
    swipeBlocker,
    /input, select, textarea,[\s\S]*?#modalImage,[\s\S]*?modal-gallery,[\s\S]*?profile-photo-viewer,[\s\S]*?profile-tv-strip-list,[\s\S]*?profile-tv-viewer/,
  );
  assert.doesNotMatch(
    swipeBlocker,
    /button, a|#discoveryTabs|modal-backdrop|profileBackdrop|overlay-open/,
  );
  assert.match(
    homeSource,
    /function activateHomeDestination\(nextTab\) \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)[\s\S]*?closeProfileModal\(\)/,
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

test("global destination swiping still rejects vertical scrolling and browser-edge gestures", () => {
  assert.match(
    homeSource,
    /Math\.abs\(deltaX\) <= Math\.abs\(deltaY\) \* 1\.15/,
  );
  assert.match(
    homeSource,
    /touch\.clientX <= HOME_DESTINATION_SWIPE_EDGE_GUARD_PX[\s\S]*?touch\.clientX >= window\.innerWidth - HOME_DESTINATION_SWIPE_EDGE_GUARD_PX/,
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
