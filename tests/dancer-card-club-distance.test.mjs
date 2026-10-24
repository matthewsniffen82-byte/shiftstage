import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const source = ["03-submit-password-recovery-form", "05-real-dancer-dashboard-metrics", "06-rank-label", "11-post-verified-shift", "12-sync-profile-photo-viewer-window", "19-reset-home-discovery-feed-qr-prompt", "21-deactivate-home-tv-feed"]
  .map(file => read(`src/live-shell/app/${file}.js`)).join("\n");
const venue = { id: "rhino", slug: "rhino", name: "Spearmint Rhino", latitude: 0, longitude: 0.04632 };
const profile = { id: "star", slug: "star", name: "Star", city: "Las Vegas", venueId: venue.id, venue: venue.name, workingNow: true, distance: "99 mi", distanceMiles: 99 };

function fixture({ location = { latitude: 0, longitude: 0 }, club = venue } = {}) {
  const context = vm.createContext({
    window: {}, userLocation: location, ALL_CITIES: "All cities", stateByCity: { "Las Vegas": "NV" },
    cityCoordinates: { "Las Vegas": { latitude: 0, longitude: 0.026 } },
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
  context.displayText = context.escapeHtml;
  for (const name of ["liveVenueCoordinate", "hasCoordinates", "distanceMilesBetween", "formatDistanceMiles", "visitorVenueDistanceLabel", "venueDistanceLabel", "venueDetails", "profileCardDistanceLabel", "profileVenueDestinationMarkup", "homeDancerGridQuickFollowMarkup", "homeDancerGridCard", "venueDancerGridMarkup"]) {
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

test("club cards, dancer cards and the opened profile use the same visitor-to-club distance", () => {
  const context = fixture({ club: { ...venue, distance: "1.4 mi", distanceMiles: 1.4 } });
  for (const [longitude, expected] of [[0, "3.2 mi"], [0.026, "1.4 mi"]]) {
    context.userLocation = { latitude: 0, longitude };
    assert.equal(context.venueDetails(venue, "Las Vegas").distanceLabel, expected);
    assert.equal(context.profileCardDistanceLabel(profile), expected);
    const grid = context.homeDancerGridCard(profile, "Las Vegas", true);
    const opened = context.profileVenueDestinationMarkup(profile, { live: true });
    assert.ok(grid.includes(`${expected} away`));
    assert.ok(opened.includes(`<span class="profile-venue-distance">${expected} away</span>`));
    assert.match(opened, /data-open-venue="rhino"/);
    assert.match(opened, /profile-venue-name">Spearmint Rhino<\/span><span class="profile-venue-distance">/);
  }
});

test("missing location never turns a city-center, demo or stored estimate into a visitor distance", () => {
  const context = fixture({ location: null });
  assert.equal(context.venueDistanceLabel({ ...venue, distanceMiles: 3.2, distance: "3.2 mi" }), "Distance unavailable");
  assert.equal(context.profileCardDistanceLabel(profile), "");
  assert.doesNotMatch(context.profileVenueDestinationMarkup(profile, { live: true }), /profile-venue-distance|mi away/);
});

test("editor previews and inactive club destinations do not show visitor distance", () => {
  const context = fixture();
  for (const options of [{ live: true, preview: true }, { upcoming: true }, {}]) {
    assert.doesNotMatch(context.profileVenueDestinationMarkup(profile, options), /profile-venue-distance|mi away/);
  }
});

test("every distance display keeps club identity even when names collide", () => {
  const context = fixture();
  const wrongClub = { ...venue, id: "other-club", slug: "other-club", longitude: 0.02 };
  context.discoveryMarket = () => ({ venues: [wrongClub, venue] });
  assert.equal(context.profileCardDistanceLabel(profile), "3.2 mi");
  assert.equal(context.profileCardDistanceLabel({ ...profile, venueId: "", venueSlug: venue.slug }), "3.2 mi");
});

function tvFixture(options) {
  const context = fixture(options);
  const element = tagName => ({
    tagName, children: [], attributes: {}, dataset: {}, style: {}, hidden: false,
    classList: { add() {}, remove() {} },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.append(child); },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    hasAttribute(key) { return key in this.attributes || (key === "href" && Boolean(this.href)); },
    addEventListener() {},
    querySelector(selector) {
      for (const child of this.children) {
        if (child.className?.split(" ").includes(selector.slice(1))) return child;
        const nested = child.querySelector(selector);
        if (nested) return nested;
      }
      return null;
    },
  });
  Object.assign(context, {
    document: { createElement: element, getElementById: () => null },
    citySelect: { value: "Las Vegas" }, avatarPhotoPosition: () => "50% 50%",
    venueExperienceHref: club => `/?venue=${club.slug}`,
    createHomeTvFeedDealButton: () => element("button"),
  });
  for (const name of ["createHomeTvFeedCopy", "syncHomeTvFeedVenueDistance", "syncHomeTvFeedDistances", "renderHomeTvFeed"]) {
    vm.runInContext(source.match(new RegExp(`    function ${name}\\([^]*?\\n    \\}`))[0], context);
  }
  const item = { id: "video", dancer: { stageName: "Star", slug: "star", city: "Las Vegas" },
    shift: { isActive: true }, venue: { id: venue.id, slug: venue.slug, name: venue.name, city: "Las Vegas" } };
  return { context, item, render: (video = item) => context.createHomeTvFeedCopy(video, { className: "is-now" }) };
}

test("TV puts the matching club distance below its name inside the link beside Free Entry", () => {
  const { context, item, render } = tvFixture();
  const copy = render();
  const link = copy.querySelector(".home-tv-feed-venue");
  const venueCopy = link.querySelector(".home-tv-feed-venue-copy");
  assert.deepEqual(venueCopy.children.map(child => child.textContent), [venue.name, `${context.profileCardDistanceLabel(profile)} away`]);
  assert.equal(venueCopy.children[1].hidden, false);
  assert.equal(link.href, `/?venue=${item.venue.slug}`);
  assert.equal(link.attributes["aria-label"], `Open ${venue.name} club profile, 3.2 mi away`);
  assert.equal(copy.querySelector(".home-tv-feed-club-row").children[1].tagName, "button");
});

test("TV hides unknown distances and does not attach a club distance to inactive dancers", () => {
  for (const options of [{ location: null }, { club: { ...venue, latitude: null, distance: "99 mi" } }]) {
    const { render } = tvFixture(options);
    const distance = render().querySelector(".home-tv-feed-venue-distance");
    assert.equal(distance.hidden, true);
    assert.equal(distance.textContent, "");
  }
  const { item, render } = tvFixture();
  assert.equal(render({ ...item, shift: { isActive: false } }).querySelector(".home-tv-feed-venue-distance"), null);
});

test("TV uses the active club's city and ID even when a dancer is visiting from another city", () => {
  const { context, item, render } = tvFixture();
  context.discoveryMarket = city => ({ venues: city === "Las Vegas" ? [{ ...venue, id: "other", longitude: 0.02 }, venue] : [] });
  const copy = render({ ...item, dancer: { ...item.dancer, city: "Miami" } });
  assert.equal(copy.querySelector(".home-tv-feed-venue-distance").textContent, "3.2 mi away");
});

test("cached TV cards update distance when location changes without replacing the playing video", () => {
  const { context, item, render } = tvFixture({ location: null });
  const copy = render();
  const video = { currentTime: 12, paused: false };
  const slide = { dataset: { videoId: item.id }, video, querySelector: selector => copy.querySelector(selector) };
  Object.assign(context, {
    homeTvFeedVideos: [item], homeTvFeedCity: "Las Vegas", homeTvFeedVenueId: "", homeTvFeedSelectedVideoId: "", homeTvFeedStatus: "ready",
    tabTitle: { classList: { remove() {} }, closest: () => null }, viewAllBtn: {},
    syncHomeTvPageSnapState() {}, selectedHomeTvVenueFilter: () => null, selectedHomeTvVideoId: () => "",
    discoveryLocationPhrase: city => city, setHomeTvFeedCount() {}, settleHomeTvFeedLanding() {},
    results: { dataset: { homeTvFeedKey: "Las Vegas::video" }, classList: { add() {}, remove() {} },
      setAttribute() {}, removeAttribute() {}, querySelectorAll: () => [slide],
      replaceChildren() { assert.fail("Updating distance must preserve the playing video"); },
    },
  });
  const distance = copy.querySelector(".home-tv-feed-venue-distance");
  for (const [location, expected] of [[{ latitude: 0, longitude: 0 }, "3.2 mi away"], [{ latitude: 0, longitude: 0.026 }, "1.4 mi away"], [null, ""]]) {
    context.userLocation = location;
    context.renderHomeTvFeed("Las Vegas");
    assert.equal(distance.textContent, expected);
    assert.equal(distance.hidden, !expected);
    assert.equal(slide.video, video);
    assert.equal(video.currentTime, 12);
    assert.equal(video.paused, false);
  }
});
