import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [aesthetic, tokens, liveShell, publicProfile, tvFeed] = await Promise.all([
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-brand-tokens.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
]);

test("every dancer avatar uses the shared electric-white ring", () => {
  const ringRules = aesthetic.match(
    /\/\* Every real dancer avatar uses one thin electric-white Dancr ring[\s\S]*?(?=body\.dancr-button-system \.home-tv-feed-dancer-photo:not)/,
  )?.[0] || "";

  assert.match(ringRules, /body\.dancr-button-system \[data-dancer-avatar\] \{/);
  assert.match(ringRules, /position: relative !important;/);
  assert.match(ringRules, /isolation: isolate !important;/);
  assert.match(ringRules, /border: 0 !important;/);
  assert.match(ringRules, /box-shadow: none !important;/);
  assert.match(ringRules, /\[data-dancer-avatar\]::after \{[\s\S]*?content: "" !important;/);
  assert.match(ringRules, /\.home-tv-feed-dancer-photo,[\s\S]*?\.tv-profile-photo \{[\s\S]*?padding: 2px !important;[\s\S]*?background: #ffffff !important;/);
  assert.match(ringRules, /\.home-tv-feed-dancer-photo > img,[\s\S]*?\.tv-profile-photo > \.tv-profile-photo-image \{[\s\S]*?inset: 2px !important;[\s\S]*?width: calc\(100% - 4px\) !important;[\s\S]*?height: calc\(100% - 4px\) !important;/);
  assert.match(ringRules, /inset 0 0 0 2px #ffffff,/);
  assert.match(ringRules, /inset 0 0 4px rgba\(255, 255, 255, 0\.96\) !important;/);
  assert.match(ringRules, /z-index: 3 !important;/);
  assert.match(ringRules, /pointer-events: none !important;/);
  assert.match(ringRules, /\[data-dancer-avatar\]::before \{[\s\S]*?content: none !important;/);
  assert.match(ringRules, /\.home-tv-feed-dancer-photo::after,[\s\S]*?\.tv-profile-photo::after \{[\s\S]*?content: none !important;/);
  assert.match(ringRules, /\.home-tv-feed-dancer-photo::before,[\s\S]*?\.tv-profile-photo::before \{[\s\S]*?content: none !important;/);
  assert.doesNotMatch(ringRules, /body\.dancr-button-system :is\(/);
  assert.match(ringRules, /body\.is-android\.dancr-button-system \[data-dancer-avatar\]/);
  assert.match(ringRules, /body\.android-rendering\.dancr-button-system \[data-dancer-avatar\]/);
  assert.match(ringRules, /body\.is-samsung-browser\.dancr-button-system \[data-dancer-avatar\]/);
  assert.match(ringRules, /body\.samsung-rendering\.dancr-button-system \[data-dancer-avatar\]/);
  assert.match(ringRules, /forced-color-adjust: none !important;/);
  assert.match(ringRules, /-webkit-print-color-adjust: exact !important;/);
  assert.match(ringRules, /mix-blend-mode: normal !important;/);
  assert.doesNotMatch(ringRules, /dotted|drop-shadow|radial-gradient|linear-gradient|color-mix/);
  assert.doesNotMatch(ringRules, /\b(?:display|animation):/);
  assert.doesNotMatch(ringRules, /var\(--dancr-color-avatar-ring-(?:magenta|violet|indigo)\)/);
  assert.doesNotMatch(ringRules, /mask-composite|conic-gradient/);
  assert.doesNotMatch(ringRules, /venue-logo|discoveryTabs|home-nav/);
});

test("every production dancer avatar render path carries the semantic ring marker", () => {
  assert.match(liveShell, /class="profile-modal-avatar" id="modalProfileAvatar" data-dancer-avatar/);
  assert.match(liveShell, /class="approved-avatar-preview\$\{avatarPreviewAttrs\.className\}"\$\{avatarPreviewAttrs\.style\} data-dancer-avatar/);
  assert.match(liveShell, /class="\$\{classPrefix\}-lineup-avatar\$\{attrs\.className\}"\$\{attrs\.style\} data-dancer-avatar/);
  assert.match(liveShell, /class="venue-shift-avatar [^\n]+data-dancer-avatar role="img"/);
  assert.match(liveShell, /dancerPhoto\.setAttribute\("data-dancer-avatar", ""\)/);
  assert.match(publicProfile, /className=\{`profile-titlebar-avatar[^\n]+[\s\S]*?data-dancer-avatar=""/);
  assert.match(tvFeed, /className=\{`tv-profile-photo[^\n]+[\s\S]*?data-dancer-avatar=""/);
});

test("the story ring colors come from the centralized Dancr brand palette", () => {
  assert.match(tokens, /--dancr-color-avatar-ring-magenta: #f02bdc;/);
  assert.match(tokens, /--dancr-color-avatar-ring-violet: #8b5cf6;/);
  assert.match(tokens, /--dancr-color-avatar-ring-indigo: #4f46e5;/);
  assert.match(tokens, /--dancr-color-avatar-ring-core: #ffffff;/);
});
