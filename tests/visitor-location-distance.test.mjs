import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = ["05-real-dancer-dashboard-metrics", "06-rank-label"].map(file =>
  readFileSync(new URL(`../src/live-shell/app/${file}.js`, import.meta.url), "utf8")).join("\n");
const citySource = readFileSync(new URL("../src/live-shell/app/26-sync-discovery-city-scope.js", import.meta.url), "utf8");
const coords = { latitude: 0, longitude: 0, accuracy: 20 };
const venue = { latitude: 0, longitude: 0.04632 };

function fixture(permission = "granted") {
  const requests = [];
  const elements = Object.fromEntries(["homeDistanceNotice", "homeDistanceMessage", "homeDistanceLocationBtn"].map(id => [id, {
    hidden: false, disabled: false, textContent: "", attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
  }]));
  let renders = 0;
  const context = vm.createContext({
    navigator: {
      permissions: { query: async descriptor => { assert.equal(descriptor.name, "geolocation"); return { state: permission }; } },
      geolocation: { getCurrentPosition(success, error, options) { requests.push({ success, error, options }); } },
    },
    document: { getElementById: id => elements[id] },
    profileModal: null, internalProfileFrameId: "",
    visitorLocation: null, visitorLocationPending: null, visitorLocationError: "", userLocation: null,
    citySelect: { value: "Las Vegas" }, render() { renders++; },
  });
  for (const name of ["liveVenueCoordinate", "hasCoordinates", "distanceMilesBetween", "formatDistanceMiles", "visitorVenueDistanceLabel", "requestVenuePosition", "syncVisitorLocationNotice", "refreshVisitorDistanceViews", "requestVisitorLocation", "restoreVisitorLocation"]) {
    const code = source.match(new RegExp(`    (?:async )?function ${name}\\([^]*?\\n    \\}`))?.[0];
    assert.ok(code, name);
    vm.runInContext(code, context);
  }
  return { context, requests, elements, renders: () => renders };
}

test("each page load restores the visitor position with existing permission and leaves the selected city alone", async () => {
  for (let reload = 0; reload < 2; reload++) {
    const f = fixture();
    const pending = f.context.restoreVisitorLocation();
    await new Promise(setImmediate);
    assert.equal(f.requests.length, 1);
    assert.equal(f.elements.homeDistanceLocationBtn.disabled, true);
    f.requests[0].success({ coords });
    await pending;
    assert.equal(f.context.visitorVenueDistanceLabel(venue), "3.2 mi");
    assert.equal(f.elements.homeDistanceNotice.hidden, true);
    assert.equal(f.context.citySelect.value, "Las Vegas");
    assert.equal(f.context.userLocation, null, "distance restoration does not change the radius filter origin");
    assert.equal(f.renders(), 1);
  }
});

test("first-time visitors are not prompted until a location action and denial keeps browsing available", async () => {
  const f = fixture("prompt");
  await f.context.restoreVisitorLocation();
  await f.context.restoreVisitorLocation();
  assert.equal(f.requests.length, 0);
  assert.equal(f.context.visitorLocationError, "");
  const pending = f.context.requestVisitorLocation();
  assert.equal(f.requests.length, 1);
  f.requests[0].error({ code: 1 });
  await pending;
  assert.equal(f.context.visitorVenueDistanceLabel(venue), "");
  assert.equal(f.elements.homeDistanceNotice.hidden, false);
  assert.match(f.elements.homeDistanceMessage.textContent, /browser settings/);
  assert.match(f.elements.homeDistanceMessage.textContent, /choose a city manually/);
  assert.equal(f.elements.homeDistanceLocationBtn.disabled, false);
  assert.equal(f.renders(), 0);
});

test("already denied permissions do not automatically ask again or nag on reload", async () => {
  const f = fixture("denied");
  await f.context.restoreVisitorLocation();
  await f.context.restoreVisitorLocation();
  assert.equal(f.requests.length, 0);
  assert.equal(f.context.visitorLocationError, "");
  assert.equal(f.elements.homeDistanceNotice.hidden, false);
  assert.equal(f.context.visitorVenueDistanceLabel(venue), "");
});

