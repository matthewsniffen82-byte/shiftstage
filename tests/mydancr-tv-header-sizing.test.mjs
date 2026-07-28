import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [home, tvFeed] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
]);

test("MyDancr TV matches the homepage header control sizing", () => {
  assert.match(
    home,
    /\.logo-image-button \.mydancr-live-logo[\s\S]*?font-size: clamp\(38px, 5\.7vw, 50px\) !important;/,
  );
  assert.match(
    tvFeed,
    /\.tv-global-logo span \{ color: #fff; font-size: clamp\(38px, 5\.7vw, 50px\);/,
  );
  assert.match(
    home,
    /#accountBtn \{\s*min-height: 46px;\s*padding-inline: 22px;/,
  );
  assert.match(
    tvFeed,
    /\.tv-global-account \{ width: 109px; min-width: 92px; min-height: 46px;[\s\S]*?padding: 0 22px;[\s\S]*?font-size: 12px;/,
  );
  assert.match(
    home,
    /\.customer-quick-btn \{\s*position: relative;\s*width: 42px;\s*min-width: 42px;\s*min-height: 42px;/,
  );
  assert.match(
    tvFeed,
    /\.tv-notification-button \{ width: 42px; min-width: 42px; min-height: 42px; \}/,
  );
  assert.match(
    home,
    /header \.dancr-home-logo\.logo-image-button,[\s\S]*?width: clamp\(150px, 48vw, 198px\) !important;/,
  );
  assert.match(
    tvFeed,
    /\.tv-global-logo \{ width: clamp\(150px, 48vw, 198px\); min-width: 0; \}/,
  );
  assert.match(
    tvFeed,
    /\.tv-global-account \{ width: 92px; min-width: 86px; max-width: 108px; min-height: 42px; padding: 0 11px; font-size: clamp\(12px, 3\.3vw, 14px\); \}/,
  );
  assert.match(
    tvFeed,
    /\.tv-notification-button \{ width: 34px; min-width: 34px; min-height: 34px; \}/,
  );
  assert.match(
    tvFeed,
    /@media \(max-width: 374px\) \{[\s\S]*?\.tv-global-logo \{ width: clamp\(136px, 44vw, 164px\); max-width: clamp\(136px, 44vw, 164px\); \}[\s\S]*?\.tv-global-account \{ width: 88px; min-width: 78px; max-width: 94px; padding-inline: 9px; \}/,
  );
});
