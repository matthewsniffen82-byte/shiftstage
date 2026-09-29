import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const shell = source("src/live-shell/shell.html");
const setup = source("src/live-shell/app/17-render-dancer-setup.js");
const builder = source("app/dashboard/DancerProfileEditor.tsx");
const panels = source("app/dashboard/DancerDashboardPanels.tsx");
const events = source("src/live-shell/app/25-events.js");
const editor = source("src/live-shell/app/10-submit-approved-profile-video.js");

test("both shared dancer onboarding and profile builders omit social controls", () => {
  assert.doesNotMatch(builder + panels, /SocialLinks|SocialLinkModal|socialContent|openSocialEditor|dancer-social-draft/);
  assert.doesNotMatch(shell + setup + editor, /<input[^>]+(?:data-setup-social|data-approved-social|id="(?:profile|approvedControl)(?:Instagram|Tiktok|Snapchat|Onlyfans|X))/);
  assert.doesNotMatch(editor, /data-approved-social-edit-toggle|data-approved-visual-social-save/);
  assert.match(setup, /data-setup-profile-save/);
  assert.match(panels, /<DancerOnboardingProfileMediaWorkspace/);
  for (const section of ["identity", "avatar", "photos", "videos"]) {
    assert.match(builder, new RegExp(`${section}:`));
  }
});

test("profile render paths omit social destinations even for existing profiles", () => {
  assert.doesNotMatch(source("app/dancers/[slug]/page.tsx"), /<SocialLinks|socialContent=/);
  assert.doesNotMatch(source("app/dancers/[slug]/DancerPhotoCarousel.tsx"), /socialContent|aria-label="External profiles"/);
  assert.doesNotMatch(source("src/live-shell/app/12-sync-profile-photo-viewer-window.js"), /socialLinksMarkup\(|previewSocialMarkup/);
  const modal = source("src/live-shell/app/13-open-profile-modal.js");
  assert.doesNotMatch(modal, /socialLinksMarkup\(/);
  assert.match(modal, /modalMediaSocials\.replaceChildren\(\);\s*modalMediaSocials\.hidden = true;/);
});

test("profile and setup saves omit social mutations and missing-field reads", () => {
  for (const text of [editor, events]) {
    assert.doesNotMatch(text, /socials: socialPayloadFromMap|submittedSocialPlatforms|normalizedSocials|setupInstagram/);
    assert.match(text, /patchAuthenticatedJson\("\/api\/dancer\/profile"/);
  }
  assert.doesNotMatch(editor, /profile\.socialLinks\s*=|profile\.deletedSocialPlatforms\s*=/);
});

test("native MyDancr profile sharing stays available", () => {
  assert.match(panels, /<DancerSharePanel profile=\{profile\}/);
  assert.match(shell, /data-dancer-control-action="share-profile"/);
  assert.match(editor, /data-profile-share-menu/);
  assert.match(source("app/dancers/[slug]/page.tsx"), /<ProfileShareButton/);
});
