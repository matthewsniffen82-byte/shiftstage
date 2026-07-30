import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [layoutSource, navigationSource, tvSource, homeSource, dashboardSource, offersSource, savedSource] = await Promise.all([
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../app/components/GlobalMobileBottomNav.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../app/tv/TvFeedClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/customer/offers/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/customer/saved/page.tsx", import.meta.url), "utf8"),
]);

test("every Next page receives the shared four-destination app navigation", () => {
  assert.match(layoutSource, /import \{ GlobalMobileBottomNav \}/);
  assert.match(layoutSource, /<GlobalMobileBottomNav \/>/);
  assert.match(
    navigationSource,
    /id: "home"[\s\S]*?id: "offers"[\s\S]*?id: "saved"[\s\S]*?id: "account"/,
  );
  assert.match(
    navigationSource,
    /className="global-mobile-bottom-nav"[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
  );
  assert.doesNotMatch(navigationSource, /id: "tv"|tv-destination/);
  assert.match(
    navigationSource,
    /destination === "offers"[\s\S]*?pathname === "\/dashboard\/customer\/offers"[\s\S]*?destination === "saved"[\s\S]*?pathname === "\/dashboard\/customer\/saved"/,
  );
  assert.match(navigationSource, /destination\.keepsCity[\s\S]*?encodeURIComponent\(city\)/);
  assert.doesNotMatch(tvSource, /className="tv-mobile-nav"/);
});

test("the homepage serves its own matching app navigation while keeping city categories interactive", () => {
  assert.match(
    homeSource,
    /class="home-app-bottom-nav"[\s\S]*?>Home<[\s\S]*?>Offers<[\s\S]*?>Saved<[\s\S]*?>Account</,
  );
  assert.match(
    homeSource,
    /tab\.addEventListener\("click", \(\) => \{[\s\S]*?profileBackdrop\.classList\.contains\("show"\)\) closeProfileModal\(\)/,
  );
});

test("Offers and Saved open focused views of authenticated production customer data", () => {
  assert.match(offersSource, /<DashboardClient role="customer" initialSection="offers" \/>/);
  assert.match(savedSource, /<DashboardClient role="customer" initialSection="saved" \/>/);
  assert.match(
    dashboardSource,
    /role === "venue" \? "\/api\/venue\/dashboard" : "\/api\/customer\/saved"/,
  );
  assert.match(
    dashboardSource,
    /initialSection === "offers" \? "customer-offers" : "customer-saved"/,
  );
  assert.match(
    dashboardSource,
    /function CustomerSavedPanel[\s\S]*?id="customer-saved"[\s\S]*?followedDancers\.map[\s\S]*?favoriteDancers\.map[\s\S]*?followedVenues\.map/,
  );
  assert.match(
    dashboardSource,
    /id="customer-offers"[\s\S]*?deals\.map/,
  );
});
