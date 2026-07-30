import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileRoute = await readFile(new URL("../app/venues/[slug]/page.tsx", import.meta.url), "utf8");
const liveApp = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");

test("venue URLs load the focused Mydancr venue profile with real production data", () => {
  assert.match(profileRoute, /getVenueProfile\(client, slug\)/);
  assert.match(profileRoute, /if \(!venue\) notFound\(\)/);
  assert.match(profileRoute, /<PublicProfileHeader/);
  assert.match(profileRoute, /<FloatingProfileHomeLink city=\{venue\.city\} profileType="venue" \/>/);
  assert.match(profileRoute, /<VenueProfileActions venueId=\{venue\.id\} venueName=\{venue\.name\} \/>/);
  assert.match(profileRoute, /\.from\("shifts"\)/);
  assert.match(profileRoute, /getActiveClubDealForVenue\(client, venue\.id\)/);
  assert.match(profileRoute, /getPublicMyDancrTvFeed\(client,/);
  assert.match(profileRoute, /\/api\/public\/maps\/embed\?address=/);
  assert.doesNotMatch(profileRoute, /permanentRedirect|stickyCta/);
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

test("venue entry points open the dedicated venue profile route", () => {
  assert.match(
    liveApp,
    /function venueExperienceHref\(venue, city = selectedCity\(\)\)[\s\S]*?return `\/venues\/\$\{encodeURIComponent\(venueSlug\)\}`/,
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
