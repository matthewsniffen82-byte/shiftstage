import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const venuesPageSource = await readFile(new URL("../app/venues/page.tsx", import.meta.url), "utf8");

test("venue cards open the live profile while revenue and customer actions remain independent", () => {
  const venueCardRenderer = homeSource.match(
    /function venueCard\(venue\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const venueSwipeRenderer = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.match(venueCardRenderer, /<article class="card venue venue-card"/);
  assert.doesNotMatch(venueCardRenderer, /<a class="card venue venue-card"/);
  assert.match(
    venueCardRenderer,
    /<a class="venue-card-link" href="\$\{venueHref\}" data-open-venue-profile="\$\{venueValue\}"/,
  );
  assert.doesNotMatch(homeSource, /event\.target\.closest\("\.venue-card"\)/);

  assert.match(
    venueCardRenderer,
    /const workingNowCount = venueDancers\(city, venue\.name\)[\s\S]*?isWorkingTonight\(profile, city\)/,
  );
  assert.match(
    venueCardRenderer,
    /const workingNowMarkup = workingNowCount[\s\S]*?<span class="venue-card-live">\$\{workingNowCount\} working now<\/span>[\s\S]*?: "";/,
  );
  assert.doesNotMatch(venueCardRenderer, /\? "dancer" : "dancers"/);
  assert.match(venueCardRenderer, /venue-card-follow[\s\S]*?data-venue-follow="\$\{venueValue\}"/);
  assert.match(venueCardRenderer, /venueCardQrMarkup\(venue\)[\s\S]*?directionsMarkup/);

  assert.doesNotMatch(venueSwipeRenderer, /nextProfile|nextShiftMarkup|No upcoming dancer shifts posted/);
  assert.doesNotMatch(
    venueSwipeRenderer,
    /home-discovery-feed-open-profile/,
  );
  assert.match(
    venueSwipeRenderer,
    /home-dancer-grid-actions home-venue-grid-actions[\s\S]*?home-dancer-grid-action-rail home-venue-discovery-action-rail[\s\S]*?home-dancer-grid-profile-button[\s\S]*?home-dancer-grid-context-actions home-venue-discovery-context-actions/,
  );
  assert.match(
    venueSwipeRenderer,
    /homeVenueDiscoveryQrMarkup\(venue, "rail"\)[\s\S]*?home-venue-discovery-action-rail[\s\S]*?data-open-venue-profile="\$\{venueValue\}"[\s\S]*?data-share-venue="\$\{venueValue\}"[\s\S]*?data-venue-follow/,
  );
  assert.match(
    venueSwipeRenderer,
    /home-venue-discovery-context-actions[\s\S]*?\$\{qrMarkup\}[\s\S]*?\$\{directionsMarkup\}/,
  );
  assert.match(
    venueSwipeRenderer,
    /const workingLabel = `\$\{workingNow\.length\} working now`[\s\S]*?<span class="home-discovery-feed-status is-now">\$\{escapeHtml\(workingLabel\)\}<\/span>[\s\S]*?: "";/,
  );
  assert.match(venueSwipeRenderer, /const directionsMarkup[\s\S]*?venue-directions-btn/);
});

test("the retired venue directory can only open the canonical homepage venue cards", () => {
  assert.match(venuesPageSource, /import \{ permanentRedirect \} from "next\/navigation"/);
  assert.match(
    venuesPageSource,
    /permanentRedirect\(homeDiscoveryHref\("venues", params\.city\)\)/,
  );
  assert.doesNotMatch(venuesPageSource, /venue-card-main|venue-card-profile|venue-card-deal/);
});
