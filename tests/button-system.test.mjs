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
  assert.match(
    layoutSource,
    /<body className="dancr-button-system"(?: suppressHydrationWarning)?>/,
  );
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
    /:focus-visible[\s\S]*?outline: 2px solid var\(--dancr-color-beam-violet\)/,
  );
  assert.match(buttonCss, /:disabled,[\s\S]*?cursor: not-allowed/);
  assert.match(buttonCss, /@media \(prefers-reduced-motion: reduce\)/);
});

test("venue-card QR revenue actions use the semantic emerald success treatment", () => {
  assert.match(
    liveSource,
    /venue\?\.id && venue\.activeDeal\?\.id[\s\S]*?home-card-qr-rail-action home-venue-discovery-rail-qr is-available[\s\S]*?data-club-deal-cta[\s\S]*?data-feed-venue-qr[\s\S]*?actionButtonLabel\("qr", offerCount > 1 \? `\$\{offerCount\} Deals` : "Get Deal"\)/,
  );
  assert.match(
    buttonCss,
    /\.home-venue-discovery-action-rail\s+\.home-venue-discovery-rail-qr\.is-available \{[\s\S]*?border-color: var\(--dancr-color-success-strong\) !important;[\s\S]*?var\(--dancr-color-success\)[\s\S]*?0 8px 18px var\(--dancr-color-black-soft\)/,
  );
  assert.match(
    buttonCss,
    /\.home-venue-discovery-action-rail[\s\S]*?\.home-venue-discovery-rail-qr\.is-available:hover \{[\s\S]*?border-color: var\(--dancr-color-success\) !important/,
  );
  assert.match(
    buttonCss,
    /\.home-venue-discovery-action-rail[\s\S]*?\.home-venue-discovery-rail-qr\.is-available:active \{[\s\S]*?border-color: var\(--dancr-color-success-strong\) !important/,
  );
  assert.match(
    buttonCss,
    /\[data-feed-venue-qr\],[\s\S]*?:focus-visible \{[\s\S]*?outline-color: var\(--dancr-color-success\)[\s\S]*?0 0 0 4px var\(--dancr-color-success-medium\)/,
  );
});

test("profile media thumbnails and play controls retain their gallery-specific shapes", () => {
  assert.match(
    buttonCss,
    /\.dancr-button-system \.public-media-thumbnail \{[\s\S]*?border-radius: 14px !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    buttonCss,
    /\.public-media-thumbnail\.is-selected \{[\s\S]*?border-color: var\(--dancr-color-text-secondary\) !important;[\s\S]*?box-shadow: 0 0 0 1px var\(--dancr-color-white-medium\) !important;/,
  );
  assert.match(
    buttonCss,
    /\.dancr-button-system \.public-profile-play \{[\s\S]*?border-radius: 50% !important;[\s\S]*?background: var\(--dancr-color-text-primary\) !important;/,
  );
  assert.match(buttonCss, /Media paging stays visually quiet while preserving a full mobile tap target/);
  assert.match(
    buttonCss,
    /\.profile-modal-media-previous,[\s\S]*?\.profile-tv-viewer-next[\s\S]*?border: 0 !important;[\s\S]*?border-radius: 12px !important;[\s\S]*?background: rgba\(0, 0, 0, 0\.06\) !important;[\s\S]*?box-shadow: none !important;[\s\S]*?backdrop-filter: none !important;/,
  );
  assert.match(
    buttonCss,
    /\.profile-modal-media-previous,[\s\S]*?\.profile-modal-media-next[\s\S]*?:disabled \{[\s\S]*?opacity: 0 !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.doesNotMatch(buttonCss, /modal-media-video-play/);
});

test("iPhone and Android touch controls share one lightweight compositor treatment", () => {
  const mobileTouchParity = buttonCss.match(
    /\/\* Mobile touch controls use one explicit compositor path\.[\s\S]*?(?=@media \(prefers-reduced-motion: reduce\))/,
  )?.[0] || "";

  assert.ok(mobileTouchParity, "shared mobile touch-control normalization must exist");
  assert.match(
    mobileTouchParity,
    /@media \(max-width: 899px\) and \(hover: none\) and \(pointer: coarse\)/,
  );
  assert.match(
    mobileTouchParity,
    /button:not\(\.tab\):not\(\.home-bottom-tv\)[\s\S]*?\[role="button"\]:not\(\.tab\):not\(\.home-bottom-tv\)/,
  );
  assert.match(mobileTouchParity, /-webkit-appearance: none !important;/);
  assert.match(mobileTouchParity, /appearance: none !important;/);
  assert.match(mobileTouchParity, /-webkit-backdrop-filter: none !important;/);
  assert.match(mobileTouchParity, /backdrop-filter: none !important;/);
  assert.match(mobileTouchParity, /-webkit-font-smoothing: antialiased;/);
  assert.match(mobileTouchParity, /text-shadow: none !important;/);
  assert.doesNotMatch(mobileTouchParity, /@supports \(-webkit-touch-callout/);
  const mobileDeclarations = mobileTouchParity.match(
    /\r?\n  \) \{\r?\n([\s\S]*?)\r?\n  \}\r?\n\}/,
  )?.[1] || "";
  assert.ok(mobileDeclarations, "mobile parity declarations must be isolated");
  assert.doesNotMatch(
    mobileDeclarations,
    /\b(?:width|height|padding|margin|position|transform|font-size|font-weight|box-shadow|background)\s*:/,
  );
});
