import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const homeSource = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");
const venuesPageSource = await readFile(new URL("../app/venues/page.tsx", import.meta.url), "utf8");

test("desktop venue cards render entry and directions without undefined state", () => {
  const factory = homeSource.match(/    function venueCard\(venue\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(factory);
  const context = {
    venue: { id: 'venue-1', name: 'Fixture club', city: 'Las Vegas', activeDeal: { dealTitle: 'Entry' } },
    venueDetails: () => ({ city: 'Las Vegas', state: 'NV', distanceLabel: '1 mi', hours: '8 PM' }),
    venueOperatingStatus: () => ({ state: 'unknown', label: 'Hours unavailable', hoursLabel: '' }),
    actionButtonLabel: (_, label) => label,
    venueInitials: () => 'FC', escapeHtml: String, escapeOptionValue: String,
    venueExperienceHref: () => '/venues/fixture', venueLogoMarkup: () => '',
    venueVisualAttrs: () => ({ attrs: { className: ' is-venue-artwork', style: '' }, source: 'artwork' }),
    venueDancers: () => [], isFollowingVenue: () => false, venueAccent: () => '#000',
    venueLineupMarkup: () => '', displayShiftTime: String, actionIconMarkup: () => '',
    venueDirectionsMarkup: () => '<a data-direction-fixture>Directions</a>',
    venueCardQrMarkup: () => '<button data-entry-fixture>Free Entry</button>',
  };
  const markup = vm.runInNewContext(factory + '\nvenueCard(venue)', context);
  for (const action of ['direction', 'entry']) {
    assert.equal(markup.split(`data-${action}-fixture`).length - 1, 1);
  }
  assert.match(markup, /class="club-brand-visual venue-card-link"/);
});

test("venue cards open the live profile while revenue and customer actions remain independent", () => {
  const venueCardRenderer = homeSource.match(
    /function venueCard\(venue\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const venueSwipeRenderer = homeSource.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.match(venueCardRenderer, /<article [^>]*class="card venue venue-card club-brand-card"/);
  assert.doesNotMatch(venueCardRenderer, /<a [^>]*class="card venue venue-card"/);
  assert.match(
    venueCardRenderer,
    /<a class="club-brand-visual venue-card-link" href="\$\{venueHref\}" data-open-venue-profile="\$\{venueValue\}"/,
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
    /function venueCardQrMarkup\(venue\)[\s\S]*?venue\.activeDeal\?\.id[\s\S]*?data-club-deal-cta[\s\S]*?freeEntryButtonLabel\(\)[\s\S]*?return "";/,
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
    /homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?club-brand-location[\s\S]*?club-card-entry[\s\S]*?\$\{railQrMarkup\}[\s\S]*?club-secondary-actions[\s\S]*?\$\{directionsMarkup\}[\s\S]*?data-venue-follow[\s\S]*?data-share-venue/,
  );
  assert.match(venueSwipeRenderer, /<h3 class="club-brand-name">\$\{safeName\}<\/h3>/);
  assert.doesNotMatch(venueSwipeRenderer, /activeDealCount|dealIndicatorMarkup|home-venue-discovery-deal-indicator/);
  assert.match(
    venueSwipeRenderer,
    /club-card-entry[\s\S]*?aria-label="\$\{safeName\} primary actions"[\s\S]*?\$\{railQrMarkup\}/,
  );
  assert.doesNotMatch(venueSwipeRenderer, /rideMarkup/);
  assert.match(venueSwipeRenderer, /venue-card-page-action[^>]*data-open-venue-profile="\$\{venueValue\}"/);
  assert.match(venueSwipeRenderer, /<a class="club-brand-visual venue-card-link"[^>]*data-open-venue-profile=/);
  assert.doesNotMatch(venueSwipeRenderer, /const qrMarkup|home-venue-discovery-club-deal|Mydancr venue/);
  assert.match(
    venueSwipeRenderer,
    /venueLineupMarkup\(venue, city, \{ mobile: true, profiles: workingNow, eager: index < 2 \}\)[\s\S]*?const workingLabel = `\$\{workingNow\.length\} working now`[\s\S]*?accessibilityLabel = workingNow\.length/,
  );
  assert.doesNotMatch(venueSwipeRenderer, /home-discovery-feed-status is-now|workingNowMarkup/);
  assert.match(venueSwipeRenderer, /const directionsMarkup[\s\S]*?venue-directions-btn/);
  assert.match(
    homeSource,
    /function homeVenueDiscoveryQrMarkup\(venue\)[\s\S]*?data-club-deal-cta[\s\S]*?freeEntryButtonLabel\(\)[\s\S]*?data-card-qr-label="Free entry unavailable"/,
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
    /venueOperatingStatus\(details\.hours, city\)[\s\S]*?operatingStatus\.hoursLabel[\s\S]*?aria-label="Opening hours"[\s\S]*?\$\{escapeHtml\(operatingStatus\.hoursLabel\)\}[\s\S]*?\$\{operatingStatusMarkup\}\$\{hoursMarkup\}/,
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

function venueCardSurfaceFixture({ interactive = "", selectedText = false, hasCard = true, hasControl = true, disabled = false, ariaDisabled = false } = {}) {
  const source = homeSource.match(/    function handleVenueCardSurfaceClick\(event\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(source);
  const forwarded = [];
  const control = {
    disabled,
    getAttribute: () => ariaDisabled ? "true" : null,
    dispatchEvent: (event) => forwarded.push(event),
  };
  const card = {
    contains: () => true,
    querySelector: (selector) => {
      assert.equal(selector, "[data-open-venue-profile]");
      return hasControl ? control : null;
    },
  };
  const target = {
    closest: (selector) => {
      if (selector === ".home-venue-discovery-slide, .venue-card") return hasCard ? card : null;
      return interactive && selector.split(", ").includes(interactive) ? {} : null;
    },
  };
  const handle = vm.runInNewContext(source + "\nhandleVenueCardSurfaceClick", {
    window: { getSelection: () => ({ isCollapsed: !selectedText, anchorNode: target }) },
    MouseEvent: class {
      constructor(type, options) { this.type = type; Object.assign(this, options); }
    },
  });
  const event = { target, button: 0, detail: 1, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  return { handle, event, forwarded };
}

test("clicking a venue card surface forwards one click to its existing club profile link", () => {
  const { handle, event, forwarded } = venueCardSurfaceFixture();
  assert.equal(handle(event), true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].type, "click");
  assert.equal(forwarded[0].bubbles, true, "reuse delegated navigation and capture-phase analytics");
  assert.equal(forwarded[0].cancelable, true);
  assert.equal(forwarded[0].detail, 1, "pointer taps must not acquire keyboard-only focus treatment");
  assert.match(homeSource, /results\.addEventListener\("click", async \(event\) => \{[\s\S]*?if \(handleVenueCardSurfaceClick\(event\)\) return;/);
});

test("card surface navigation leaves nested actions and notices alone", () => {
  for (const interactive of ['a', 'button', 'input', 'select', 'textarea', 'label', 'summary', '[role="button"]', '[role="link"]', '[contenteditable]', '.home-card-qr-notice']) {
    const { handle, event, forwarded } = venueCardSurfaceFixture({ interactive });
    assert.equal(handle(event), false, interactive);
    assert.equal(event.defaultPrevented, false, interactive);
    assert.equal(forwarded.length, 0, interactive);
  }
});

test("card surface navigation ignores text selection, missing actions and disabled controls", () => {
  for (const options of [{ selectedText: true }, { hasCard: false }, { hasControl: false }, { disabled: true }, { ariaDisabled: true }]) {
    const { handle, event, forwarded } = venueCardSurfaceFixture(options);
    assert.equal(handle(event), false, JSON.stringify(options));
    assert.equal(event.defaultPrevented, false);
    assert.equal(forwarded.length, 0);
  }
});

test("card surface navigation ignores cancelled, modified and non-primary clicks", () => {
  for (const overrides of [{ defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) {
    const { handle, event, forwarded } = venueCardSurfaceFixture();
    Object.assign(event, overrides);
    assert.equal(handle(event), false, JSON.stringify(overrides));
    assert.equal(forwarded.length, 0);
  }
});
