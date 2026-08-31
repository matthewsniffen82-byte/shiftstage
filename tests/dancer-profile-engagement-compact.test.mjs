import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveApp, aesthetic, profilePage, profileActions, socialLinks, profileMedia] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerProfileActions.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/SocialLinks.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/DancerPhotoCarousel.tsx", import.meta.url), "utf8"),
]);

const compactLayout = aesthetic.match(
  /\/\* Full-profile engagement uses one unboxed four-column action row\.[\s\S]*?(?=\/\* Production TV-card branding)/,
)?.[0] || "";

const socialFunctionSource = liveApp.match(
  /function socialLinksMarkup\(profile, options = \{\}\) \{[\s\S]*?(?=\n    function approvedDancerShiftVenues)/,
)?.[0] || "";

const platforms = ["instagram", "tiktok", "snapchat", "onlyfans", "x"].map((key) => ({
  key,
  label: key === "x" ? "X" : key[0].toUpperCase() + key.slice(1),
}));

const renderSocialLinks = new Function(
  "socialPlatforms",
  "normalizeSubmittedSocials",
  "normalizedReviewStatus",
  "socialIconMarkup",
  `${socialFunctionSource}; return socialLinksMarkup;`,
)(
  platforms,
  () => [],
  (status) => status,
  (platform) => `<svg data-platform="${platform}"></svg>`,
);

test("zero-social profiles reserve no social DOM or layout space", () => {
  assert.match(socialLinks, /if \(!links\.length\) return null;/);
  assert.match(
    profilePage,
    /socialContent=\{profile\.socialLinks\.length \? \([\s\S]*?<SocialLinks dancerId=\{profile\.id\} links=\{profile\.socialLinks\} showHeading=\{false\} \/>[\s\S]*?: null\}/,
  );
  assert.match(profileMedia, /\{socialContent \? \([\s\S]*?className="profile-media-socials"[\s\S]*?: null\}/);
  assert.equal(renderSocialLinks({ socials: {} }), "");
  assert.equal(renderSocialLinks({ socials: {} }, { preview: true }), "");
  assert.doesNotMatch(socialFunctionSource, /No profiles posted|social placeholder|empty social/i);
  assert.match(
    compactLayout,
    /\.profile-media-socials \{[\s\S]*?min-height: 0 !important;[\s\S]*?margin: 0 !important;[\s\S]*?padding: 10px 0 0 !important;/,
  );
});

test("one through the maximum supported social count renders only real links in one compact row", () => {
  for (let count = 1; count <= platforms.length; count += 1) {
    const socials = Object.fromEntries(
      platforms.slice(0, count).map(({ key }) => [key, `https://example.com/${key}`]),
    );
    const markup = renderSocialLinks({ name: "Dynamic Dancer", socials });
    assert.equal((markup.match(/class="social-link /g) || []).length, count);
    for (const { key } of platforms.slice(0, count)) {
      assert.match(markup, new RegExp(`social-${key}`));
    }
    for (const { key } of platforms.slice(count)) {
      assert.doesNotMatch(markup, new RegExp(`social-${key}`));
    }
  }

  assert.match(socialLinks, /\{links\.map\(\(link\) =>/);
  assert.match(compactLayout, /\.profile-media-socials \.social-list \{[\s\S]*?width: fit-content !important;[\s\S]*?flex-wrap: nowrap !important;[\s\S]*?justify-content: center !important;[\s\S]*?gap: clamp\(4px, 1\.8vw, 8px\) !important;/);
  assert.match(compactLayout, /\.profile-media-socials \.social-list a \{[\s\S]*?width: 44px !important;[\s\S]*?height: 44px !important;/);
  assert.match(compactLayout, /\.profile-media-socials \.social-list a::before \{[\s\S]*?inset: 3px !important;[\s\S]*?border: 1px solid rgba\(226, 232, 240, \.11\) !important;/);
  assert.match(compactLayout, /\.profile-media-socials \.social-list a svg \{[\s\S]*?width: 19px !important;[\s\S]*?height: 19px !important;/);
});

test("all schedule states share the same compact header, four actions, status, and unified media order", () => {
  const liveGrid = liveApp.match(
    /function profileModalGridMarkup\(profile, options = \{\}\) \{[\s\S]*?(?=\n    function profileActionButtonMarkup)/,
  )?.[0] || "";
  const liveActions = liveApp.match(
    /function liveProfileModalActionsMarkup\(profile, status\) \{[\s\S]*?(?=\n    async function refreshProfileGoingState)/,
  )?.[0] || "";
  const actionsIndex = liveGrid.indexOf("liveProfileModalActionsMarkup");
  const statusIndex = liveGrid.indexOf('class="${tonightClasses}"');
  const mediaSocialIndex = liveApp.indexOf('class="profile-media-socials" id="modalMediaSocials"');
  const mediaTabsIndex = liveApp.indexOf('class="profile-modal-media-tabs"');

  assert.ok(actionsIndex > -1 && statusIndex > actionsIndex);
  assert.ok(mediaSocialIndex > -1 && mediaTabsIndex > mediaSocialIndex);
  assert.doesNotMatch(liveGrid, /\$\{socialMarkup\}/);
  assert.match(liveApp, /modalMediaSocials\.innerHTML = liveSocialMarkup;[\s\S]*?modalMediaSocials\.hidden = !liveSocialMarkup;/);
  assert.doesNotMatch(liveGrid, /profileActivityMetricsMarkup/);
  assert.match(liveApp, /modalProfileMetrics\.innerHTML = profileActivityMetricsMarkup\(profile, city\)/);
  assert.match(liveActions, /Follow[\s\S]*?Notify[\s\S]*?\$\{goingButton\}[\s\S]*?Share/);
  assert.doesNotMatch(liveActions, /Report profile|profile-report-action/);
  assert.match(liveApp, /class="profile-header-report-toggle" id="reportBtn"[^>]*>Report profile<\/button>/);
  assert.doesNotMatch(liveApp, /class="profile-modal-report-link"/);
  assert.doesNotMatch(liveApp, /id="profileActionOverflowToggle"|id="profileActionOverflowMenu"/);
  assert.match(liveActions, /isWorkingNow \? "is-working-now" : profile\?\.scheduled \? "is-upcoming-shift" : "is-no-live-shift"/);
  assert.match(profileActions, /hasLiveActions \? " has-live-shift" : hasScheduledActions \? " has-upcoming-shift" : " is-no-live-shift"/);
  assert.match(
    compactLayout,
    /\.modal-actions,[\s\S]*?\.live-actions \{[\s\S]*?width: min\(100%, 760px\) !important;[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;[\s\S]*?justify-content: stretch !important;[\s\S]*?column-gap: 0 !important;[\s\S]*?margin: 0 auto 12px !important;/,
  );
});

test("selected actions, dynamic stats, and all existing action handlers remain intact", () => {
  assert.match(profileActions, /aria-pressed=\{saved\.following\}/);
  assert.match(profileActions, /aria-pressed=\{saved\.notificationsEnabled\}/);
  assert.match(profileActions, /aria-pressed=\{actionShift \? isGoing : undefined\}/);
  assert.match(profileActions, /export function DancerReportControl/);
  assert.match(profileActions, /onClick=\{openReport\}/);
  assert.match(profileActions, /onSubmit=\{submitReportForm\}/);
  assert.match(profileActions, /shareControl/);
  assert.match(liveApp, /followerCount === 1 \? "Follower" : "Followers"/);
  assert.match(liveApp, /tonightInterestCount\(profile\)\.toLocaleString\(\)/);
  assert.match(liveApp, /profileViewsToday\(profile, city\)\.toLocaleString\(\)/);
  assert.match(profileActions, /className="profile-header-report-toggle"/);
  assert.doesNotMatch(profileActions, /profile-header-overflow|role="menuitem"/);
  assert.match(profileActions, /targetType: "dancer_profile"/);
});

test("iPhone profiles keep outer hit areas unboxed while icons retain neutral glass", () => {
  for (const source of [aesthetic, liveApp]) {
    assert.match(source, /iPhone WebKit can composite (?:the )?transparent profile/);
    assert.match(
      source,
      /@supports \(-webkit-touch-callout: none\) \{[\s\S]*?\.profile-modal-header-metrics,[\s\S]*?\.profile-activity-metrics > div,[\s\S]*?\.modal-actions > \.action-btn\.profile-action-icon-control[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;[\s\S]*?-webkit-backdrop-filter: none !important;/,
    );
    assert.match(
      source,
      /\.modal-actions > \.action-btn\.profile-action-icon-control[\s\S]*?-webkit-appearance: none !important;[\s\S]*?-webkit-tap-highlight-color: transparent;/,
    );
  }

  assert.match(
    aesthetic,
    /modal-actions \.profile-action-icon-control \.action-icon,[\s\S]*?profile-action-icon-control \.profile-action-icon-frame \{[\s\S]*?border-radius: 50% !important;[\s\S]*?background-color: rgba\(18, 18, 28, 0\.38\) !important;[\s\S]*?-webkit-backdrop-filter: blur\(16px\) saturate\(1\.18\) !important;/,
  );
});

test("stats and media tabs are compact without changing dynamic media behavior", () => {
  assert.match(
    compactLayout,
    /\.profile-activity-metrics > div,[\s\S]*?\.profile-metrics > div \{[\s\S]*?display: flex !important;[\s\S]*?align-items: baseline !important;[\s\S]*?padding: 3px 2px !important;/,
  );
  assert.match(
    compactLayout,
    /\.profile-modal-media-tabs,[\s\S]*?\.profile-media-tabs \{[\s\S]*?min-height: 52px !important;/,
  );
  assert.match(
    compactLayout,
    /\.profile-modal-media-tabs button,[\s\S]*?\.profile-media-tabs button \{[\s\S]*?min-height: 52px !important;[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important;/,
  );
  assert.match(compactLayout, /\.profile-media-tab-icon \{[\s\S]*?width: 20px !important;[\s\S]*?height: 20px !important;/);
  assert.match(compactLayout, /button\.active,[\s\S]*?box-shadow: inset 0 -2px var\(--dancr-color-brand-primary\) !important;/);
  assert.match(
    compactLayout,
    /\.profile-modal-media,[\s\S]*?\.profile-media-section \{[\s\S]*?position: relative !important;[\s\S]*?isolation: isolate !important;[\s\S]*?padding-bottom: 0 !important;[\s\S]*?overflow: clip !important;[\s\S]*?border-radius: 18px !important;[\s\S]*?background: var\(--dancr-color-surface-translucent\) !important;/,
  );
  assert.match(
    compactLayout,
    /\.profile-modal-media::after,[\s\S]*?\.profile-media-section::after \{[\s\S]*?position: absolute !important;[\s\S]*?inset: 0 !important;[\s\S]*?border: 1px solid rgba\(180, 169, 196, \.38\) !important;[\s\S]*?pointer-events: none !important;/,
  );
  assert.match(profileMedia, /\{photoMedia\.length\}/);
  assert.match(profileMedia, /\{videoMedia\.length\}/);
  assert.match(profileMedia, /setActiveTab\("photo"\)/);
  assert.match(profileMedia, /setActiveTab\("video"\)/);
  assert.match(profileMedia, /visibleItems\.map/);
});
