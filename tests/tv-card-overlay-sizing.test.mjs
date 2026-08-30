import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeSource = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const fullTvSource = readFileSync(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8");

test("homepage TV overlays use a compact safe action system", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-copy \{[\s\S]*?right: 68px;[\s\S]*?gap: 4px;[\s\S]*?padding: 68px 0 14px 14px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-dancer \{[\s\S]*?min-height: 48px;[\s\S]*?grid-template-columns: 48px minmax\(0, 1fr\);[\s\S]*?font-size: clamp\(20px, 5vw, 26px\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-slide \{[\s\S]*?--home-tv-action-control-size: 46px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-action \{[\s\S]*?width: var\(--home-tv-action-control-size\);[\s\S]*?min-width: var\(--home-tv-action-control-size\);[\s\S]*?max-width: var\(--home-tv-action-control-size\);[\s\S]*?height: var\(--home-tv-action-control-size\);[\s\S]*?min-height: var\(--home-tv-action-control-size\);[\s\S]*?max-height: var\(--home-tv-action-control-size\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-action \.action-icon \{[\s\S]*?width: 19px !important;[\s\S]*?height: 19px !important;[\s\S]*?flex: 0 0 19px !important;[\s\S]*?place-items: center;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-deal-action \{[\s\S]*?width: var\(--home-tv-action-control-size\) !important;[\s\S]*?height: var\(--home-tv-action-control-size\) !important;[\s\S]*?font-size: 7px;/,
  );
  assert.match(homeSource, /if \(dealState\.key === "available"\)/);
  assert.doesNotMatch(fullTvSource, /TvClubDealUnavailable|tv-club-deal-unavailable/);
});

test("standalone TV cards use the same sound, avatar, and title scale", () => {
  assert.match(
    fullTvSource,
    /\.tv-sound \{[^}]*width: 52px[^}]*height: 52px[^}]*max-height: 52px/,
  );
  assert.match(
    fullTvSource,
    /\.tv-profile-body \{[^}]*grid-template-columns: 52px minmax\(0, 1fr\)[^}]*gap: 10px[^}]*padding: 76px 18px 18px/,
  );
  assert.match(fullTvSource, /\.tv-profile-photo \{[^}]*width: 52px[^}]*height: 52px/);
  assert.match(
    fullTvSource,
    /\.tv-profile-body h2 \{[^}]*font-size: clamp\(20px, 3vw, 28px\)/,
  );
});

test("TV card frame and bottom navigation geometry remain unchanged", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-slide \{[\s\S]*?height: clamp\(560px, calc\(100svh - 140px\), 760px\);/,
  );
  assert.match(
    homeSource,
    /#results\.home-tv-feed > \.home-tv-feed-slide \{[\s\S]*?height: clamp\(520px, calc\(100svh - 112px\), 920px\) !important;/,
  );
  assert.match(homeSource, /#discoveryTabs \{[\s\S]*?height: 72px;/);
});
