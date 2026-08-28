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
  /\/\* Optional dancer-profile engagement content uses natural document flow\.[\s\S]*?(?=\/\* Production TV-card branding)/,
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
    /\{profile\.socialLinks\.length \? \([\s\S]*?className="profile-social-section"[\s\S]*?: null\}/,
  );
  assert.equal(renderSocialLinks({ socials: {} }), "");
  assert.equal(renderSocialLinks({ socials: {} }, { preview: true }), "");
  assert.doesNotMatch(socialFunctionSource, /No profiles posted|social placeholder|empty social/i);
  assert.match(
    compactLayout,
    /\.profile-social-section \{[\s\S]*?min-height: 0 !important;[\s\S]*?margin: 0 0 6px !important;[\s\S]*?padding: 0 !important;/,
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
  assert.match(compactLayout, /\.social-list \{[\s\S]*?width: fit-content !important;[\s\S]*?flex-wrap: nowrap !important;[\s\S]*?gap: 4px !important;/);
  assert.match(compactLayout, /\.social-list a \{[\s\S]*?width: 44px !important;[\s\S]*?height: 44px !important;/);
  assert.match(compactLayout, /\.social-list a::before \{[\s\S]*?inset: 3px !important;[\s\S]*?border: 1px solid rgba\(226, 232, 240, \.11\) !important;/);
  assert.match(compactLayout, /\.social-list a svg \{[\s\S]*?width: 14px !important;[\s\S]*?height: 14px !important;/);
});

test("all schedule states share the same compact header stats, four-action, status, optional-social, and media order", () => {
  const liveGrid = liveApp.match(
    /function profileModalGridMarkup\(profile, options = \{\}\) \{[\s\S]*?(?=\n    function profileActionButtonMarkup)/,
  )?.[0] || "";
  const liveActions = liveApp.match(
    /function liveProfileModalActionsMarkup\(profile, status\) \{[\s\S]*?(?=\n    async function refreshProfileGoingState)/,
  )?.[0] || "";
  const actionsIndex = liveGrid.indexOf("liveProfileModalActionsMarkup");
  const statusIndex = liveGrid.indexOf('class="${tonightClasses}"');
  const socialIndex = liveGrid.indexOf("${socialMarkup}");

  assert.ok(actionsIndex > -1 && statusIndex > actionsIndex && socialIndex > statusIndex);
  assert.doesNotMatch(liveGrid, /profileActivityMetricsMarkup/);
  assert.match(liveApp, /modalProfileMetrics\.innerHTML = profileActivityMetricsMarkup\(profile, city\)/);
  assert.match(liveActions, /Follow[\s\S]*?Notify[\s\S]*?\$\{goingButton\}[\s\S]*?Share/);
  assert.doesNotMatch(liveActions, /Report profile|profile-report-action/);
  assert.doesNotMatch(liveApp, /class="profile-modal-report-link"|id="reportBtn"/);
  assert.doesNotMatch(liveApp, /id="profileActionOverflowToggle"|id="profileActionOverflowMenu"/);
  assert.match(liveActions, /isWorkingNow \? "is-working-now" : profile\?\.scheduled \? "is-upcoming-shift" : "is-no-live-shift"/);
  assert.match(profileActions, /hasLiveActions \? " has-live-shift" : hasScheduledActions \? " has-upcoming-shift" : " is-no-live-shift"/);
  assert.match(
    compactLayout,
    /\.modal-actions,[\s\S]*?\.live-actions \{[\s\S]*?--profile-row-inline-start: clamp\(16px, 5vw, 20px\);[\s\S]*?grid-template-columns: repeat\(4, clamp\(48px, 13vw, 52px\)\) !important;[\s\S]*?justify-content: start !important;/,
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
  assert.match(compactLayout, /button\.active,[\s\S]*?box-shadow: inset 0 -2px var\(--dancr-color-brand-primary\) !important;/);
  assert.match(profileMedia, /\{photoMedia\.length\}/);
  assert.match(profileMedia, /\{videoMedia\.length\}/);
  assert.match(profileMedia, /setActiveTab\("photo"\)/);
  assert.match(profileMedia, /setActiveTab\("video"\)/);
  assert.match(profileMedia, /visibleItems\.map/);
});
