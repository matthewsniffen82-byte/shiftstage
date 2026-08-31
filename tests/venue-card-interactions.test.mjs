import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");
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
    /const workingNow = venueDancers\(city, venue\.name\)[\s\S]*?isWorkingTonight\(profile, city\)/,
  );
  assert.match(
    venueCardRenderer,
    /venueLineupMarkup\(venue, city, \{ profiles: workingNow \}\)/,
  );
  assert.doesNotMatch(venueCardRenderer, /venue-card-live|workingNowMarkup/);
  assert.match(venueCardRenderer, /venue-card-follow[\s\S]*?data-venue-follow="\$\{venueValue\}"/);
  assert.match(venueCardRenderer, /venueCardQrMarkup\(venue\)[\s\S]*?directionsMarkup/);
  assert.match(
    homeSource,
    /function venueCardQrMarkup\(venue\)[\s\S]*?venue\.activeDeal\?\.id[\s\S]*?data-club-deal-cta[\s\S]*?actionButtonLabel\("qr", offerCount > 1 \? "Club Deals" : "Club Deal"\)[\s\S]*?return "";/,
  );
  const venueCardQrHelper = homeSource.match(
    /function venueCardQrMarkup\(venue\) \{[\s\S]*?(?=\n    function venueCard)/,
  )?.[0] || "";
  assert.doesNotMatch(venueCardQrHelper, /data-venue-profile-qr|Venue QR/);

  assert.doesNotMatch(venueSwipeRenderer, /nextProfile|nextShiftMarkup|No upcoming dancer shifts posted/);
  assert.doesNotMatch(
    venueSwipeRenderer,
    /home-discovery-feed-open-profile/,
  );
  assert.match(
    venueSwipeRenderer,
    /homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?home-venue-discovery-location[\s\S]*?home-venue-discovery-context-actions[\s\S]*?\$\{directionsMarkup\}[\s\S]*?\$\{rideMarkup\}[\s\S]*?home-venue-discovery-action-rail[\s\S]*?home-venue-discovery-profile-action[\s\S]*?data-open-venue-profile="\$\{venueValue\}"[\s\S]*?actionButtonLabel\("clubProfile", "Club Page"\)[\s\S]*?\$\{railQrMarkup\}[\s\S]*?data-share-venue="\$\{venueValue\}"[\s\S]*?actionButtonLabel\("share", "Share"\)[\s\S]*?data-venue-follow/,
  );
  assert.doesNotMatch(venueSwipeRenderer, /home-venue-discovery-name-row|home-venue-discovery-name/);
  assert.doesNotMatch(venueSwipeRenderer, /activeDealCount|dealIndicatorMarkup|home-venue-discovery-deal-indicator/);
  assert.match(
    venueSwipeRenderer,
    /home-venue-discovery-context-actions[\s\S]*?aria-label="\$\{safeName\} primary actions"[\s\S]*?\$\{directionsMarkup\}[\s\S]*?\$\{rideMarkup\}/,
  );
  assert.doesNotMatch(venueSwipeRenderer, /const qrMarkup|home-venue-discovery-club-deal|Mydancr venue/);
  assert.match(
    venueSwipeRenderer,
    /venueLineupMarkup\(venue, city, \{ mobile: true, profiles: workingNow, eager: index < 2 \}\)[\s\S]*?const workingLabel = `\$\{workingNow\.length\} working now`[\s\S]*?accessibilityLabel = workingNow\.length/,
  );
  assert.doesNotMatch(venueSwipeRenderer, /home-discovery-feed-status is-now|workingNowMarkup/);
  assert.match(venueSwipeRenderer, /const directionsMarkup[\s\S]*?venue-directions-btn/);
  assert.match(
    homeSource,
    /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?data-club-deal-cta[\s\S]*?actionButtonLabel\("qr", offerCount > 1 \? "Club Deals" : "Club Deal"\)[\s\S]*?data-card-qr-label="Club Deal unavailable"/,
  );
  const venueSwipeQrHelper = homeSource.match(
    /function homeVenueDiscoveryQrMarkup\(venue\) \{[\s\S]*?(?=\n    function homeVenueDiscoveryFeedSlide)/,
  )?.[0] || "";
  assert.doesNotMatch(
    venueSwipeQrHelper,
    /data-venue-profile-qr|data-external-venue-qr|home-venue-discovery-profile-qr/,
  );
});

test("mobile club cards compact every data state without replacing interaction state", () => {
  const venueSwipeRenderer = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.doesNotMatch(venueSwipeRenderer, /activeDealCount|dealIndicatorMarkup|home-venue-discovery-deal-indicator/);
  assert.match(venueSwipeRenderer, /const railQrMarkup = homeVenueDiscoveryQrMarkup\(venue\)/);
  assert.match(
    venueSwipeRenderer,
    /venueOperatingStatus\(details\.hours, city\)[\s\S]*?operatingStatus\.hoursLabel[\s\S]*?Hours · \$\{escapeHtml\(operatingStatus\.hoursLabel\)\}[\s\S]*?\$\{operatingStatusMarkup\}\$\{hoursMarkup\}/,
  );
  assert.match(
    aesthetic,
    /Clubs card presentation repair[\s\S]*?height: clamp\(320px, 84vw, 348px\) !important;[\s\S]*?grid-template-rows: 112px minmax\(0, 1fr\) 52px 58px !important;/,
  );
  assert.match(
    aesthetic,
    /Clubs card presentation repair[\s\S]*?\.home-venue-discovery-logo \{[\s\S]*?height: 92px !important;[\s\S]*?max-height: 92px !important;[\s\S]*?object-fit: contain !important;[\s\S]*?transform: none !important;/,
  );
  assert.match(
    aesthetic,
    /Clubs card presentation repair[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\) !important;[\s\S]*?height: 44px !important;[\s\S]*?border-radius: 11px !important;/,
  );
  assert.match(
    aesthetic,
    /Clubs card presentation repair[\s\S]*?\.home-venue-discovery-rail-qr\.is-available \{[\s\S]*?rgba\(34, 197, 94, 0\.5\)[\s\S]*?\[data-venue-follow\]:is\(\.is-active, \[aria-pressed="true"\]\) \{[\s\S]*?rgba\(139, 92, 246, 0\.52\)/,
  );
});

test("the retired venue directory can only open the canonical homepage venue cards", () => {
  assert.match(venuesPageSource, /import \{ permanentRedirect \} from "next\/navigation"/);
  assert.match(
    venuesPageSource,
    /permanentRedirect\(homeDiscoveryHref\("venues", params\.city\)\)/,
  );
  assert.doesNotMatch(venuesPageSource, /venue-card-main|venue-card-profile|venue-card-deal/);
});
