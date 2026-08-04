import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [aesthetic, tokens] = await Promise.all([
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-brand-tokens.v1.css", import.meta.url), "utf8"),
]);

test("every real circular dancer avatar uses the shared Dancr story ring", () => {
  const ringRules = aesthetic.match(
    /\/\* Every real circular dancer avatar uses one solid electric-white Dancr story[\s\S]*?(?=body\.dancr-button-system \.home-tv-feed-dancer-photo:not)/,
  )?.[0] || "";

  for (const selector of [
    ".approved-avatar-preview",
    ".venue-card-lineup-avatar",
    ".home-venue-discovery-lineup-avatar",
    ".profile-modal-avatar",
    ".home-tv-feed-dancer-photo",
    ".profile-titlebar-avatar",
    ".tv-profile-photo",
  ]) {
    assert.match(ringRules, new RegExp(selector.replaceAll(".", "\\.")));
  }

  assert.match(ringRules, /border: 5px solid #ffffff !important;/);
  assert.match(ringRules, /0 0 4px rgba\(255, 255, 255, 0\.95\),/);
  assert.match(ringRules, /0 0 10px rgba\(255, 255, 255, 0\.72\) !important;/);
  assert.match(ringRules, /\)::after \{[\s\S]*?content: none !important;[\s\S]*?display: none !important;/);
  assert.match(ringRules, /white dotted stroke is pulled outward onto the five-pixel border band/);
  assert.match(ringRules, /\)::before \{[\s\S]*?inset: -5px;[\s\S]*?border: 3px dotted #ffffff;/);
  assert.match(ringRules, /background: none !important;/);
  assert.match(ringRules, /drop-shadow\(0 0 2px rgba\(255, 255, 255, 0\.95\)\)/);
  assert.match(ringRules, /drop-shadow\(0 0 4px rgba\(255, 255, 255, 0\.7\)\)/);
  assert.match(ringRules, /animation: none;/);
  assert.doesNotMatch(ringRules, /radial-gradient|linear-gradient|color-mix/);
  assert.doesNotMatch(ringRules, /var\(--dancr-color-avatar-ring-(?:magenta|violet|indigo)\)/);
  assert.doesNotMatch(ringRules, /mask-composite|conic-gradient/);
  assert.doesNotMatch(ringRules, /venue-shift-avatar|venue-logo|discoveryTabs|home-nav/);
});

test("the story ring colors come from the centralized Dancr brand palette", () => {
  assert.match(tokens, /--dancr-color-avatar-ring-magenta: #f02bdc;/);
  assert.match(tokens, /--dancr-color-avatar-ring-violet: #8b5cf6;/);
  assert.match(tokens, /--dancr-color-avatar-ring-indigo: #4f46e5;/);
  assert.match(tokens, /--dancr-color-avatar-ring-core: #ffffff;/);
});
