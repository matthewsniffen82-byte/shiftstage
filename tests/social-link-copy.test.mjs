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

  assert.match(rootRouteSource, /mobile-social-strip\.css\?v=1/);
  assert.match(mobileSocialStripSource, /#profileModal \.social-tile,[\s\S]*?\.approved-visual-profile \.profile-modal \.social-tile/);
  assert.match(mobileSocialStripSource, /grid-template-columns: auto minmax\(0, 1fr\) !important/);
  assert.match(mobileSocialStripSource, /profile-utility-actions[\s\S]*?grid-row: 2 !important/);
  assert.match(socialLinksRule, /grid-row: 2 !important/);
  assert.match(mobileSocialStripSource, /border-right: 1px solid rgba\(53, 216, 255, 0\.28\) !important/);
  assert.doesNotMatch(socialLinksRule, /grid-row: 3 !important/);
});
