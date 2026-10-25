import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const liveShell = await readFile(new URL("../outputs/index.html", import.meta.url), "utf8");
const aesthetic = await readFile(new URL("../public/dancr-aesthetic.v1.css", import.meta.url), "utf8");
const consistency = postcss.parse(await readFile(new URL("../public/dancr-ui-consistency.v1.css", import.meta.url), "utf8"));

test("dancer discovery reuses canonical state and shared discovery-control dimensions", () => {
  assert.match(liveShell, /document\.body\.classList\.toggle\("dancer-directory-active", activeTab === "dancers"\)/);
  assert.match(liveShell, /<label id="citySelectLabel" for="citySelect">City<\/label>/);
  assert.match(aesthetic, /body\.dancer-directory-active[\s\S]*?#citySelectLabel \{[\s\S]*?clip-path: inset\(50%\)/);
  assert.match(aesthetic, /body\.dancer-directory-active[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(aesthetic, /:is\(#citySelect, \.city-picker-trigger, \.home-filter-toggle\) \{[\s\S]*?height: 44px !important;[\s\S]*?min-height: 44px !important;[\s\S]*?max-height: 44px !important;[\s\S]*?border-radius: 14px !important/);
  assert.match(aesthetic, /\.home-filter-toggle \{[\s\S]*?min-width: 104px !important;[\s\S]*?padding-inline: 12px !important/);
});

test("directory heading, dynamic total, and segmented filters are compact and accessible", () => {
  assert.match(liveShell, /href="\/outputs\/dancr-aesthetic\.css"/);
  assert.match(liveShell, /: `\$\{resultCount\} dancer\$\{resultCount === 1 \? "" : "s"\}\$\{hasMoreDiscovery\(city\) && dancerTotal === null \? " loaded" : ""\}`/);
  assert.match(liveShell, /class="dancer-directory-filters[^\n]+role="tablist" aria-label="Filter dancers"/);
  assert.match(liveShell, /role="tab"[\s\S]*?aria-controls="results"[\s\S]*?aria-selected="\$\{active\}"/);
  assert.match(liveShell, /dancer-directory-filter-count">\$\{countLabel\}<\/span>/);
  assert.match(aesthetic, /#tabTitle \{[\s\S]*?font-size: clamp\(20px, 5\.35vw, 24px\)/);
  assert.match(aesthetic, /#tabCount \{[\s\S]*?border: 0 !important;[\s\S]*?background: transparent !important/);
  assert.match(aesthetic, /\.dancer-directory-filters \{[\s\S]*?width: 100%;[\s\S]*?gap: 2px !important;[\s\S]*?padding: 0;[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(aesthetic, /\.dancer-directory-filter \{[\s\S]*?min-height: 48px !important/);
  assert.match(
    aesthetic,
    /#results\.home-dancer-grid > \.home-dancer-grid-heading \{\s*display: none !important/,
  );
});

test("mobile discovery shares a scrollbar-safe gutter without changing profile or card gaps", () => {
  assert.match(aesthetic, /--dancer-discovery-content-gutter: 6px/);
  const mobileGutters = [];
  postcss.parse(aesthetic).walkDecls("--dancer-discovery-content-gutter", declaration => {
    if (declaration.parent.selector !== "body.dancer-directory-active > .app > main.stack") return;
    mobileGutters.push(declaration);
  });
  assert.equal(mobileGutters.length, 1);
  assert.equal(mobileGutters[0].value, "12px");
  assert.equal(mobileGutters[0].parent.parent.params, "(max-width: 720px)");
  assert.match(aesthetic, /--dancr-media-grid-gap: 3px/);
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

  assert.match(liveShell, /const statusDot = '<span class="dancer-directory-filter-status" aria-hidden="true"><\/span>';/);
  assert.match(
    aesthetic,
    /data-dancer-directory-filter="now"\]\.is-active:not\(\.is-empty\)[\s\S]*?> \.dancer-directory-filter-status \{[\s\S]*?display: block;[\s\S]*?width: 6px;[\s\S]*?height: 6px;[\s\S]*?flex-basis: 6px;[\s\S]*?background: var\(--dancr-color-live\)[\s\S]*?box-shadow: 0 0 8px var\(--dancr-color-live-soft\)/,
  );
  assert.match(aesthetic, /\.dancer-directory-filter:not\(\.is-active\) \{[\s\S]*?var\(--dancr-color-surface-raised\)/);
  assert.doesNotMatch(liveShell, /data-dancer-directory-filter="now"\]:not\(\.is-empty\):not\(\.is-active\) span \{[\s\S]*?#4dec9d/);
});

test("existing city, radius, club, Working Now, Not Working Now, and filter result logic remains canonical", () => {
  assert.match(liveShell, /const radiusLabel = distanceSelect\?\.value \|\| "25 mi"/);
  assert.match(liveShell, /const venueLabel = venueName === "all" \? "All Clubs" : resolveVenueByName\(venueName, city\)\?\.name \|\| venueName/);
  assert.match(liveShell, /const workingNowCount = getItems\(city, "tonight"\)\.length/);
  assert.match(liveShell, /now: profiles\.filter\(\(profile\) => isWorkingTonight\(profile, city\)\)\.length/);
  assert.match(liveShell, /not_now: profiles\.filter\(\(profile\) => !isWorkingTonight\(profile, city\)\)\.length/);
  assert.match(liveShell, /if \(dancerDirectoryFilter === "now" \|\| selectedVenueFilter\(\) !== "all"\)[\s\S]*?groups\.workingNow/);
  assert.match(liveShell, /label: "Not Working Now", className: "is-open", profiles: groups\.notWorkingNow/);
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
    /\.dancer-directory-filter\.is-active \{[\s\S]*?border-color: var\(--dancr-color-brand-primary-strong\) !important;/,
  );
});

test("narrow and long-label safeguards keep controls and counts collision-free", () => {
  assert.match(aesthetic, /:is\(\.city-picker-trigger-value, #citySelect\) \{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap/);
  assert.match(aesthetic, /@media \(max-width: 360px\) \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 104px/);
  assert.match(aesthetic, /#tabCount \{[\s\S]*?white-space: nowrap/);
  assert.match(liveShell, /const empty = countKnown && count === 0/);
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
  assert.match(liveShell, /class="home-filter-actions">\s*<button class="location-btn" id="locationBtn"[^>]*>[^]*?Use current location<\/span>\s*<\/button>\s*<button class="home-filter-reset" id="homeFilterReset"[^>]*hidden>Reset<\/button>\s*<\/div>/);
  assert.match(liveShell, /const homeFilterReset = document\.getElementById\("homeFilterReset"\)/);
  assert.match(liveShell, /if \(homeFilterReset\) homeFilterReset\.hidden = activeFilterCount === 0/);
  assert.match(liveShell, /homeFilterReset\?\.addEventListener\("click"[\s\S]*?distanceSelect\.value = "25 mi"[\s\S]*?venueSelect\.value = "all"[\s\S]*?syncVenuePickerSelection\("all"\)[\s\S]*?render\(\)[\s\S]*?showToast\("Filters reset"\)/);
  assert.match(aesthetic, /Expanded filters stay compact[\s\S]*?\.home-filter-toggle:is\(\.is-open, \.has-active-filters\) \{[\s\S]*?border-color: var\(--dancr-color-brand-primary-strong\) !important;[\s\S]*?outline: 0 !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(aesthetic, /\.home-advanced-filters\.is-open \{[\s\S]*?gap: 8px !important;[\s\S]*?padding: 10px !important;[\s\S]*?box-shadow: none !important;/);
  assert.match(aesthetic, /\.home-advanced-filters :is\(#distanceSelect, #venueSelect, \.venue-picker-trigger\) \{[\s\S]*?height: 44px !important;[\s\S]*?max-height: 44px !important;/);
  assert.match(aesthetic, /#locationBtn\.location-btn,[\s\S]*?\.home-filter-reset \{[\s\S]*?height: 44px !important;[\s\S]*?max-height: 44px !important;/);
  assert.match(aesthetic, /#locationBtn\.location-btn \.icon \{[\s\S]*?color: var\(--dancr-color-info\) !important;/);
});

test("phone dancer headers keep the count below the title and refresh in a separate column", () => {
  const rules = [];
  consistency.walkRules((rule) => {
    if (rule.parent.type === "atrule" && rule.parent.params === "(max-width: 600px)" && rule.selector.includes("body.dancer-directory-active")) rules.push(rule);
  });
  const ruleFor = (suffix) => rules.find((rule) => rule.selector.endsWith(suffix));
  const values = (rule) => Object.fromEntries(rule.nodes.map((node) => [node.prop, node.value]));
  const head = ruleFor(":has(> #discoveryRefresh:not([hidden]))");
  assert.ok(head);
  assert.equal(values(head)["grid-template-columns"], "minmax(0, 1fr) 44px");
  assert.equal(values(head)["grid-template-areas"], '"title refresh" "count refresh"');
  assert.equal(values(head).gap, "2px 8px");
  const title = values(ruleFor(" > #tabTitle"));
  assert.equal(title["grid-area"], "title");
  assert.equal(title["font-size"], "22px");
  assert.equal(title.overflow, "visible");
  assert.equal(values(ruleFor(" > #tabTitle .tab-title-city"))["white-space"], "normal");
  const count = values(ruleFor(" > #tabCount"));
  assert.equal(count["grid-area"], "count");
  assert.equal(count["align-self"], "start");
  assert.equal(count["justify-self"], "start");
  assert.equal(count["white-space"], "normal");
  const refresh = values(ruleFor(" > #discoveryRefresh"));
  assert.equal(refresh["grid-area"], "refresh");
  assert.equal(refresh["align-self"], "center");
  for (const rule of rules) assert.doesNotMatch(rule.selector, /#results|home-dancer-grid|dancer-directory-filter/, "the grid and its controls stay untouched");
});

test("dancer introduction has consistent gaps and no floating baseline-aligned count", () => {
  const prefix = "html body.dancer-directory-active.dancr-button-system > .app main.stack > ";
  const values = (selector) => {
    let found;
    consistency.walkRules((rule) => {
      if (rule.parent.type === "root" && rule.selector.replace(/\s+/g, " ") === selector) found = rule;
    });
    assert.ok(found, selector);
    return Object.fromEntries(found.nodes.map((node) => [node.prop, node.value]));
  };
  assert.equal(values(prefix + "#homeLiveSummary")["margin-block"], "0");
  assert.equal(values(prefix + "section.stack").gap, "8px");
  const head = prefix + "section.stack > .content-head.discovery-section-head";
  assert.equal(values(head)["padding-block"], "0");
  assert.equal(values(head)["margin-block"], "0");
  assert.equal(values(head)["align-items"], "center");
  assert.equal(values(head)["min-height"], "44px");
  assert.equal(values(head + " > #tabCount")["align-self"], "center");
  assert.equal(values(head + " > #tabCount").padding, "0");
});

test("the dancer disclaimer keeps 12px separation independently of the card gaps", () => {
  const prefix = "html body.dancer-directory-active.dancr-button-system > .app main.stack > section.stack > #results.home-dancer-grid > ";
  const rules = new Map();
  consistency.walkRules((rule) => {
    if (rule.parent.type === "root") rules.set(rule.selector.replace(/\s+/g, " "), rule);
  });
  const note = rules.get(prefix + ".roster-participation-note");
  const filters = rules.get(prefix + ".dancer-directory-filters");
  assert.ok(note);
  assert.ok(filters);
  const margin = note.nodes.find((node) => node.prop === "margin");
  assert.equal(margin.value, "calc(12px - var(--dancr-media-grid-gap, 6px)) 0");
  assert.ok(margin.important);
  const filterMargin = filters.nodes.find((node) => node.prop === "margin-bottom");
  assert.equal(filterMargin.value, "0", "avoid adding the old filter margin above the disclaimer");
  assert.ok(filterMargin.important);
});

test("the dancer discovery grid shares the wider gaps used by other media grids", () => {
  const selector = "html body.dancr-button-system #results.home-dancer-grid.home-dancer-three-column";
  const grid = consistency.nodes.find((node) => node.type === "rule" && node.selector.startsWith(selector + ","));
  assert.ok(grid);
  assert.deepEqual(Object.fromEntries(grid.nodes.map((node) => [node.prop, node.value])), {
    gap: "var(--dancr-media-grid-gap, 6px)",
  }, "only spacing changes, not the columns or card dimensions");
  assert.match(aesthetic, /--dancr-media-grid-gap:\s*3px;/);
  consistency.walkDecls("--dancr-media-grid-gap", () => {
    assert.fail("discovery must inherit the shared gap instead of overriding it");
  });
});
