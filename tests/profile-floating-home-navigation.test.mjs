import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  homeSource,
  dancerPage,
  venuePage,
  floatingControl,
  floatingStyles,
] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dancers/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/FloatingProfileHomeLink.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../app/components/FloatingProfileHomeLink.module.css",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("the homepage full dancer profile keeps the glass city-return control", () => {
  assert.match(
    homeSource,
    /body\.profile-full-view-open \.home-feed-return-home \{[\s\S]*?z-index: 222;[\s\S]*?display: grid;/,
  );
  assert.match(
    homeSource,
    /function syncOverlayScrollLock\(\)[\s\S]*?profileBackdrop\.classList\.contains\("show"\)[\s\S]*?classList\.toggle\("profile-full-view-open", profileFullViewOpen\)/,
  );
  assert.match(
    homeSource,
    /function returnToHomeDiscoveryMain\(\) \{\s*if \(profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\);/,
  );
});

test("standalone dancer and venue profiles keep the glass city-return control", () => {
  assert.match(
    floatingControl,
    /profileType: "dancer" \| "venue"/,
  );
  assert.match(
    floatingControl,
    /aria-label={`Return from this full \$\{profileType\} profile to the \$\{selectedCity\} city screen`}/,
  );
  assert.match(
    floatingControl,
    /href={`\/\?city=\$\{encodeURIComponent\(selectedCity\)\}`}/,
  );
  assert.match(floatingControl, /<svg aria-hidden="true" viewBox="0 0 24 24">/);
  assert.match(
    floatingStyles,
    /@media \(max-width: 720px\)[\s\S]*?position: fixed;[\s\S]*?top: max\(12px, calc\(env\(safe-area-inset-top, 0px\) \+ 8px\)\);[\s\S]*?left: max\(12px, calc\(env\(safe-area-inset-left, 0px\) \+ 8px\)\);[\s\S]*?width: 46px;[\s\S]*?height: 46px;[\s\S]*?backdrop-filter: blur\(14px\) saturate\(1\.2\);/,
  );
  assert.match(
    dancerPage,
    /<FloatingProfileHomeLink city=\{profile\.city\} profileType="dancer" \/>/,
  );
  assert.match(
    dancerPage,
    /@media \(max-width: 760px\)[\s\S]*?\.profile-global-topbar \{ grid-template-columns: 46px[\s\S]*?\.profile-global-logo \{ visibility: hidden;/,
  );
  assert.match(
    venuePage,
    /<FloatingProfileHomeLink city=\{venue\.city\} profileType="venue" \/>/,
  );
  assert.match(venuePage, /<PublicProfileHeader/);
  assert.doesNotMatch(venuePage, /permanentRedirect/);
  assert.match(
    venuePage,
    /<ProfileCloseButton[\s\S]*?fallbackHref=\{venuesHref\}[\s\S]*?profileType="venue"/,
  );
  assert.match(homeSource, /function venueDetailPage\(venue\)/);
});
