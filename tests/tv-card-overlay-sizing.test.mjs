import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeSource = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const fullTvSource = readFileSync(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8");

test("homepage TV overlays use one balanced 52px control system", () => {
  assert.match(
    homeSource,
    /\.home-tv-feed-copy \{[\s\S]*?right: 78px;[\s\S]*?gap: 5px;[\s\S]*?padding: 82px 0 18px 16px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-dancer \{[\s\S]*?min-height: 52px;[\s\S]*?grid-template-columns: 52px minmax\(0, 1fr\);[\s\S]*?font-size: clamp\(22px, 5\.4vw, 28px\);/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-action \{[\s\S]*?width: 52px;[\s\S]*?min-width: 52px;[\s\S]*?max-width: 52px;[\s\S]*?height: 52px;[\s\S]*?min-height: 52px;[\s\S]*?max-height: 52px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-deal-action \{[\s\S]*?width: 52px !important;[\s\S]*?height: 52px !important;[\s\S]*?font-size: 8px;/,
  );
  assert.match(
    homeSource,
    /\.home-tv-feed-deal-action\.is-unavailable[\s\S]*?color: rgba\(248,250,252,\.82\) !important;/,
  );
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
