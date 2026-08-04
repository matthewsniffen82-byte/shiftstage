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
    /body\.dashboard-overlay-open \.discovery-sticky-head,\s*body\.dancer-auth-overlay-open \.discovery-sticky-head,\s*body\.venue-auth-overlay-open \.discovery-sticky-head \{\s*visibility: hidden !important;\s*pointer-events: none !important;\s*\}/,
  );
  assert.doesNotMatch(
    homeSource,
    /body\.(?:dancer|venue)-auth-overlay-open (?:\.app > header|#discoveryTabs)/,
  );
  const dashboardLayer = homeSource.match(
    /#customerDashboard\.page-panel\.show,\s*#dancerDashboard\.page-panel\.show,\s*#venueDashboard\.page-panel\.show,\s*#adminDashboard\.page-panel\.show \{\s*z-index: (\d+) !important;\s*isolation: isolate;\s*\}/,
  );
  const discoveryLayer = homeSource.match(
    /\.discovery-sticky-head \{[^}]*z-index: (\d+);/s,
  );
  const profileLayer = homeSource.match(
    /#profileBackdrop\.modal-backdrop\.show \{\s*z-index: (\d+) !important;/,
  );
  assert.ok(dashboardLayer);
  assert.ok(discoveryLayer);
  assert.ok(profileLayer);
  assert.ok(Number(dashboardLayer[1]) > Number(discoveryLayer[1]));
  assert.ok(Number(dashboardLayer[1]) < Number(profileLayer[1]));
  assert.match(
    homeSource,
    /const dashboardOverlayOpen = !!document\.querySelector\(\s*"#customerDashboard\.show, #dancerDashboard\.show, #venueDashboard\.show, #adminDashboard\.show"\s*\);[\s\S]*?document\.body\.classList\.toggle\("dashboard-overlay-open", dashboardOverlayOpen\);/,
  );
  assert.match(
    homeSource,
    /const dancerAuthOverlayOpen =\s*authPage\.classList\.contains\("show"\) &&\s*!document\.getElementById\("dancerLoginForm"\)\.hidden;[\s\S]*?document\.body\.classList\.toggle\("dancer-auth-overlay-open", dancerAuthOverlayOpen\);/,
  );
  assert.match(
    homeSource,
    /const venueAuthOverlayOpen =\s*authPage\.classList\.contains\("show"\) &&\s*!document\.getElementById\("venueLoginForm"\)\.hidden;[\s\S]*?document\.body\.classList\.toggle\("venue-auth-overlay-open", venueAuthOverlayOpen\);/,
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
