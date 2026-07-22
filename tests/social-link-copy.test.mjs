import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [dashboardSource, mobileAppSource] = await Promise.all([
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
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
