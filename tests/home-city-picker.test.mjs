import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("city selection expands inline, applies immediately, and remains keyboard accessible", () => {
  assert.match(liveShell, /function openCityPicker\(\)[\s\S]*?citySelectPanel\.hidden = false[\s\S]*?querySelector\('\[aria-selected="true"\]'\)\?\.focus\(\)/);
  assert.match(liveShell, /function applyCityPickerSelection\(nextCity\)[\s\S]*?citySelect\.value = nextCity[\s\S]*?closeCityPicker\(true\)[\s\S]*?citySelect\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
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

test("location matching never relabels a remote visitor as the nearest supported city", () => {
  assert.match(liveShell, /const MAX_LOCATION_MARKET_DISTANCE_MILES = 50;/);
  assert.match(
    liveShell,
    /function nearestCityForCoordinates\(coords\)[\s\S]*?\.sort\(\(a, b\) => a\.miles - b\.miles\)\[0\] \|\| null;/,
  );
  assert.match(
    liveShell,
    /const requestedLocation = await requestVenuePosition\(\);[\s\S]*?const nearestMarket = nearestCityForCoordinates\(requestedLocation\);[\s\S]*?nearestMarket\.miles > MAX_LOCATION_MARKET_DISTANCE_MILES[\s\S]*?userLocation = null;[\s\S]*?No MyDancr city within \$\{MAX_LOCATION_MARKET_DISTANCE_MILES\} mi\. \$\{selectedCity\(\)\} remains selected\.[\s\S]*?return;/,
  );
  assert.match(
    liveShell,
    /userLocation = requestedLocation;[\s\S]*?citySelect\.value = nearestMarket\.city;[\s\S]*?syncCityPickerSelection\(nearestMarket\.city\);[\s\S]*?\$\{nearestMarket\.city\} selected from your location\./,
  );
  assert.doesNotMatch(liveShell, /showToast\("Location updated\."\)/);
});

test("mobile location feedback stays concise and clears the floating navigation", () => {
  assert.doesNotMatch(liveShell, /Location found\. Venue distances updated/);
  assert.match(
    liveShell,
    /@media \(max-width: 720px\) \{[\s\S]*?body \.toast \{[\s\S]*?z-index: 110;[\s\S]*?bottom: calc\(92px \+ env\(safe-area-inset-bottom, 0px\)\) !important;[\s\S]*?max-width: calc\(100% - 32px\);[\s\S]*?text-align: center;/,
  );
});