test("browsers without permission-query support wait for a location action", async () => {
  for (const permissions of [undefined, { query: async () => { throw new Error("Unsupported"); } }]) {
    const f = fixture();
    f.context.navigator.permissions = permissions;
    await f.context.restoreVisitorLocation();
    assert.equal(f.requests.length, 0);
    const pending = f.context.requestVisitorLocation();
    assert.equal(f.requests.length, 1);
    f.requests[0].success({ coords });
    await pending;
    assert.equal(f.context.visitorVenueDistanceLabel(venue), "3.2 mi");
  }
});

test("unknown permission states never fall through to a startup prompt", async () => {
  for (const state of [undefined, "unknown"]) {
    const f = fixture(state);
    f.context.navigator.permissions.query = async () => ({ state });
    await f.context.restoreVisitorLocation();
    assert.equal(f.requests.length, 0);
  }
});

function cityLocationFixture() {
  const f = fixture("prompt");
  let click;
  const label = { textContent: "Use current location" };
  f.elements.locationBtn = {
    disabled: false, attributes: {},
    querySelector() { return label; },
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(event, handler) { assert.equal(event, "click"); click = handler; },
  };
  f.context.citySelect.options = [{ value: "Las Vegas" }, { value: "Miami" }];
  f.context.citySelect.dispatchEvent = event => { f.changed = event.type; };
  f.closed = false;
  Object.assign(f.context, {
    userLocationOutsideMarkets: false,
    venueSelect: { value: "all" },
    MAX_LOCATION_MARKET_DISTANCE_MILES: 50,
    nearestCityForCoordinates: () => ({ city: "Miami", miles: 3 }),
    closeCityPicker() { f.closed = true; },
    syncCityPickerSelection() {},
    showToast(message) { f.toast = message; },
    loadLiveDiscovery(city) { f.loadedCity = city; },
    customerDashboard: { classList: { contains: () => false } },
    Event: class { constructor(type) { this.type = type; } },
  });
  const start = citySource.indexOf('    document.getElementById("locationBtn").addEventListener');
  const end = citySource.indexOf("    function installReferenceHomeShell()", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(citySource.slice(start, end), f.context);
  vm.runInContext(citySource.match(/    function applyCityPickerSelection\([^]*?\n    \}/)[0], f.context);
  return { ...f, state: f, click: () => click(), label };
}

test("Android and iPhone location taps request immediately, select the nearby city, and restore the control", async () => {
  for (const userAgent of ["Android Chrome", "Android SamsungBrowser", "iPhone Safari"]) {
    const f = cityLocationFixture();
    f.context.navigator.userAgent = userAgent;
    if (userAgent.includes("Safari")) f.context.navigator.permissions = undefined;
    await f.context.restoreVisitorLocation();
    assert.equal(f.requests.length, 0);
    const pending = f.click();
    assert.equal(f.requests.length, 1, "Request starts inside the click, without awaiting a permission query");
    assert.equal(f.elements.locationBtn.disabled, true);
    assert.equal(f.elements.locationBtn.attributes["aria-busy"], "true");
    await f.click();
    assert.equal(f.requests.length, 1, "Ignore another tap while waiting");
    f.requests[0].success({ coords });
    await pending;
    assert.equal(f.context.citySelect.value, "Miami");
    assert.equal(f.state.loadedCity, "Miami");
    assert.equal(f.context.visitorVenueDistanceLabel(venue), "3.2 mi");
    assert.equal(f.state.closed, true);
    assert.equal(f.elements.locationBtn.disabled, false);
    assert.equal(f.elements.locationBtn.attributes["aria-busy"], undefined);
    assert.equal(f.label.textContent, "Use current location");
  }
});

test("declining a location tap leaves the city list usable for manual selection", async () => {
  const f = cityLocationFixture();
  const pending = f.click();
  f.requests[0].error({ code: 1 });
  await pending;
  assert.equal(f.state.closed, false);
  assert.equal(f.context.citySelect.value, "Las Vegas");
  assert.equal(f.context.userLocation, null);
  assert.equal(f.elements.locationBtn.disabled, false);
  assert.match(f.state.toast, /choose a city manually/);
  f.context.applyCityPickerSelection("Miami");
  assert.equal(f.context.citySelect.value, "Miami");
  assert.equal(f.state.changed, "change");
  assert.equal(f.requests.length, 1, "Manual selection never requests location");
});

test("repeat clicks share one location request and a timeout can be retried", async () => {
  const f = fixture();
  const pending = f.context.requestVisitorLocation();
  assert.equal(f.context.requestVisitorLocation(), pending);
  assert.equal(f.requests.length, 1);
  f.requests[0].error({ code: 3 });
  await pending;
  assert.match(f.elements.homeDistanceMessage.textContent, /timed out/);
  const retry = f.context.requestVisitorLocation();
  f.requests[1].success({ coords });
  await retry;
  assert.equal(f.elements.homeDistanceNotice.hidden, true);
  assert.equal(f.context.visitorLocationError, "");
});

test("city filter changes retain the real visitor origin for distance labels", async () => {
  const f = fixture();
  const pending = f.context.requestVisitorLocation();
  f.requests[0].success({ coords });
  await pending;
  f.context.citySelect.value = "Miami";
  f.context.userLocation = null;
  assert.equal(f.context.visitorVenueDistanceLabel(venue), "3.2 mi");
});

test("location arriving after a profile opens updates its distance without rebuilding its media", async () => {
  const f = fixture();
  const children = [];
  const copy = {
    querySelector() { return children[0] || null; },
    appendChild(node) { children.push(node); },
  };
  const profile = { id: "dancer-1", venue };
  f.context.profileModal = {
    dataset: { publicDancerId: profile.id },
    querySelector(selector) {
      assert.equal(selector, ".profile-venue-destination.is-live .profile-venue-copy");
      return copy;
    },
  };
  f.context.findProfile = id => { assert.equal(id, profile.id); return profile; };
  f.context.profileCardDistanceLabel = value => f.context.visitorVenueDistanceLabel(value.venue);
  f.context.document.createElement = tag => {
    assert.equal(tag, "span");
    return { remove() { children.splice(children.indexOf(this), 1); } };
  };
  const pending = f.context.requestVisitorLocation();
  f.requests[0].success({ coords });
  await pending;
  assert.equal(children.length, 1);
  assert.equal(children[0].className, "profile-venue-distance");
  assert.equal(children[0].textContent, "3.2 mi away");
  const distance = children[0];
  f.context.refreshVisitorDistanceViews();
  assert.equal(children.length, 1);
  assert.equal(children[0], distance);
  profile.venue = {};
  f.context.refreshVisitorDistanceViews();
  assert.equal(children.length, 0, "an unavailable distance cannot leave a stale label");
});

test("invalid or unavailable device coordinates never produce a guessed distance", async () => {
  for (const result of [null, { latitude: null, longitude: 0 }, { latitude: 91, longitude: 0 }]) {
    const f = fixture();
    const pending = f.context.requestVisitorLocation();
    f.requests[0].success({ coords: result || {} });
    await pending;
    assert.equal(f.context.visitorVenueDistanceLabel(venue), "");
    assert.equal(f.elements.homeDistanceNotice.hidden, false);
    assert.equal(f.elements.homeDistanceLocationBtn.disabled, false);
  }
});

test("embedded profiles do not start their own geolocation request", async () => {
  const f = fixture();
  f.context.internalProfileFrameId = "embedded-profile";
  await f.context.restoreVisitorLocation();
  assert.equal(f.requests.length, 0);
});
