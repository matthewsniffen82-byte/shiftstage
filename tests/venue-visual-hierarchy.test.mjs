import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [liveApp, aesthetic] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("venue operating status uses posted hours in the selected city timezone", () => {
  const clockParserSource = liveApp.match(
    /function parseClockMinutes\(value\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const operatingStatus = liveApp.match(
    /function venueOperatingStatus\(hours, city = selectedCity\(\), now = new Date\(\)\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.ok(clockParserSource, "the shared clock parser must exist");
  const parseClock = new Function(`${clockParserSource}; return parseClockMinutes;`)();
  assert.equal(parseClock("8:00p"), 20 * 60, "production compact PM hours must be recognized");
  assert.equal(parseClock("4:00a"), 4 * 60, "production compact AM hours must be recognized");
  assert.equal(parseClock("8:00 PM"), 20 * 60, "full PM hours must remain supported");
  assert.ok(operatingStatus, "the shared venue operating-status helper must exist");
  assert.match(operatingStatus, /parseClockMinutes\(parts\[0\]\)/);
  assert.match(operatingStatus, /cityWallClock\(now, city\)/);
  assert.match(operatingStatus, /if \(end <= start\) \{[\s\S]*?end \+= 1440/);
  assert.match(operatingStatus, /state: isOpen \? "open" : "closed"/);
  assert.match(operatingStatus, /label: isOpen \? "Open now" : "Closed"/);
  assert.match(operatingStatus, /hoursLabel\s*\n\s*\}/);
  assert.doesNotMatch(operatingStatus, /Hours ·/);
  assert.match(operatingStatus, /state: "unknown"[\s\S]*?label: "Hours unavailable"/);
});

test("private venue previews preserve saved opening and closing times", () => {
  const previewTimeSource = liveApp.match(
    /function venueDashboardPreviewTime\(value\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const previewHoursSource = liveApp.match(
    /function venueDashboardPreviewHours\(profile\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.ok(previewTimeSource, "the preview time normalizer must exist");
  assert.ok(previewHoursSource, "the preview hours formatter must exist");
  const previewHours = new Function(
    `${previewTimeSource}; ${previewHoursSource}; return venueDashboardPreviewHours;`,
  )();
  assert.equal(
    previewHours({ opensAt: "20:00:00", closesAt: "06:00:00" }),
    "8:00 PM - 6:00 AM",
  );
  assert.equal(
    previewHours({ opensAt: "8:00 PM", closesAt: "6:00 AM" }),
    "8:00 PM - 6:00 AM",
  );
  assert.equal(
    previewHours({ opens_at: "20:00:00", closes_at: "06:00:00" }),
    "8:00 PM - 6:00 AM",
  );
});

test("venue cards and venue detail render the same semantic operating state", () => {
  const venueDetail = liveApp.match(
    /function venueDetailPage\(venue\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";
  const venueSlide = liveApp.match(
    /function homeVenueDiscoveryFeedSlide\(venue, index, total, city\) \{[\s\S]*?\n    \}/,
  )?.[0] || "";

  assert.match(venueDetail, /venueOperatingStatus\(details\.hours, city\)/);
  assert.match(venueDetail, /operatingSummaryLabel[\s\S]*?venue-operating-summary[\s\S]*?venue-operating-status is-\$\{operatingStatus\.state\}/);
  assert.match(venueDetail, /class="venue-status-grid"/);
  assert.match(venueDetail, /venue-status-pill[\s\S]*?operatingStatus\.hoursLabel/);
  assert.match(venueSlide, /venueOperatingStatus\(details\.hours, city\)/);
  assert.match(venueSlide, /<span>Hours · \$\{escapeHtml\(operatingStatus\.hoursLabel\)\}<\/span>/);
  assert.match(venueSlide, /home-venue-discovery-operating-status is-\$\{operatingStatus\.state\}/);
  assert.match(venueSlide, /home-venue-discovery-meta">\$\{operatingStatusMarkup\}\$\{hoursMarkup\}/);
  assert.match(venueSlide, /aria-label="\$\{accessibilityLabel\}"/);
  assert.doesNotMatch(venueSlide, /home-venue-discovery-name-row|home-venue-discovery-name/);
  assert.doesNotMatch(venueSlide, /workingNowMarkup|home-discovery-feed-status is-now/);
});

test("venue hierarchy emphasizes identity and active deals without touching navigation", () => {
  const refinements = aesthetic.match(
    /Venue identity and operational hierarchy refinements[\s\S]*$/,
  )?.[0] || "";

  assert.ok(refinements, "the focused venue hierarchy layer must exist");
  assert.match(refinements, /\.home-venue-discovery-monogram \{[\s\S]*?width: 124px !important;[\s\S]*?height: 124px !important;/);
  assert.match(refinements, /\.venue-main-photo \{[\s\S]*?min-height: clamp\(264px, 58vw, 330px\) !important;/);
  assert.match(refinements, /\.venue-operating-status\.is-open \{[\s\S]*?var\(--dancr-color-success\)/);
  assert.match(refinements, /\.venue-status-pill \{[\s\S]*?var\(--dancr-color-info\)/);
  assert.match(refinements, /\.venue-operating-status:is\(\.is-closed, \.is-unknown\) \{[\s\S]*?var\(--dancr-color-text-muted\)/);
  assert.match(refinements, /\.venue-address-copy \.meta \{[\s\S]*?-webkit-line-clamp: 2;/);
  assert.match(refinements, /\.venue-offer-card\.revenue-offer-card \{[\s\S]*?var\(--dancr-color-success\) 9%/);
  assert.match(refinements, /\.feed-card-action:not\(\.is-active\):not\(\[aria-pressed="true"\]\):not\(\.home-venue-discovery-rail-qr\.is-available\):not\(\.home-venue-discovery-profile-action\) \{[\s\S]*?opacity: 0\.76;/);
  assert.match(refinements, /\.venue-identity-copy \{[\s\S]*?padding-left: 0;/);
  assert.doesNotMatch(refinements, /\.venue-identity-copy::before/);
  assert.doesNotMatch(refinements, /home-bottom|home-nav-|global-mobile-bottom-nav|discoveryTabs/);
});

test("mobile venue cards give the club identity header a restrained violet signature", () => {
  const mobileCards = aesthetic.match(
    /Clubs card presentation repair[\s\S]*?(?=\/\* Clubs feed action hierarchy\.)/,
  )?.[0] || "";

  assert.ok(mobileCards, "the mobile venue-card presentation layer must exist");
  assert.match(mobileCards, /club identity stage carries a restrained violet signature/);
  assert.match(mobileCards, /border-bottom: 1px solid var\(--dancr-color-brand-primary-medium\)/);
  assert.match(mobileCards, /var\(--dancr-color-beam-violet-soft\)/);
  assert.match(mobileCards, /linear-gradient\(145deg, #151020 0%, #090a0f 64%, #100c18 100%\)/);
  assert.match(mobileCards, /drop-shadow\(0 0 14px var\(--dancr-color-brand-primary-medium\)\)/);
  assert.doesNotMatch(mobileCards, /border: [^;]*var\(--dancr-color-brand-primary/);
});
