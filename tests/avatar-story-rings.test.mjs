import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [aesthetic, tokens] = await Promise.all([
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-brand-tokens.v1.css", import.meta.url), "utf8"),
]);

test("every real circular dancer avatar uses the shared Dancr story ring", () => {
  const ringRules = aesthetic.match(
    /\/\* Every real circular dancer avatar uses one Dancr story ring\.[\s\S]*?(?=body\.dancr-button-system \.home-tv-feed-dancer-photo:not)/,
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

  assert.match(ringRules, /border: 3px solid var\(--dancr-color-avatar-ring-core\);/);
  assert.match(ringRules, /border-top-color: var\(--dancr-color-avatar-ring-core\);/);
  assert.match(ringRules, /border-right-color: color-mix\(/);
  assert.match(ringRules, /border-bottom-color: color-mix\(/);
  assert.match(ringRules, /border-left-color: color-mix\(/);
  assert.match(ringRules, /drop-shadow\(0 0 2px color-mix\(/);
  assert.match(ringRules, /Four tiny static facet flashes suggest cut crystal/);
  assert.match(ringRules, /\)::before \{[\s\S]*?radial-gradient\(ellipse 1px 4px at 18% 16%/);
  assert.match(ringRules, /radial-gradient\(ellipse 4px 1px at 8% 63%/);
  assert.match(ringRules, /animation: none;/);
  assert.doesNotMatch(ringRules, /mask-composite|conic-gradient/);
  assert.doesNotMatch(ringRules, /venue-shift-avatar|venue-logo|discoveryTabs|home-nav/);
});

test("the story ring colors come from the centralized Dancr brand palette", () => {
  assert.match(tokens, /--dancr-color-avatar-ring-magenta: #f02bdc;/);
  assert.match(tokens, /--dancr-color-avatar-ring-violet: #8b5cf6;/);
  assert.match(tokens, /--dancr-color-avatar-ring-indigo: #4f46e5;/);
  assert.match(tokens, /--dancr-color-avatar-ring-core: var\(--dancr-color-beam-core\);/);
});
