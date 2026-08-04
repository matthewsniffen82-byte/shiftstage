import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [aesthetic, tokens] = await Promise.all([
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-brand-tokens.v1.css", import.meta.url), "utf8"),
]);

test("every real circular dancer avatar uses the shared Dancr story ring", () => {
  const ringRules = aesthetic.match(
    /\/\* Every real circular dancer avatar uses one thin electric-white Dancr ring[\s\S]*?(?=body\.dancr-button-system \.home-tv-feed-dancer-photo:not)/,
  )?.[0] || "";

  for (const selector of [
    "#profileBackdrop .profile-modal-avatar",
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

  assert.match(ringRules, /border: 2px solid #ffffff !important;/);
  assert.match(ringRules, /box-shadow: 0 0 4px rgba\(255, 255, 255, 0\.82\) !important;/);
  assert.match(ringRules, /\.home-tv-feed-dancer-photo::after,[\s\S]*?content: none !important;/);
  assert.match(ringRules, /\.home-tv-feed-dancer-photo::before,[\s\S]*?content: none !important;/);
  assert.doesNotMatch(ringRules, /body\.dancr-button-system :is\(/);
  assert.match(ringRules, /body\.is-android\.dancr-button-system \.home-tv-feed-dancer-photo/);
  assert.match(ringRules, /body\.android-rendering\.dancr-button-system \.home-tv-feed-dancer-photo/);
  assert.match(ringRules, /body\.is-samsung-browser\.dancr-button-system \.home-tv-feed-dancer-photo/);
  assert.match(ringRules, /body\.samsung-rendering\.dancr-button-system \.home-tv-feed-dancer-photo/);
  assert.match(ringRules, /forced-color-adjust: none !important;/);
  assert.match(ringRules, /-webkit-print-color-adjust: exact !important;/);
  assert.match(ringRules, /mix-blend-mode: normal !important;/);
  assert.doesNotMatch(ringRules, /dotted|drop-shadow|radial-gradient|linear-gradient|color-mix/);
  assert.doesNotMatch(ringRules, /\b(?:position|display|inset|animation):/);
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
