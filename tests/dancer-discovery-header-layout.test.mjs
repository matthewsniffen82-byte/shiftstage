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
  assert.match(liveShell, /: `\$\{allItems\.length\} dancer\$\{allItems\.length === 1 \? "" : "s"\}`/);
  assert.match(liveShell, /class="dancer-directory-filters" role="tablist" aria-label="Filter dancers"/);
  assert.match(liveShell, /role="tab"[\s\S]*?aria-controls="results"[\s\S]*?aria-selected="\$\{active\}"/);
  assert.match(liveShell, /dancer-directory-filter-count">\$\{counts\[filter\.id\]\}<\/span>/);
  assert.match(aesthetic, /#tabTitle \{[\s\S]*?font-size: clamp\(20px, 5\.35vw, 24px\)/);
  assert.match(aesthetic, /#tabCount \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important/);
  assert.match(aesthetic, /\.dancer-directory-filters \{[\s\S]*?gap: 2px !important;[\s\S]*?padding: 3px;[\s\S]*?border-radius: 14px/);
  assert.match(aesthetic, /\.dancer-directory-filter \{[\s\S]*?min-height: 48px !important/);
  assert.match(aesthetic, /> \.dancer-directory-filters \+ \.home-dancer-grid-heading \{[\s\S]*?display: none !important/);
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
  assert.match(aesthetic, /data-dancer-directory-filter="upcoming"\]\.is-active:not\(\.is-empty\)[\s\S]*?var\(--dancr-color-info\)/);
  assert.match(liveShell, /filter\.id === "now" \|\| filter\.id === "upcoming"[\s\S]*?dancer-directory-filter-status/);
  assert.match(
    aesthetic,
    /data-dancer-directory-filter="upcoming"\]\.is-active:not\(\.is-empty\)[\s\S]*?> \.dancer-directory-filter-status \{[\s\S]*?display: block;[\s\S]*?width: 6px;[\s\S]*?height: 6px;[\s\S]*?flex-basis: 6px;[\s\S]*?background: var\(--dancr-color-info\)[\s\S]*?box-shadow: 0 0 8px var\(--dancr-color-info-soft\)/,
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
    /data-dancer-directory-filter="now"\]\.is-active:not\(\.is-empty\) \{[\s\S]*?border-color: var\(--dancr-color-live-medium\) !important;/,
  );
  assert.match(
    aesthetic,
    /data-dancer-directory-filter="upcoming"\]\.is-active:not\(\.is-empty\) \{[\s\S]*?border-color: var\(--dancr-color-info-strong\) !important;/,
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
