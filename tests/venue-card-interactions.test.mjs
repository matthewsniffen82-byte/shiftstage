import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const venuesPageSource = await readFile(new URL("../app/venues/page.tsx", import.meta.url), "utf8");

test("venue card surfaces stay passive while live status and explicit actions remain interactive", () => {
  const venueCardRenderer = homeSource.match(
    /function venueCard\(venue\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const venueSwipeRenderer = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.match(venueCardRenderer, /<article class="card venue venue-card"/);
  assert.doesNotMatch(venueCardRenderer, /<a class="card venue venue-card"/);
  assert.doesNotMatch(homeSource, /event\.target\.closest\("\.venue-card"\)/);

  assert.match(
    venueCardRenderer,
    /const workingNowCount = venueDancers\(citySelect\.value, venue\.name\)[\s\S]*?isWorkingTonight\(profile, citySelect\.value\)/,
  );
  assert.match(
    venueCardRenderer,
    /const workingNowMarkup = workingNowCount[\s\S]*?<a class="pill venue-shift-pill" href="\$\{venueHref\}"[\s\S]*?>\$\{workingNowCount\} working now<\/a>[\s\S]*?: "";/,
  );
  assert.doesNotMatch(venueCardRenderer, /\? "dancer" : "dancers"/);
  assert.doesNotMatch(venueCardRenderer, /posted shifts|venue\.shifts|upcoming/i);

  assert.doesNotMatch(venueSwipeRenderer, /nextProfile|nextShiftMarkup|No upcoming dancer shifts posted/);
  assert.doesNotMatch(venueSwipeRenderer, /home-discovery-feed-open-profile/);
  assert.match(
    venueSwipeRenderer,
    /home-discovery-feed-profile-button" href="\$\{venueHref\}"[\s\S]*?data-venue-follow/,
  );
  assert.match(
    venueSwipeRenderer,
    /const workingLabel = `\$\{workingNow\.length\} working now`[\s\S]*?<a class="home-discovery-feed-status is-now" href="\$\{venueHref\}"[\s\S]*?: "";/,
  );
  assert.match(venueSwipeRenderer, /const directionsMarkup[\s\S]*?venue-directions-btn/);
});

test("the production venue directory keeps card bodies passive and deal CTAs clickable", () => {
  assert.match(venuesPageSource, /<div className="venue-card-main">/);
  assert.doesNotMatch(venuesPageSource, /<Link className="venue-card-main"/);
  assert.match(
    venuesPageSource,
    /className="venue-card-deal"[\s\S]*?href=\{`\/\?city=\$\{encodeURIComponent\(venue\.city\)\}&venue=\$\{encodeURIComponent\(venue\.slug\)\}#club-deal`\}/,
  );
});
