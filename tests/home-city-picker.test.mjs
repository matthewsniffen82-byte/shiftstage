import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";

const [liveShell, aesthetic] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8"),
]);

test("city discovery keeps the native select as a fallback and enhances it with an inline picker", () => {
  assert.match(liveShell, /<select id="citySelect">[\s\S]*?<option>Las Vegas<\/option>[\s\S]*?<option>New York<\/option>[\s\S]*?<\/select>/);
  assert.match(liveShell, /id="cityPickerField"[\s\S]*?id="citySelectButton"[\s\S]*?aria-controls="citySelectPanel"/);
  assert.match(liveShell, /id="citySelectPanel" hidden>[\s\S]*?id="citySelectOptions"[^>]*role="listbox"[^>]*aria-labelledby="citySelectLabel"/);
  assert.doesNotMatch(liveShell, /id="citySelectDialog"|id="citySelectDone"|id="citySelectClose"/);
  assert.match(liveShell, /cityPickerField\.classList\.add\("is-enhanced"\)[\s\S]*?citySelect\.setAttribute\("aria-hidden", "true"\)[\s\S]*?citySelectButton\.hidden = false/);
  assert.match(aesthetic, /\.home-city-filter\.is-enhanced #citySelect[\s\S]*?clip-path: inset\(50%\)/);
});

test("current location remains visible beneath Distance and Club when filters are open", async () => {
  const filters = liveShell.slice(liveShell.indexOf('id="homeAdvancedFilters"'), liveShell.indexOf('id="citySelectPanel" hidden'));
  assert.match(filters, /id="distancePickerField"[^]*?id="venuePickerField"[^]*?class="home-filter-actions">\s*<button class="location-btn" id="locationBtn" type="button" aria-describedby="homeDistanceMessage">[^]*?>Use current location<\/span>\s*<\/button>\s*<button[^>]*id="homeFilterReset"[^>]*hidden/);
  assert.match(liveShell, /id="citySelectPanel" hidden>\s*<div[^>]*id="citySelectOptions"[^>]*role="listbox"/);
  assert.equal((liveShell.match(/id="locationBtn"/g) || []).length, 1);
  assert.match(liveShell, /citySelectPanel\?\.addEventListener\("keydown", \(event\) => \{\s*if \(event.key === "Escape"\) \{\s*event.preventDefault\(\);\s*closeCityPicker\(true\);/);
  const css = postcss.parse(await readFile(new URL("../public/dancr-ui-consistency.v1.css", import.meta.url), "utf8"));
  const prefix = "html body.dancr-button-system > .app main.stack > .home-discovery-controls ";
  const actions = {};
  css.walkRules(`${prefix}#homeAdvancedFilters .home-filter-actions`, rule => {
    Object.assign(actions, Object.fromEntries(rule.nodes.map(node => [node.prop, node.value])));
  });
  assert.equal(actions.display, "flex");
  assert.equal(actions["grid-column"], "1 / -1");
  css.walkRules(rule => {
    if (rule.selector.includes(".home-filter-actions")) {
      assert.ok(!rule.nodes.some(node => node.prop === "display" && node.value === "none"), "Hiding Reset must not hide the location button");
    }
  });
});

test("the summary has no enable-location prompt and keeps action feedback hidden until needed", () => {
  const summary = liveShell.match(/<div class="home-live-summary"[^]*?<\/div>/)?.[0];
  assert.ok(summary);
  assert.match(summary, /id="homeDistanceNotice" hidden>\s*<span id="homeDistanceMessage" role="status"><\/span>[^]*?id="homeDistanceDismiss"/);
  assert.doesNotMatch(liveShell, /homeDistanceLocationBtn|Enable location to see distances/);
  const css = postcss.parse(aesthetic);
  const declarations = selector => {
    let values;
    css.walkRules(selector, rule => { values = Object.fromEntries(rule.nodes.map(node => [node.prop, node.value])); });
    return values;
  };
  const text = declarations("body > .app main.stack > .home-live-summary #homeDistanceMessage");
  assert.equal(text["font-size"], "12px");
  assert.equal(text["white-space"], "normal");
  assert.equal(text["overflow-wrap"], "anywhere");
  const dismiss = declarations("html body.dancr-button-system #homeDistanceDismiss");
  assert.equal(dismiss.width, "44px");
  assert.equal(dismiss.height, "44px");
  assert.equal(dismiss.background, "transparent");
  assert.equal(declarations("html body.dancr-button-system #homeDistanceDismiss[hidden]").display, "none");
});

test("city selection expands inline, applies immediately, and remains keyboard accessible", () => {
  assert.match(liveShell, /function openCityPicker\(\)[\s\S]*?citySelectPanel\.hidden = false[\s\S]*?querySelector\('\[aria-selected="true"\]'\)\?\.focus\(\)/);
  assert.match(liveShell, /function applyCityPickerSelection\(nextCity\)[\s\S]*?const changed = userLocationOutsideMarkets \|\| citySelect\.value !== nextCity;[\s\S]*?citySelect\.value = nextCity[\s\S]*?closeCityPicker\(true\)[\s\S]*?citySelect\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
  assert.match(liveShell, /citySelectOptions\?\.addEventListener\("keydown"[\s\S]*?ArrowDown[\s\S]*?ArrowUp[\s\S]*?Home[\s\S]*?End/);
  assert.match(liveShell, /event\.key === "Escape"[\s\S]*?closeCityPicker\(true\)/);
  assert.match(liveShell, /homeFilterToggle\?\.setAttribute\("aria-expanded", "false"\)[\s\S]*?homeAdvancedFilters\?\.classList\.remove\("is-open"\)/);
});

test("city options show compact dynamic dancer and club counts without redundant selected copy", () => {
  assert.match(liveShell, /const cityDiscoveryStatsByName = new Map\(\)/);
  assert.match(liveShell, /Number\(city\.dancerCount\)[\s\S]*?Number\(city\.venueCount\)[\s\S]*?cityDiscoveryStatsByName\.set/);
  assert.match(liveShell, /stats\.dancers === 1 \? "dancer" : "dancers"/);
  assert.match(liveShell, /stats\.venues === 1 \? "club" : "clubs"/);
  assert.match(liveShell, /class="city-picker-stats"/);
  assert.doesNotMatch(liveShell, /city-picker-selected-label|selected \? "Selected"/);
  assert.match(aesthetic, /\.city-picker-stats \{[\s\S]*?text-align: right;[\s\S]*?white-space: nowrap;/);
});

test("mobile discovery uses compact neutral controls and an inline city panel", () => {
  assert.match(aesthetic, /\.city-picker-inline[\s\S]*?grid-column: 1 \/ -1[\s\S]*?\.city-picker-inline\[hidden\][\s\S]*?display: none !important/);
  assert.match(aesthetic, /\.city-picker-trigger\[aria-expanded="true"\][\s\S]*?var\(--dancr-color-brand-primary\)/);
  assert.match(aesthetic, /\.city-picker-trigger, \.home-filter-toggle[\s\S]*?min-height: 44px/);
  assert.match(aesthetic, /@media \(max-width: 640px\) \{[\s\S]*?\.city-picker-inline\.is-open \{[\s\S]*?padding: 8px !important;[\s\S]*?\.city-picker-options \{[\s\S]*?gap: 2px !important;/);
  assert.match(aesthetic, /@media \(max-width: 640px\) \{[\s\S]*?\.city-picker-option \{[\s\S]*?min-height: 40px !important;[\s\S]*?height: 40px !important;[\s\S]*?font-size: 15px !important;/);
  assert.match(aesthetic, /\.city-picker-option \.venue-picker-radio \{[\s\S]*?width: 20px !important;[\s\S]*?height: 20px !important;/);
  assert.match(aesthetic, /\.city-picker-option:not\(\[aria-selected="true"\]\) \.venue-picker-radio \{[\s\S]*?var\(--dancr-color-text-muted\) 56%/);
  assert.match(aesthetic, /\.dancer-directory-filter\.is-active[\s\S]*?var\(--dancr-color-brand-primary\) 10%[\s\S]*?box-shadow: inset/);
});

test("a remote visitor gets an honest near-me state instead of a distant supported city", () => {
  assert.match(liveShell, /const MAX_LOCATION_MARKET_DISTANCE_MILES = 50;/);
  assert.match(liveShell, /let userLocationOutsideMarkets = false;/);
  assert.match(
    liveShell,
    /function nearestCityForCoordinates\(coords\)[\s\S]*?\.sort\(\(a, b\) => a\.miles - b\.miles\)\[0\] \|\| null;/,
  );
  assert.match(
    liveShell,
    /const requestedLocation = await requestVenuePosition\(\);[\s\S]*?const nearestMarket = nearestCityForCoordinates\(requestedLocation\);[\s\S]*?nearestMarket\.miles > MAX_LOCATION_MARKET_DISTANCE_MILES[\s\S]*?userLocation = requestedLocation;[\s\S]*?userLocationOutsideMarkets = true;[\s\S]*?render\(\);[\s\S]*?No MyDancr city within \$\{MAX_LOCATION_MARKET_DISTANCE_MILES\} mi of you\.[\s\S]*?return;/,
  );
  assert.match(
    liveShell,
    /userLocationOutsideMarkets = false;[\s\S]*?citySelect\.value = nearestMarket\.city;[\s\S]*?closeCityPicker\(true\);[\s\S]*?\$\{nearestMarket\.city\} selected from your location\./,
  );
  assert.match(liveShell, /function discoveryLocationPhrase\(city = selectedCity\(\)\)[\s\S]*?userLocationOutsideMarkets \? "near you" : `in \$\{city\}`/);
  assert.match(liveShell, /const label = userLocationOutsideMarkets \? "Near me" : citySelect\.value/);
  assert.match(liveShell, /citySelectButtonText\.textContent !== label\) citySelectButtonText\.textContent = label/);
  assert.match(liveShell, /if \(userLocationOutsideMarkets && \["tonight", "dancers", "venues"\]\.includes\(tab\)\) return \[\];/);
  assert.match(liveShell, /No MyDancr clubs near you[\s\S]*?Choose another city to browse clubs\.[\s\S]*?Choose another city/);
  assert.match(liveShell, /citySelect\.addEventListener\("change"[\s\S]*?userLocationOutsideMarkets = false;[\s\S]*?userLocation = null;/);
  assert.doesNotMatch(liveShell, /showToast\("Location updated\."\)/);
});

test("mobile location feedback stays concise and clears the floating navigation", () => {
  assert.doesNotMatch(liveShell, /Location found\. Venue distances updated/);
  assert.match(
    liveShell,
    /@media \(max-width: 720px\) \{[\s\S]*?body \.toast \{[\s\S]*?z-index: 110;[\s\S]*?bottom: calc\(92px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?max-width: calc\(100% - 32px\);[\s\S]*?text-align: center;/,
  );
});

function pickerFixture() {
  const writes = { city: 0, label: 0, options: 0 };
  let value = "Las Vegas", text = "", markup = "";
  const citySelect = {
    options: ["All cities", "Las Vegas", "Miami"].map(value => ({ value })),
    get value() { return value; },
    set value(next) { writes.city += 1; value = next; },
  };
  const citySelectButtonText = {
    get textContent() { return text; },
    set textContent(next) { writes.label += 1; text = next; },
  };
  const citySelectOptions = {
    get innerHTML() { return markup; },
    set innerHTML(next) { writes.options += 1; markup = next; },
  };
  const context = vm.createContext({
    citySelect, citySelectButtonText, citySelectOptions, ALL_CITIES: "All cities",
    activeTab: "dancers", dancerDirectoryFilter: "now", userLocationOutsideMarkets: false,
    lastSpecificDiscoveryCity: "Las Vegas", markets: { "Las Vegas": {}, Miami: {} },
    window: { sessionStorage: { setItem() {} } }, escapeHtml: value => value,
    cityDiscoveryStatsByName: new Map([["Las Vegas", { dancers: 9, venues: 1 }]]),
  });
  const markupStart = liveShell.indexOf("    function cityPickerOptionMarkup(");
  const syncStart = liveShell.indexOf("    function syncDiscoveryCityScope(", markupStart);
  const syncEnd = liveShell.indexOf("    function openCityPicker(", syncStart);
  assert.ok(markupStart > 0 && syncStart > markupStart && syncEnd > syncStart);
  vm.runInContext(liveShell.slice(markupStart, syncEnd), context);
  return { context, writes, citySelect, citySelectButtonText, citySelectOptions };
}

test("Working Now / Not Working Now switches leave an unchanged city selector and its options intact", () => {
  const f = pickerFixture();
  f.context.syncCityPickerSelection("Las Vegas");
  assert.deepEqual(f.writes, { city: 0, label: 1, options: 1 });
  const initialOptions = f.citySelectOptions.innerHTML;
  for (const filter of ["not_now", "now", "not_now", "now"]) {
    f.context.dancerDirectoryFilter = filter;
    f.context.syncDiscoveryCityScope();
    f.context.syncCityPickerSelection(f.citySelect.value);
  }
  assert.deepEqual(f.writes, { city: 0, label: 1, options: 1 }, "No native-select writes, label replacement or option remounts on status-only redraws");
  assert.equal(f.citySelect.value, "Las Vegas");
  assert.equal(f.citySelectButtonText.textContent, "Las Vegas");
  assert.equal(f.citySelectOptions.innerHTML, initialOptions);
});

test("actual city, count and Near me changes still update the picker", () => {
  const f = pickerFixture();
  f.context.syncCityPickerSelection("Las Vegas");
  f.context.cityDiscoveryStatsByName.set("Las Vegas", { dancers: 12, venues: 2 });
  f.context.renderCityPickerOptions();
  assert.match(f.citySelectOptions.innerHTML, /12 dancers/);
  assert.equal(f.writes.options, 2);
  f.context.syncCityPickerSelection("Miami");
  assert.equal(f.citySelect.value, "Miami");
  assert.equal(f.citySelectButtonText.textContent, "Miami");
  assert.match(f.citySelectOptions.innerHTML, /data-city-picker-value="Miami" aria-selected="true"/);
  f.context.userLocationOutsideMarkets = true;
  f.context.syncCityPickerSelection("Miami");
  assert.equal(f.citySelectButtonText.textContent, "Near me");
  assert.doesNotMatch(f.citySelectOptions.innerHTML, /aria-selected="true"/);
  f.context.userLocationOutsideMarkets = false;
  f.context.syncCityPickerSelection("All cities");
  assert.equal(f.citySelect.value, "All cities");
  assert.equal(f.citySelectButtonText.textContent, "All cities");
  assert.match(f.citySelectOptions.innerHTML, /data-city-picker-value="All cities" aria-selected="true"/);
});

test("city and filter triggers have one stable face in all status tabs, with open and keyboard-focus feedback", async () => {
  const consistency = postcss.parse(await readFile(new URL("../public/dancr-ui-consistency.v1.css", import.meta.url), "utf8"));
  const layer = consistency.nodes.find(node => node.type === "atrule" && node.params === "dancr-palette.discovery-triggers");
  assert.ok(layer, "Nested palette layer overrides the legacy important mobile paint");
  const rules = layer.nodes.filter(node => node.type === "rule");
  const declarations = rule => Object.fromEntries(rule.nodes.map(node => [node.prop, node.value]));
  const face = declarations(rules[0]);
  assert.equal(face.background, "var(--dancr-control-secondary-background)");
  for (const property of ["box-shadow", "filter", "backdrop-filter", "-webkit-backdrop-filter", "transform"]) assert.equal(face[property], "none");
  const overlays = declarations(rules[1]);
  assert.ok(rules[1].selector.includes("::before") && rules[1].selector.includes("::after"));
  assert.equal(overlays.content, "none");
  assert.equal(overlays.display, "none");
  assert.ok(rules[2].selector.includes('[aria-expanded="true"]'));
  assert.ok(rules[2].selector.includes(".has-active-filters"));
  assert.equal(declarations(rules[2])["box-shadow"], "inset 0 0 0 1px var(--dancr-color-brand-primary)");
  assert.ok(rules[3].selector.endsWith(":focus-visible"));
  assert.equal(declarations(rules[3]).outline, "2px solid var(--dancr-color-brand-primary)");
  for (const rule of rules) {
    assert.ok(rule.selector.includes(".home-discovery-controls"));
    assert.doesNotMatch(rule.selector, /dancer-directory-active|data-dancer-directory-filter|home-dancer-grid/, "Paint cannot depend on the selected status or affect grid cards");
    for (const declaration of rule.nodes) {
      assert.ok(declaration.important);
      assert.ok(!["height", "width", "padding", "margin", "gap"].includes(declaration.prop), "Keep existing control geometry");
    }
  }
});
