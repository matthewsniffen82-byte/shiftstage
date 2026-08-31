import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const liveShell = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");

test("dancer discovery reuses canonical state and shared discovery-control dimensions", () => {
  assert.match(liveShell, /document\.body\.classList\.toggle\("dancer-directory-active", activeTab === "dancers"\)/);
  assert.match(liveShell, /<label id="citySelectLabel" for="citySelect">City<\/label>/);
  assert.match(aesthetic, /body\.dancer-directory-active[\s\S]*?#citySelectLabel \{[\s\S]*?clip-path: inset\(50%\)/);
  assert.match(aesthetic, /body\.dancer-directory-active[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(aesthetic, /:is\(#citySelect, \.city-picker-trigger, \.home-filter-toggle\) \{[\s\S]*?height: 44px !important;[\s\S]*?min-height: 44px !important;[\s\S]*?max-height: 44px !important;[\s\S]*?border-radius: 14px !important/);
  assert.match(aesthetic, /\.home-filter-toggle \{[\s\S]*?min-width: 104px !important;[\s\S]*?padding-inline: 12px !important/);
});

test("directory heading, dynamic total, and segmented filters are compact and accessible", () => {
  assert.match(liveShell, /href="\/dancr-aesthetic\.v1\.css\?v=242"/);
  assert.match(liveShell, /: `\$\{allItems\.length\} dancer\$\{allItems\.length === 1 \? "" : "s"\}`/);
  assert.match(liveShell, /class="dancer-directory-filters" role="tablist" aria-label="Filter dancers"/);
  assert.match(liveShell, /role="tab"[\s\S]*?aria-controls="results"[\s\S]*?aria-selected="\$\{active\}"/);
  assert.match(liveShell, /dancer-directory-filter-count">\$\{counts\[filter\.id\]\}<\/span>/);
  assert.match(aesthetic, /#tabTitle \{[\s\S]*?font-size: clamp\(20px, 5\.35vw, 24px\)/);
  assert.match(aesthetic, /#tabCount \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important/);
  assert.match(aesthetic, /\.dancer-directory-filters \{[\s\S]*?width: 100%;[\s\S]*?gap: 2px !important;[\s\S]*?padding: 0;[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(aesthetic, /\.dancer-directory-filter \{[\s\S]*?min-height: 48px !important/);
  assert.match(
    aesthetic,
    /#results\.home-dancer-grid\.home-dancer-filtered-view > \.home-dancer-grid-heading \{[\s\S]*?display: none !important/,
  );
  assert.match(
    aesthetic,
    /#results\.home-dancer-grid:not\(\.home-dancer-filtered-view\)[\s\S]*?> \.dancer-directory-filters \+ \.home-dancer-grid-heading \{[\s\S]*?display: flex !important/,
  );
});

test("discovery controls, summary, heading, tabs, and cards share one master gutter", () => {
  assert.match(aesthetic, /--dancer-discovery-content-gutter: 12px/);
  assert.match(
    aesthetic,
    /> :is\(\.home-discovery-controls, \.home-live-summary, section\.stack\) \{[\s\S]*?width: calc\(100% - \(2 \* var\(--dancer-discovery-content-gutter\)\)\) !important;[\s\S]*?margin-inline: var\(--dancer-discovery-content-gutter\) !important/,
  );
  assert.match(
    aesthetic,
    /> :is\(\.content-head\.discovery-section-head, #results\.home-dancer-grid\) \{[\s\S]*?width: 100% !important;[\s\S]*?margin-inline: 0 !important;[\s\S]*?padding-inline: 0 !important/,
  );
  assert.match(liveShell, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
  assert.doesNotMatch(liveShell, /#results\.home-dancer-grid\.home-dancer-three-column \{[\s\S]{0,350}?margin-inline: -/);
});

test("segmented dancer filters use semantic active colors and neutral inactive states", () => {
  assert.match(aesthetic, /data-dancer-directory-filter="now"\]\.is-active:not\(\.is-empty\)[\s\S]*?var\(--dancr-color-live\)/);
  assert.match(aesthetic, /data-dancer-directory-filter="upcoming"\]\.is-active[\s\S]*?var\(--dancr-color-info\)/);
  assert.match(liveShell, /filter\.id === "now" \|\| filter\.id === "upcoming"[\s\S]*?dancer-directory-filter-status/);
  assert.match(
    aesthetic,
    /data-dancer-directory-filter="upcoming"\]\.is-active[\s\S]*?> \.dancer-directory-filter-status \{[\s\S]*?display: block;[\s\S]*?width: 6px;[\s\S]*?height: 6px;[\s\S]*?flex-basis: 6px;[\s\S]*?background: var\(--dancr-color-info\)[\s\S]*?box-shadow: 0 0 8px var\(--dancr-color-info-soft\)/,
  );
  assert.match(aesthetic, /\.dancer-directory-filter:not\(\.is-active\) \{[\s\S]*?var\(--dancr-color-surface-raised\)/);
  assert.doesNotMatch(liveShell, /data-dancer-directory-filter="now"\]:not\(\.is-empty\):not\(\.is-active\) span \{[\s\S]*?#4dec9d/);
});

test("existing city, radius, club, Working Now, Upcoming, and filter result logic remains canonical", () => {
  assert.match(liveShell, /const radiusLabel = distanceSelect\?\.value \|\| "25 mi"/);
  assert.match(liveShell, /const venueLabel = venueName === "all" \? "All clubs" : venueName/);
  assert.match(liveShell, /const workingNowCount = getItems\(city, "tonight"\)\.length/);
  assert.match(liveShell, /now: profiles\.filter\(\(profile\) => isWorkingTonight\(profile, city\)\)\.length/);
  assert.match(liveShell, /upcoming: profiles\.filter\(\(profile\) => profile\.scheduled && !isWorkingTonight\(profile, city\)\)\.length/);
  assert.match(liveShell, /if \(dancerDirectoryFilter === "now"\)[\s\S]*?groups\.workingNow/);
  assert.match(liveShell, /if \(dancerDirectoryFilter === "upcoming"\)[\s\S]*?upcomingSortValue\(a, city\)[\s\S]*?dailyRotationScore\(a, city\)/);
});

test("directory tabs reserve a stable border so every selected state has an outline", () => {
  assert.match(
    aesthetic,
    /> #results\.home-dancer-grid \.dancer-directory-filter \{[\s\S]*?box-sizing: border-box;[\s\S]*?border: 1px solid transparent !important;/,
  );
  assert.match(
    aesthetic,
    /data-dancer-directory-filter="now"\]\.is-active:not\(\.is-empty\) \{[\s\S]*?border-color: var\(--dancr-color-live-strong\) !important;/,
  );
  assert.match(
    aesthetic,
    /data-dancer-directory-filter="upcoming"\]\.is-active \{[\s\S]*?border-color: var\(--dancr-color-info-strong\) !important;/,
  );
});

test("narrow and long-label safeguards keep controls and counts collision-free", () => {
  assert.match(aesthetic, /:is\(\.city-picker-trigger-value, #citySelect\) \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap/);
  assert.match(aesthetic, /@media \(max-width: 360px\) \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 104px/);
  assert.match(aesthetic, /#tabCount \{[\s\S]*?white-space: nowrap/);
  assert.match(liveShell, /const empty = counts\[filter\.id\] === 0/);
  assert.match(liveShell, /empty \? " is-empty" : ""/);
});

test("city and Filters labels share one visual center without resizing their controls", () => {
  assert.match(
    aesthetic,
    /body\.dancer-directory-active\.dancr-button-system[\s\S]*?\.city-picker-trigger-value,[\s\S]*?\.home-filter-toggle > span:not\(\.home-filter-toggle-count\) \{[\s\S]*?align-self: center;[\s\S]*?line-height: 18px !important;/,
  );
  assert.match(
    aesthetic,
    /:is\(\.city-picker-trigger-icon, \.city-picker-chevron, \.home-filter-toggle-icon\) \{[\s\S]*?display: block;[\s\S]*?align-self: center;/,
  );
});

test("expanded discovery filters stay compact and expose truthful reset state", () => {
  assert.match(liveShell, /class="home-filter-actions"[\s\S]*?id="locationBtn"[\s\S]*?>Use current location<[\s\S]*?id="homeFilterReset"[^>]*hidden>Reset<\/button>/);
  assert.match(liveShell, /const homeFilterReset = document\.getElementById\("homeFilterReset"\)/);
  assert.match(liveShell, /if \(homeFilterReset\) homeFilterReset\.hidden = activeFilterCount === 0/);
  assert.match(liveShell, /homeFilterReset\?\.addEventListener\("click"[\s\S]*?distanceSelect\.value = "25 mi"[\s\S]*?venueSelect\.value = "all"[\s\S]*?syncVenuePickerSelection\("all"\)[\s\S]*?render\(\)[\s\S]*?showToast\("Filters reset"\)/);
  assert.match(aesthetic, /Expanded filters stay compact[\s\S]*?\.home-filter-toggle:is\(\.is-open, \.has-active-filters, :focus, :focus-visible\) \{[\s\S]*?border-color: var\(--dancr-color-brand-primary-strong\) !important;[\s\S]*?outline: 0 !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(aesthetic, /\.home-advanced-filters\.is-open \{[\s\S]*?gap: 8px !important;[\s\S]*?padding: 10px !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(aesthetic, /\.home-advanced-filters :is\(#distanceSelect, #venueSelect, \.venue-picker-trigger\) \{[\s\S]*?height: 52px !important;[\s\S]*?max-height: 52px !important;/);
  assert.match(aesthetic, /#locationBtn\.location-btn,[\s\S]*?\.home-filter-reset \{[\s\S]*?height: 44px !important;[\s\S]*?max-height: 44px !important;/);
  assert.match(aesthetic, /#locationBtn\.location-btn \.icon \{[\s\S]*?color: var\(--dancr-color-info\) !important;/);
});
