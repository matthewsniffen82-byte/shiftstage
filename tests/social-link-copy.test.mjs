import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardSource, mobileAppSource, rootRouteSource, mobileSocialStripSource] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../public/mobile-social-strip.css", import.meta.url), "utf8"),
]);

test("social-link editors ask for a username or profile URL without an at-sign", () => {
  const dashboardPlatforms = dashboardSource.match(/const SOCIAL_PLATFORMS = \[[\s\S]*?\n\];/)?.[0] || "";
  assert.equal(dashboardPlatforms.match(/placeholder: "Username or profile URL"/g)?.length, 5);
  assert.doesNotMatch(dashboardPlatforms, /placeholder: "@/);

  for (const id of [
    "approvedControlInstagram",
    "approvedControlTiktok",
    "approvedControlSnapchat",
    "approvedControlOnlyfans",
    "approvedControlX",
    "profileInstagram",
    "profileTiktok",
    "profileSnapchat",
    "profileOnlyfans",
    "profileX",
  ]) {
    assert.match(mobileAppSource, new RegExp(`id="${id}"[^>]+placeholder="Username or profile URL"`));
  }

  assert.match(mobileAppSource, /data-approved-social-bulk-input[^>]+placeholder="Username or profile URL"/);
  assert.doesNotMatch(mobileAppSource, /placeholder="@username or profile URL"/);
});

test("live and edit social actions share one compact mobile row", () => {
  const socialLinksRule = mobileSocialStripSource.match(
    /#profileModal \.social-tile \.social-links,[\s\S]*?\n  }/,
  )?.[0] || "";
  const canonicalInlineStart = mobileAppSource.indexOf(
    "/* Canonical social strip: live profile and edit preview must stay visually identical. */",
  );
  const canonicalInlineEnd = mobileAppSource.indexOf(
    ".approved-visual-profile .approved-photo-edit-frame",
    canonicalInlineStart,
  );
  const canonicalInlineRules = mobileAppSource.slice(canonicalInlineStart, canonicalInlineEnd);

  assert.match(rootRouteSource, /mobile-social-strip\.css\?v=3/);
  assert.match(mobileSocialStripSource, /#profileModal \.social-tile,[\s\S]*?\.approved-visual-profile \.profile-modal \.social-tile/);
  assert.match(mobileSocialStripSource, /grid-template-columns: auto auto !important/);
  assert.match(mobileSocialStripSource, /justify-content: center !important/);
  assert.match(mobileSocialStripSource, /align-items: center !important/);
  assert.match(mobileSocialStripSource, /profile-utility-actions[\s\S]*?grid-row: 2 !important/);
  assert.match(socialLinksRule, /grid-row: 2 !important/);
  assert.match(mobileSocialStripSource, /border-right: 1px solid rgba\(53, 216, 255, 0\.28\) !important/);
  assert.match(mobileSocialStripSource, /approved-social-tools[\s\S]*?justify-self: end !important/);
  assert.match(mobileSocialStripSource, /social-edit-item[\s\S]*?align-self: center !important/);
  assert.match(mobileSocialStripSource, /social-icon svg[\s\S]*?display: block !important/);
  assert.doesNotMatch(socialLinksRule, /grid-row: 3 !important/);
  assert.ok(canonicalInlineStart >= 0);
  assert.match(canonicalInlineRules, /grid-template-columns: auto auto !important/);
  assert.match(canonicalInlineRules, /justify-content: center !important/);
  assert.match(canonicalInlineRules, /social-edit-item[\s\S]*?place-items: center !important/);
  assert.doesNotMatch(canonicalInlineRules, /grid-row: 3 !important/);
});

test("edit-profile social card keeps the live card structure and height", () => {
  const editSocialMarkup = mobileAppSource.match(
    /const approvedEditableSocialMarkup = `[\s\S]*?\n      `;/,
  )?.[0] || "";

  assert.match(editSocialMarkup, /<div class="social-tile-head">[\s\S]*?<div class="social-links">/);
  assert.match(editSocialMarkup, /No social links posted/);
  assert.match(editSocialMarkup, /\$\{socialEditButton\}\s*<\/div>/);
  assert.doesNotMatch(editSocialMarkup, /approved-social-edit-row/);
  assert.doesNotMatch(editSocialMarkup, /approved-social-edit-guidance/);
  assert.match(
    mobileAppSource,
    /\.approved-visual-profile \.profile-modal \.social-tile \{\s*padding-bottom: 10px !important;/,
  );
  assert.match(
    mobileAppSource,
    /#profileModal \.social-tile \.meta,\s*\.approved-visual-profile \.profile-modal \.social-tile > \.meta \{\s*grid-column: 1 \/ -1 !important;/,
  );
  assert.match(
    mobileAppSource,
    /\.approved-visual-profile \.approved-social-edit-btn \{[\s\S]*?position:[\s\S]*?top: 8px !important;[\s\S]*?bottom: auto !important;/,
  );
  assert.doesNotMatch(mobileSocialStripSource, /approved-social-edit-row/);
});
