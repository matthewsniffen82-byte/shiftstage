import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileRoute = await readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8");
const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("legacy venue URLs resolve real venues and enter the canonical Mydancr experience", () => {
  assert.match(profileRoute, /getVenueProfile\(createAdminSupabaseClient\(\), slug\)/);
  assert.match(profileRoute, /if \(!venue\) notFound\(\)/);
  assert.match(
    profileRoute,
    /new URLSearchParams\(\{[\s\S]*?city: venue\.city,[\s\S]*?venue: venue\.slug,[\s\S]*?\}\)/,
  );
  assert.match(profileRoute, /permanentRedirect\(`\/\?\$\{query\.toString\(\)\}`\)/);
  assert.doesNotMatch(profileRoute, /VenueProfileActions|VenueProfile\.module|stickyCta|<main/);
});

test("the canonical in-app venue page keeps live data, planning details, and production actions together", () => {
  const venueDetail = liveApp.match(
    /function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.match(venueDetail, /venueDancers\(city, venue\.name\)/);
  assert.match(
    venueDetail,
    /const tonight = localProfiles[\s\S]*?isWorkingTonight\(profile\)[\s\S]*?const upcoming = localProfiles[\s\S]*?!isWorkingTonight\(profile, city\) && profile\.scheduled/,
  );
  assert.match(venueDetail, /recordVenuePageEvent\(\{ venueId: venue\.id, eventType: "page_view", source: "venue_page" \}\)/);
  assert.match(venueDetail, /venueOfferMarkup\(venue\)/);
  assert.match(venueDetail, /\/api\/public\/maps\/embed\?address=/);
  assert.match(venueDetail, /data-venue-follow="\$\{venue\.name\}"/);
  assert.match(venueDetail, /https:\/\/maps\.google\.com\/\?q=/);
  assert.match(venueDetail, /Working now at \$\{details\.name\}/);
  assert.match(venueDetail, /Upcoming shifts at \$\{details\.name\}/);
  assert.match(venueDetail, /Trending in \$\{details\.city\}/);
  assert.match(venueDetail, /Other \$\{city\} venues/);
});

test("venue entry points use one city-aware destination instead of competing detail pages", () => {
  assert.match(
    liveApp,
    /function venueExperienceHref\(venue, city = selectedCity\(\)\)[\s\S]*?new URLSearchParams\(\{[\s\S]*?city: venueCity,[\s\S]*?venue: venueSlug/,
  );
  assert.match(
    liveApp,
    /function venueCard\(venue\)[\s\S]*?const venueHref = venueExperienceHref\(venue, citySelect\.value\)/,
  );
  assert.match(
    liveApp,
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\)[\s\S]*?const venueHref = venueExperienceHref\(venue, city\)/,
  );
});
