import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveApp = await readFile(
  new URL("../outputs/index.html", import.meta.url),
  "utf8",
);

test("dancer profile overlays restore the exact dashboard surface that opened them", () => {
  const capture =
    liveApp.match(/function captureProfileReturnContext[\s\S]*?\n    }/)?.[0] || "";
  const activeSurface =
    liveApp.match(/function activeProfileReturnSurface[\s\S]*?\n    }/)?.[0] || "";
  const restore =
    liveApp.match(/function restoreProfileReturnContext[\s\S]*?\n    }/)?.[0] || "";
  const openProfile =
    liveApp.match(/function openProfileModal[\s\S]*?\n    let profileTvViewerOwnsFullscreen/)?.[0] || "";
  const closeProfile =
    liveApp.match(/function closeProfileModal[\s\S]*?\n    function syncOverlayScrollLock/)?.[0] || "";

  assert.match(activeSurface, /customer-dashboard/);
  assert.match(activeSurface, /dancer-dashboard/);
  assert.match(activeSurface, /venue-dashboard/);
  assert.match(capture, /panelScrollTop: panel\.scrollTop/);
  assert.match(capture, /windowScrollY: window\.scrollY/);
  assert.match(capture, /location: `\$\{window\.location\.pathname}/);
  assert.match(capture, /focusTarget: document\.activeElement/);

  assert.match(openProfile, /profileModalReturnContext = captureProfileReturnContext\(options\.returnTo \|\| ""\)/);
  assert.match(closeProfile, /restoreProfileReturnContext\(returnContext\)/);
  assert.match(restore, /panel\.classList\.add\("show"\)/);
  assert.match(restore, /panel\.scrollTop = context\.panelScrollTop/);
  assert.match(restore, /window\.scrollTo\(\{ top: context\.windowScrollY/);
  assert.match(restore, /context\.focusTarget\.focus\(\{ preventScroll: true \}\)/);
});

test("venue profiles restore dashboard surfaces while venue preview opens the canonical guest renderer", () => {
  const openVenue =
    liveApp.match(/function openVenueFromName[\s\S]*?\n    function focusVenueProfileStart/)?.[0] || "";
  const closeVenue =
    liveApp.match(/function closeVenueProfile[\s\S]*?\n    function scrollToVenueDetail/)?.[0] || "";
  const venuePreview =
    liveApp.match(/document\.getElementById\("venuePreviewPageBtn"\)[\s\S]*?\n    }\);/)?.[0] || "";
  const customerProfileOpen = [...liveApp.matchAll(
    /customerDashboard\.addEventListener\("click"[\s\S]*?\n    }\);/g,
  )].map((match) => match[0]).find((source) => source.includes("[data-card-venue]")) || "";

  assert.match(openVenue, /venueProfileReturnContext = captureProfileReturnContext\(options\.returnTo \|\| ""\)/);
  assert.match(openVenue, /suspendProfileReturnSurface\(venueProfileReturnContext\)/);
  assert.match(closeVenue, /restoreProfileReturnContext\(returnContext\)/);

  assert.match(venuePreview, /new URL\("\/outputs\/index\.html", window\.location\.origin\)/);
  assert.match(venuePreview, /searchParams\.set\("venue_preview", "1"\)/);
  assert.match(venuePreview, /window\.location\.assign\(previewUrl\.toString\(\)\)/);
  assert.match(closeVenue, /get\("venue_preview"\) === "1"[\s\S]*?window\.location\.assign\("\/dashboard\/venue"\)/);

  assert.match(customerProfileOpen, /returnTo: "customer-dashboard"/);
  assert.doesNotMatch(customerProfileOpen, /closeDashboard\(\)/);
});

test("venue roster dancer profiles stay inside the venue dashboard stack", () => {
  assert.match(
    liveApp,
    /data-venue-dashboard-dancer-profile="\$\{escapeOptionValue\(dancer\.dancerSlug \|\| dancer\.stageName \|\| ""\)\}"/,
  );
  assert.doesNotMatch(
    liveApp.match(/const working = Array\.isArray\(liveVenueDashboard\.workingNow\)[\s\S]*?renderVenueDancerAffiliations/)?.[0] || "",
    /href="\/dancers\//,
  );
  assert.match(
    liveApp,
    /venueDashboard\.addEventListener\("click"[\s\S]*?data-venue-dashboard-dancer-profile[\s\S]*?openProfileModal[\s\S]*?returnTo: "venue-dashboard"/,
  );
});
