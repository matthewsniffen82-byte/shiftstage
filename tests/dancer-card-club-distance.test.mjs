import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const source = ["03-submit-password-recovery-form", "05-real-dancer-dashboard-metrics", "06-rank-label", "11-post-verified-shift", "19-reset-home-discovery-feed-qr-prompt"]
  .map(file => read(`src/live-shell/app/${file}.js`)).join("\n");
const venue = { id: "rhino", slug: "rhino", name: "Spearmint Rhino", latitude: 0, longitude: 0.04632 };
const profile = { id: "star", slug: "star", name: "Star", city: "Las Vegas", venueId: venue.id, venue: venue.name, workingNow: true, distance: "99 mi", distanceMiles: 99 };

function fixture({ location = { latitude: 0, longitude: 0 }, club = venue } = {}) {
  const context = vm.createContext({
    window: {}, userLocation: location, ALL_CITIES: "All cities",
    selectedCity: () => "Las Vegas", discoveryMarket: () => ({ venues: [club] }),
    profileDiscoveryCity: (item, city) => item.city || city,
    profileReferenceValue: item => item.id, discoveryCardAttributes: () => "",
    publicProfilePhotoUrl: () => "", publicProfilePhotoSrcSet: () => "",
    customPhotoAttrs: () => ({}), nativeResponsivePhotoAttrs: () => "",
    isWorkingTonight: item => item.workingNow,
    homeDiscoveryFeedStatus: item => ({ className: item.workingNow ? "is-now" : "is-open" }),
    homeDancerGridScheduleLabel: item => item.workingNow ? "Working now" : "Not working now",
    venueIconMarkup: () => '<span class="venue-dot"></span>',
    isFollowingProfile: () => false, actionIconMarkup: () => "",
  });
  vm.runInContext(read("public/dancer-grid-card.js"), context);
  context.escapeHtml = context.window.MydancrDancerGrid.escape;
  context.escapeOptionValue = context.escapeHtml;
  for (const name of ["liveVenueCoordinate", "hasCoordinates", "distanceMilesBetween", "formatDistanceMiles", "profileCardDistanceLabel", "homeDancerGridQuickFollowMarkup", "homeDancerGridCard", "venueDancerGridMarkup"]) {
    const match = source.match(new RegExp(`    function ${name}\\([^]*?\\n    \\}`));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  return context;
}

test("Working Now cards put the club's measured distance beneath its complete name", () => {
  const context = fixture();
  const markup = context.homeDancerGridCard(profile, "Las Vegas", true);
  assert.match(markup, /Spearmint Rhino<\/span><\/span><span class="home-dancer-grid-distance">3\.2 mi away<\/span>/);
  assert.doesNotMatch(markup, /99 mi/);
  context.userLocation = { latitude: 0, longitude: 0.03 };
  assert.match(context.homeDancerGridCard(profile, "Las Vegas", true), /1\.1 mi away/);
});

test("unknown visitor or club coordinates hide distance instead of showing fallback estimates", () => {
  for (const options of [
    { location: null }, { location: { latitude: null, longitude: 0 } },
    { club: { ...venue, latitude: null, distance: "99 mi", distanceMiles: 99 } },
    { club: { ...venue, longitude: 181 } }, { club: { ...venue, id: "different-club" } },
  ]) {
    const context = fixture(options);
    assert.doesNotMatch(context.homeDancerGridCard(profile, "Las Vegas", true), /home-dancer-grid-distance|mi away/);
  }
});

test("zero distance is retained and club identity is matched by id", () => {
  const context = fixture({ location: { latitude: 0, longitude: venue.longitude }, club: { ...venue, name: "Renamed club" } });
  assert.match(context.homeDancerGridCard(profile, "Las Vegas", true), /less than 0\.1 mi away/);
});

test("offline and pending-club cards do not show a club distance", () => {
  const context = fixture();
  for (const item of [{ ...profile, workingNow: false }, { ...profile, venue: "Venue pending" }, { ...profile, venue: "" }]) {
    assert.doesNotMatch(context.homeDancerGridCard(item, "Las Vegas", true), /home-dancer-grid-distance/);
  }
});

test("a club's own roster omits repeated distances from every dancer card", () => {
  const context = fixture();
  const markup = context.venueDancerGridMarkup([profile, { ...profile, id: "other", name: "Reese" }], "Las Vegas", "Working now");
  assert.match(markup, /Spearmint Rhino/);
  assert.doesNotMatch(markup, /home-dancer-grid-distance|mi away/);
});
