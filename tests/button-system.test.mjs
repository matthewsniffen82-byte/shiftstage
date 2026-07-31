import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [buttonCss, layoutSource, liveSource] = await Promise.all([
  readFile(new URL("../public/dancr-button-system.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
]);

test("the live shell and every Next page load one shared production button system", () => {
  assert.match(
    layoutSource,
    /import "\.\.\/public\/dancr-button-system\.v1\.css";/,
  );
  assert.match(layoutSource, /<body className="dancr-button-system">/);
  assert.match(
    liveSource,
    /<link href="\/dancr-button-system\.v1\.css" rel="stylesheet">/,
  );
  assert.match(liveSource, /<body class="dancr-button-system">/);
});

test("the shared system covers native buttons and link-based actions without changing handlers", () => {
  assert.match(
    buttonCss,
    /\.dancr-button-system :where\(\s*button,[\s\S]*?input\[type="submit"\],[\s\S]*?\[role="button"\],[\s\S]*?a\[class\*="button"\],[\s\S]*?\.nav-links a/,
  );
  assert.match(buttonCss, /touch-action: manipulation/);
  assert.match(buttonCss, /-webkit-tap-highlight-color: transparent/);
  assert.match(
    buttonCss,
    /button:not\(\[aria-label\]\):not\(\.tv-strip-card\)[\s\S]*?min-height: 44px/,
  );
  assert.doesNotMatch(buttonCss, /pointer-events:\s*none/);
});

test("primary, selected, destructive, utility, disabled, and keyboard states remain distinct", () => {
  assert.match(
    buttonCss,
    /button\[type="submit"\][\s\S]*?\.primary-action,[\s\S]*?\[class\*="approve-btn"\][\s\S]*?linear-gradient/,
  );
  assert.match(
    buttonCss,
    /:is\(\.active, \[aria-pressed="true"\], \[aria-selected="true"\]\)/,
  );
  assert.match(
    buttonCss,
    /\.danger-action,[\s\S]*?\.photo-delete-button,[\s\S]*?\.reject,[\s\S]*?--dancr-color-danger/,
  );
  assert.match(
    buttonCss,
    /button\[class\*="close"\][\s\S]*?button\[aria-label\*="password" i\][\s\S]*?min-height: 40px[\s\S]*?border-radius: 999px/,
  );
  assert.match(
    buttonCss,
    /:focus-visible[\s\S]*?outline: 2px solid var\(--dancr-color-brand-primary\)/,
  );
  assert.match(buttonCss, /:disabled,[\s\S]*?cursor: not-allowed/);
  assert.match(buttonCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test("venue-card QR revenue actions use the semantic emerald success treatment", () => {
  assert.match(
    liveSource,
    /venue\.activeDeal\?\.id[\s\S]*?if \(rail\) return "";[\s\S]*?"feed-card-action home-venue-discovery-deal-action"[\s\S]*?data-feed-venue-qr/,
  );
  assert.match(
    buttonCss,
    /\.home-venue-discovery-context-actions\s+\.home-venue-discovery-deal-action \{[\s\S]*?border-color: var\(--dancr-color-success-strong\) !important;[\s\S]*?var\(--dancr-color-success\)/,
  );
  assert.match(
    buttonCss,
    /\.home-venue-discovery-context-actions[\s\S]*?\.home-venue-discovery-deal-action:hover \{[\s\S]*?border-color: var\(--dancr-color-success\) !important/,
  );
  assert.match(
    buttonCss,
    /\.home-venue-discovery-context-actions[\s\S]*?\.home-venue-discovery-deal-action:active \{[\s\S]*?border-color: var\(--dancr-color-success-strong\) !important/,
  );
});

test("profile media thumbnails and play controls retain their gallery-specific shapes", () => {
  assert.match(
    buttonCss,
    /\.dancr-button-system \.public-media-thumbnail \{[\s\S]*?border-radius: 14px !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    buttonCss,
    /\.public-media-thumbnail\.is-selected \{[\s\S]*?border-color: var\(--dancr-color-brand-primary\) !important;[\s\S]*?0 0 0 5px var\(--dancr-color-brand-primary-strong\)/,
  );
  assert.match(
    buttonCss,
    /\.public-profile-play,[\s\S]*?\.modal-media-video-play \{[\s\S]*?border-radius: 50% !important;[\s\S]*?background: var\(--dancr-color-text-primary\) !important;/,
  );
});
