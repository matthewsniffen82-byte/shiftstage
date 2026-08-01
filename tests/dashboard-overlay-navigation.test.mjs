import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

test("account dashboards hide public navigation and keep their X as the exit to home", () => {
  assert.match(
    homeSource,
    /body\.dashboard-overlay-open \.app > header,\s*body\.dashboard-overlay-open #discoveryTabs \{\s*display: none !important;\s*\}/,
  );
  assert.match(
    homeSource,
    /const dashboardOverlayOpen = !!document\.querySelector\(\s*"#customerDashboard\.show, #dancerDashboard\.show, #venueDashboard\.show, #adminDashboard\.show"\s*\);[\s\S]*?document\.body\.classList\.toggle\("dashboard-overlay-open", dashboardOverlayOpen\);/,
  );
  assert.match(
    homeSource,
    /<button class="close-btn" id="dancerDashboardClose" aria-label="Close dancer dashboard">/,
  );
  assert.match(
    homeSource,
    /function closeDancerDashboard\(\) \{\s*dancerDashboard\.classList\.remove\("show"\);\s*dancerDashboard\.setAttribute\("aria-hidden", "true"\);\s*syncOverlayScrollLock\(\);\s*\}/,
  );
  assert.match(
    homeSource,
    /document\.getElementById\("dancerDashboardClose"\)\.addEventListener\("click", closeDancerDashboard\);/,
  );
});
