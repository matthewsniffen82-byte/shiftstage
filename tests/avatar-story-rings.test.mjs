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

  assert.match(ringRules, /background: conic-gradient\(/);
  assert.match(ringRules, /var\(--dancr-color-avatar-ring-magenta\) 0deg/);
  assert.match(ringRules, /var\(--dancr-color-avatar-ring-violet\) 96deg/);
  assert.match(ringRules, /var\(--dancr-color-avatar-ring-blue\) 196deg/);
  assert.match(ringRules, /var\(--dancr-color-avatar-ring-cyan\) 286deg/);
  assert.match(ringRules, /padding: 1\.5px;/);
  assert.match(ringRules, /mask-composite: exclude;/);
  assert.doesNotMatch(ringRules, /venue-shift-avatar|venue-logo|discoveryTabs|home-nav/);
});

test("the story ring colors come from the centralized Dancr brand palette", () => {
  assert.match(tokens, /--dancr-color-avatar-ring-magenta: #c026d3;/);
  assert.match(tokens, /--dancr-color-avatar-ring-violet: var\(--dancr-color-brand-primary\);/);
  assert.match(tokens, /--dancr-color-avatar-ring-blue: #2563eb;/);
  assert.match(tokens, /--dancr-color-avatar-ring-cyan: var\(--dancr-color-info\);/);
});
