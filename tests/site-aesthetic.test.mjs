import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [aesthetic, layout, liveApp, mobileNavigation] = await Promise.all([
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
]);

test("the shared aesthetic is loaded by both Next pages and the live homepage", () => {
  assert.match(layout, /import "\.\.\/public\/dancr-aesthetic\.v1\.css";/);
  assert.match(
    liveApp,
    /<link href="\/dancr-aesthetic\.v1\.css\?v=2" rel="stylesheet">/,
  );
});

test("the shared aesthetic covers public content, accounts, and operations surfaces", () => {
  assert.match(aesthetic, /\.account-shell/);
  assert.match(aesthetic, /\.dashboard-shell/);
  assert.match(aesthetic, /\.admin-shell/);
  assert.match(aesthetic, /\.dmca-shell/);
  assert.match(aesthetic, /\.tv-studio-page/);
  assert.match(aesthetic, /body > \.app main\.stack > \.hero\.reference-hero/);
  assert.match(aesthetic, /body > \.app main\.stack > #results/);
  assert.match(aesthetic, /#profileBackdrop \.profile-modal/);
  assert.match(aesthetic, /\.venue-detail/);
});

test("verified check marks use the hero electric-blue and violet trust glow", () => {
  assert.match(
    aesthetic,
    /:root :is\(\s*\.verified-mark\.verified-mark\.verified-mark,\s*\.verified-check\.verified-check\.verified-check,\s*\.home-tv-feed-verified\.home-tv-feed-verified\.home-tv-feed-verified,\s*\.profile-modal-verified\.profile-modal-verified\.profile-modal-verified,\s*\.profile-verified\.profile-verified\.profile-verified,\s*\.tv-verified-mark\.tv-verified-mark\.tv-verified-mark\s*\)/,
  );
  assert.match(aesthetic, /--mydancr-verified-cyan: #35d8ff/);
  assert.match(aesthetic, /--mydancr-verified-blue: #176bff/);
  assert.match(aesthetic, /--mydancr-verified-violet: #7c3aed/);
  assert.match(aesthetic, /color: #fff !important/);
  assert.match(
    aesthetic,
    /0 0 10px rgba\(53, 216, 255, 0\.48\),\s*0 0 18px rgba\(124, 58, 237, 0\.3\)/,
  );
});

test("the homepage hero uses one crisp purple-to-electric-blue edge", () => {
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::before/,
  );
  assert.match(
    aesthetic,
    /rgba\(124, 58, 237, 0\.94\)[\s\S]*?rgba\(53, 216, 255, 0\.92\)/,
  );
  assert.match(aesthetic, /-webkit-mask-composite: xor/);
  assert.match(aesthetic, /mask-composite: exclude/);
  assert.match(
    aesthetic,
    /10px 0 34px rgba\(53, 216, 255, 0\.12\)/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero::after[\s\S]*?box-shadow: inset 0 1px 0 rgba\(255, 255, 255, 0\.1\)/,
  );
  assert.match(
    aesthetic,
    /body > \.app main\.stack > \.hero\.reference-hero > \.hero-art[\s\S]*?transform: scale\(1\.026\) !important/,
  );
});

test("the frozen bottom navigation is outside the shared aesthetic contract", () => {
  assert.doesNotMatch(
    aesthetic,
    /global-mobile-bottom-nav|#discoveryTabs|home-bottom-tv|home-nav-/,
  );
  assert.match(mobileNavigation, /className="global-mobile-bottom-nav"/);
  assert.match(liveApp, /<nav class="tabs" id="discoveryTabs"/);
});
