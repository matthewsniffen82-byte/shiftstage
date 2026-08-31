import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  homeSource,
  dancerPage,
  venuePage,
] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8"),
]);

test("the homepage full dancer profile reserves dismissal for its X control", () => {
  assert.match(
    homeSource,
    /body\.profile-full-view-open \.home-feed-return-home \{[\s\S]*?display: none !important;[\s\S]*?pointer-events: none !important;/,
  );
  assert.match(
    homeSource,
    /function syncOverlayScrollLock\(\)[\s\S]*?profileBackdrop\.classList\.contains\("show"\)[\s\S]*?classList\.toggle\("profile-full-view-open", profileFullViewOpen\)/,
  );
  assert.match(
    homeSource,
    /function returnToHomeDiscoveryMain\(\) \{\s*if \(profileBackdrop\.classList\.contains\("show"\)\) return false;/,
  );
  assert.doesNotMatch(
    homeSource,
    /if \(event\.target === profileBackdrop\) closeProfileModal\(\)/,
  );
  assert.match(
    homeSource,
    /event\.key === "Escape" && profileBackdrop\.classList\.contains\("show"\)[\s\S]*?event\.preventDefault\(\);[\s\S]*?return;/,
  );
});

test("standalone dancers keep report and dismissal utilities together while legacy venues enter the in-app profile", () => {
  assert.doesNotMatch(
    dancerPage,
    /FloatingProfileHomeLink/,
  );
  assert.match(
    dancerPage,
    /<ProfileCloseButton[\s\S]*?fallbackHref=\{`\/\?city=\$\{encodeURIComponent\(profile\.city\)\}&view=dancers`\}/,
  );
  assert.match(
    dancerPage,
    /@media \(max-width: 600px\)[\s\S]*?body\.dancr-button-system \.public-profile-shell \.profile-titlebar \{[\s\S]*?grid-template-columns: minmax\(108px, \.92fr\) minmax\(0, 1\.08fr\) 80px !important;[\s\S]*?gap: 5px !important;[\s\S]*?min-height: 64px !important;/,
  );
  assert.match(
    venuePage,
    /permanentRedirect\([\s\S]*?city=\$\{encodeURIComponent\(venue\.city \|\| "Las Vegas"\)\}&venue=\$\{encodeURIComponent\(venue\.slug\)\}/,
  );
  assert.doesNotMatch(
    venuePage,
    /FloatingProfileHomeLink|PublicProfileHeader|ProfileCloseButton/,
  );
  assert.match(homeSource, /function venueDetailPage\(venue\)/);
});
