import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  tokens,
  aesthetic,
  buttons,
  layout,
  liveShell,
  manifest,
  appIcon,
  dancerShiftManager,
] =
  await Promise.all([
    readFile(
      new URL("../public/dancr-brand-tokens.v1.css", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
    readFile(
      new URL("../public/dancr-button-system.v1.css", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/mydancr-icon.svg", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/DancerShiftManager.tsx", import.meta.url), "utf8"),
  ]);

const requiredTokens = new Map([
  ["--dancr-color-brand-primary", "#7c3aed"],
  ["--dancr-color-text-primary", "#f8fafc"],
  ["--dancr-color-background", "#050507"],
  ["--dancr-color-surface", "#111118"],
  ["--dancr-color-text-secondary", "#cbd5e1"],
  ["--dancr-color-text-muted", "#94a3b8"],
  ["--dancr-color-border", "#334155"],
  ["--dancr-color-info", "#22d3ee"],
  ["--dancr-color-verification", "#2563eb"],
  ["--dancr-color-verification-foreground", "#ffffff"],
  ["--dancr-color-verification-outline", "#1d4ed8"],
  ["--dancr-color-success", "#10b981"],
  ["--dancr-color-live", "#4dec9d"],
  ["--dancr-color-live-surface-emphasis", "#28744f"],
  ["--dancr-color-featured", "#fbbf24"],
  ["--dancr-color-danger", "#ef4444"],
]);

const frozenNavigation = await readFile(
  new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
  "utf8",
);

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test("the exact production palette is centralized in one shared token file", () => {
  for (const [name, value] of requiredTokens) {
    assert.match(tokens, new RegExp(`${name}: ${value};`));
  }
});

test("legacy beam aliases resolve to the Electric Violet beam and its deep-indigo glow", () => {
  assert.match(
    tokens,
    /--dancr-color-beam-violet: var\(--dancr-color-brand-primary\);/,
  );
  assert.match(
    tokens,
    /--dancr-color-beam-blue: var\(--dancr-color-beam-glow\);/,
  );
  assert.doesNotMatch(tokens, /#985fff|#346eff/);
});

test("brand text and status combinations meet normal-text contrast", () => {
  const combinations = [
    ["#f8fafc", "#7c3aed"],
    ["#f8fafc", "#050507"],
    ["#cbd5e1", "#111118"],
    ["#94a3b8", "#050507"],
    ["#22d3ee", "#111118"],
    ["#ffffff", "#2563eb"],
    ["#10b981", "#111118"],
    ["#fbbf24", "#111118"],
    ["#ef4444", "#111118"],
  ];

  for (const [foreground, background] of combinations) {
    assert.ok(
      contrastRatio(foreground, background) >= 4.5,
      `${foreground} on ${background} must meet WCAG AA contrast`,
    );
  }
});

test("browser chrome and install assets use the production background and logo colors", () => {
  assert.match(layout, /themeColor: "#050507"/);
  assert.match(liveShell, /<meta name="theme-color" content="#050507">/);
  assert.match(manifest, /"background_color": "#050507"/);
  assert.match(manifest, /"theme_color": "#050507"/);
  assert.match(appIcon, /fill="#050507"/);
  assert.match(appIcon, /stroke="#7C3AED"/);
  assert.match(appIcon, /fill="#F8FAFC"/);
});

test("Next pages and the live shell load tokens before shared component styling", () => {
  const tokenImport = layout.indexOf('import "../public/dancr-brand-tokens.v1.css";');
  const buttonImport = layout.indexOf('import "../public/dancr-button-system.v1.css";');
  const aestheticImport = layout.indexOf('import "../public/dancr-aesthetic.v1.css";');

  assert.ok(tokenImport >= 0);
  assert.ok(tokenImport < buttonImport);
  assert.ok(buttonImport < aestheticImport);

  const tokenLink = liveShell.indexOf(
    '<link href="/dancr-brand-tokens.v1.css?v=13" rel="stylesheet">',
  );
  const buttonLink = liveShell.indexOf(
    '<link href="/dancr-button-system.v1.css" rel="stylesheet">',
  );
  const aestheticLink = liveShell.search(
    /<link href="\/dancr-aesthetic\.v1\.css\?v=\d+" rel="stylesheet">/,
  );

  assert.ok(tokenLink >= 0);
  assert.ok(tokenLink < buttonLink);
  assert.ok(buttonLink < aestheticLink);
});

test("interactive, informational, live, success, featured, and danger states consume semantic tokens", () => {
  assert.match(buttons, /var\(--dancr-color-brand-primary\)/);
  assert.match(buttons, /var\(--dancr-color-success\)/);
  assert.match(buttons, /var\(--dancr-color-featured\)/);
  assert.match(buttons, /var\(--dancr-color-danger\)/);
  assert.match(aesthetic, /var\(--dancr-color-info\)/);
  assert.match(aesthetic, /var\(--dancr-color-success\)/);
  assert.match(aesthetic, /var\(--dancr-color-live\)/);
  assert.match(aesthetic, /var\(--dancr-color-featured\)/);
  assert.match(aesthetic, /var\(--dancr-color-danger\)/);
});

test("the shared palette does not target the frozen navigation systems", () => {
  for (const source of [tokens, aesthetic]) {
    assert.doesNotMatch(
      source,
      /global-mobile-bottom-nav|#discoveryTabs|home-bottom-tv|home-nav-/,
    );
  }
  assert.doesNotMatch(
    frozenNavigation,
    /--dancr-color-|var\(--dancr-color-/,
  );
});

test("form fields use neutral borders and a crisp tokenized focus ring", () => {
  assert.match(
    aesthetic,
    /border-color: var\(--dancr-color-border\) !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /\):focus,[\s\S]*?border-color: var\(--dancr-color-brand-primary\) !important;[\s\S]*?outline: 2px solid var\(--dancr-color-brand-primary\) !important;[\s\S]*?outline-offset: -2px !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(
    aesthetic,
    /\[aria-invalid="true"\][\s\S]*?var\(--dancr-color-danger\)/,
  );
  assert.match(
    liveShell,
    /<link href="\/dancr-aesthetic\.v1\.css\?v=219" rel="stylesheet">/,
  );
});

test("dancer schedule venue and date controls share one compact field height", () => {
  assert.match(
    aesthetic,
    /\.dancer-schedule-control \{[\s\S]*?height: 44px !important;[\s\S]*?min-height: 44px !important;[\s\S]*?max-height: 44px !important;/,
  );
  assert.match(liveShell, /class="dancer-schedule-control" id="shiftClub"/);
  assert.match(liveShell, /class="dancer-schedule-control" id="shiftDate" type="date"/);
  assert.equal(
    dancerShiftManager.match(/className="dancer-schedule-control"/g)?.length,
    4,
  );
});

test("brand emphasis is crisp on stateful and keyboard-focused UI", () => {
  assert.match(
    buttons,
    /button\[type="submit"\][\s\S]*?var\(--dancr-shadow-brand-control\)/,
  );
  assert.match(tokens, /--dancr-shadow-beam-active:[\s\S]*?--dancr-shadow-beam-card:/);
  assert.match(
    aesthetic,
    /#profileBackdrop \.gallery \.thumb\.active \{[\s\S]*?border-color: var\(--dancr-color-text-secondary\) !important;[\s\S]*?0 0 0 1px var\(--dancr-color-white-medium\) !important;/,
  );
  assert.match(aesthetic, /\.public-profile-shell \.profile-media-grid-item[\s\S]*?:focus-visible \{[\s\S]*?var\(--dancr-color-beam-violet\)/);
  assert.doesNotMatch(
    aesthetic,
    /\.home-filter-toggle\[aria-expanded="true"\][\s\S]{0,500}var\(--dancr-shadow-beam-active\)/,
  );
  assert.match(
    aesthetic,
    /@supports selector\(:has\(\*\)\)[\s\S]*?\.home-dancer-grid-card:has\(:focus-visible\)[\s\S]*?\.home-venue-discovery-slide:has\(:focus-visible\)[\s\S]*?var\(--dancr-shadow-beam-card\)/,
  );
  assert.doesNotMatch(
    aesthetic,
    /\.tv-verified-mark[\s\S]{0,500}var\(--dancr-shadow-beam-active\)/,
  );
});
