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
    /\.danger-action,[\s\S]*?\.photo-delete-button,[\s\S]*?\.reject,[\s\S]*?--dancr-action-danger/,
  );
  assert.match(
    buttonCss,
    /button\[class\*="close"\][\s\S]*?button\[aria-label\*="password" i\][\s\S]*?min-height: 40px[\s\S]*?border-radius: 999px/,
  );
  assert.match(buttonCss, /:focus-visible[\s\S]*?outline: 2px solid var\(--dancr-action-cyan\)/);
  assert.match(buttonCss, /:disabled,[\s\S]*?cursor: not-allowed/);
  assert.match(buttonCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test("venue-card QR revenue actions retain their green glow over the shared button defaults", () => {
  assert.match(
    liveSource,
    /class="feed-card-action home-venue-discovery-deal-action"[\s\S]*?data-feed-venue-qr/,
  );
  assert.match(
    buttonCss,
    /\.home-discovery-feed-actions\s+\.home-venue-discovery-deal-action \{[\s\S]*?border-color: rgba\(77, 255, 157, 0\.92\) !important;[\s\S]*?0 0 18px rgba\(49, 255, 143, 0\.7\)[\s\S]*?0 0 38px rgba\(25, 221, 113, 0\.42\)/,
  );
  assert.match(
    buttonCss,
    /\.home-venue-discovery-deal-action:hover \{[\s\S]*?0 0 22px rgba\(55, 255, 147, 0\.82\)/,
  );
  assert.match(
    buttonCss,
    /\.home-venue-discovery-deal-action:active \{[\s\S]*?0 0 14px rgba\(49, 255, 143, 0\.58\)/,
  );
});
