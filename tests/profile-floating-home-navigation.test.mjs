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

test("standalone dancers keep only the X with an active Dancers fallback while legacy venues enter the in-app profile", () => {
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
    /@media \(max-width: 600px\)[\s\S]*?\.profile-titlebar \{ min-height: 64px; \}/,
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
