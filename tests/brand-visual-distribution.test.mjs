import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [tokens, aesthetic] = await Promise.all([
  readFile(new URL("../public/dancr-brand-tokens.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("the hero beam is the single centralized brand reference with an 84/10/6 UI balance", () => {
  assert.match(tokens, /--dancr-visual-weight-neutral: 84;/);
  assert.match(tokens, /--dancr-visual-weight-brand: 10;/);
  assert.match(tokens, /--dancr-visual-weight-semantic: 6;/);
  assert.match(tokens, /--dancr-color-brand-core: #f5f3ff;/);
  assert.match(tokens, /--dancr-color-brand-primary: #7c3aed;/);
  assert.match(tokens, /--dancr-color-brand-glow: #312e81;/);
  assert.match(tokens, /--dancr-color-beam-core: var\(--dancr-color-brand-core\);/);
  assert.match(tokens, /--dancr-color-beam-glow: var\(--dancr-color-brand-glow\);/);
});

test("every named production surface consumes the shared neutral foundation", () => {
  assert.match(aesthetic, /\.account-shell/);
  assert.match(aesthetic, /\.dashboard-shell \.info-panel/);
  assert.match(aesthetic, /\.admin-shell \.admin-panel/);
  assert.match(
    aesthetic,
    /#customerDashboard,[\s\S]*?#dancerDashboard,[\s\S]*?#venueDashboard,[\s\S]*?#adminDashboard/,
  );
  assert.match(
    aesthetic,
    /body\.dancr-button-system \.page-panel \{[\s\S]*?--cyan: var\(--dancr-color-info\)[\s\S]*?--magenta: var\(--dancr-color-brand-primary\)[\s\S]*?--green: var\(--dancr-color-success\)[\s\S]*?border-color: var\(--dancr-color-border\)[\s\S]*?background-image: none[\s\S]*?var\(--dancr-shadow-surface\)/,
  );
  assert.match(
    aesthetic,
    /body\.dancr-button-system \.page-panel :is\([\s\S]*?button\[type="submit"\],[\s\S]*?\.admin-login,[\s\S]*?\.dancer-shift-primary[\s\S]*?var\(--dancr-color-brand-primary\),[\s\S]*?var\(--dancr-color-brand-primary-deep\)/,
  );
  assert.match(aesthetic, /\.tv-studio-page \.tv-video-manager/);
  assert.match(aesthetic, /:is\(\.public-profile-shell, \.tv-shell\)/);
  assert.match(aesthetic, /#results\.home-dancer-grid/);
  assert.match(aesthetic, /#results\.home-tv-feed/);
  assert.match(aesthetic, /#results\.home-venue-discovery-feed/);
  assert.match(aesthetic, /#profileBackdrop \.profile-modal/);
  assert.match(aesthetic, /#results\.venue-profile-overlay \.venue-detail/);
  assert.match(
    aesthetic,
    /Profile avatars use the same neutral framing[\s\S]*?border-color: var\(--dancr-color-border-strong\)[\s\S]*?var\(--dancr-color-border-subtle\)/,
  );
});

test("brand and semantic color stay assigned to interaction and real state", () => {
  assert.match(
    aesthetic,
    /Major content headings carry a two-pixel hero beam[\s\S]*?var\(--dancr-color-beam-glow\) 18%[\s\S]*?var\(--dancr-color-beam-core\) 50%/,
  );
  assert.match(
    aesthetic,
    /One true primary action per surface[\s\S]*?var\(--dancr-color-brand-primary\),[\s\S]*?var\(--dancr-color-brand-primary-deep\)[\s\S]*?var\(--dancr-color-brand-core-soft\)/,
  );
  assert.match(
    aesthetic,
    /\.customer-dashboard-tabs a:is\(:hover, :focus-visible\)[\s\S]*?var\(--dancr-color-brand-primary\) 14%/,
  );
  assert.match(aesthetic, /\.photo-review-card\.is-pending[\s\S]*?var\(--dancr-color-featured\)/);
  assert.match(aesthetic, /\.photo-review-card\.is-approved[\s\S]*?var\(--dancr-color-success\)/);
  assert.match(aesthetic, /\.submission-review-card\.is-rejected[\s\S]*?var\(--dancr-color-danger\)/);
  assert.match(aesthetic, /\.profile-verified[\s\S]*?var\(--dancr-color-info\) 24%/);
});

test("the production live-shell dashboards receive the palette without layout or navigation changes", () => {
  const livePanelSystem = aesthetic.match(
    /\/\* The production homepage owns[\s\S]*?(?=\r?\n:is\(\r?\n  \.account-shell)/,
  )?.[0] ?? "";

  assert.match(livePanelSystem, /body\.dancr-button-system \.page-panel/);
  assert.match(livePanelSystem, /\.customer-summary/);
  assert.match(livePanelSystem, /\.approval-command/);
  assert.match(livePanelSystem, /\.admin-login-form/);
  assert.match(livePanelSystem, /\.dancer-shift-primary/);
  assert.match(livePanelSystem, /var\(--dancr-color-featured\)/);
  assert.match(livePanelSystem, /var\(--dancr-color-success\)/);
  assert.match(livePanelSystem, /var\(--dancr-color-danger\)/);
  assert.doesNotMatch(
    livePanelSystem,
    /(?:^|\s)(?:padding|margin|gap|border-radius|font-size|line-height|position|display|animation|transform)\s*:/m,
  );
  assert.doesNotMatch(livePanelSystem, /home-bottom|home-nav|global-mobile-bottom-nav/);
});
