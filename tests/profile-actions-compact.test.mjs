import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const css = read("public/profile-actions-compact.css");
const live = read("outputs/index.html");
const actions = read("app/dancers/[slug]/DancerProfileActions.tsx");

test("selected actions stay neutral without changing their state or accessible labels", () => {
  assert.match(css, /\[aria-pressed="true"\] \{\s*--profile-action-border: #818181/);
  assert.match(css, /\[aria-pressed="true"\][^{}]+> svg \{\s*color: #FFFFFF !important/);
  assert.match(actions, /saved\.following \? "Following" : "Follow"/);
  assert.match(actions, /isGoing \? "Going" : "I’m Going"/);
  assert.match(actions, /<button aria-label="Share" className="profile-action-preview-share/);
  assert.match(read("app/dancers/[slug]/ProfileNavigationActions.tsx"), /aria-label=\{`Share \$\{stageName\} profile`\}/);
  assert.match(live, /aria-label="Share \$\{escapeHtml\(profile\.name\)\} profile"/);
});

test("profile actions use restrained charcoal materials without green, gradients, or glow", () => {
  assert.match(css, /--profile-action-border: #525252/);
  assert.match(css, /border-radius: 8px !important/);
  assert.match(css, /color: #FFFFFF !important/);
  assert.match(css, /--profile-action-background: #242424/);
  assert.match(css, /appearance: none !important/);
  assert.match(css, /outline: 2px solid #FFFFFF !important/);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|drop-shadow|#4dec9d|#22c55e/i);
});

test("compact action layout is shared by live, routed, and dashboard-preview profiles", () => {
  assert.match(live, /class="modal-actions profile-actions-compact /);
  assert.match(actions, /live-actions profile-actions-compact is-no-live-shift dancer-profile-preview-actions/);
  assert.match(actions, /live-actions profile-actions-compact\$\{hasLiveActions/);
  assert.match(read("app/layout.tsx"), /import "\.\.\/public\/profile-actions-compact\.css"/);
  assert.match(live, /<link href="\/profile-actions-compact\.css" rel="stylesheet">/);
  assert.match(read("src/lib/dancr/static-asset-paths.mjs"), /"\/profile-actions-compact\.css"/);
});

test("layout keeps inline icons, equal primary widths, and a same-height square share control", () => {
  assert.doesNotThrow(() => postcss.parse(css));
  assert.match(css, /--profile-action-height: 44px/);
  assert.match(css, /--profile-action-face-inset: 3px/);
  assert.match(css, /flex: 1 1 0 !important/);
  assert.match(css, /flex: 0 0 var\(--profile-action-height\) !important/);
  assert.match(css, /height: var\(--profile-action-height\) !important/);
  assert.match(css, /flex-direction: row !important/);
  assert.match(css, /gap: 6px !important/);
  assert.match(css, /clip-path: inset\(50%\) !important/);
  assert.doesNotMatch(css, /\.profile-tonight|\.club-deal|\.profile-metrics/);
});
