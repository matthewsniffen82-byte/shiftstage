import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import postcss from "postcss";

const source = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const css = postcss.parse(readFileSync(new URL("../src/live-shell/styles/override-styles-02-media.css", import.meta.url), "utf8"));

function productionFunction(name) {
  const match = source.match(new RegExp(`    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?(?=\\r?\\n    (?:async )?function )`));
  assert.ok(match, `${name} must come from the production renderer`);
  return match[0];
}

function clubFixture() {
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const state = {
    ALL_CITIES: "All cities", userLocationOutsideMarkets: false,
    escapeHtml: escape, escapeOptionValue: escape,
    discoveryMarket: () => ({ venues: [] }), selectedVenueFilter: () => "all",
    selectedRadiusMiles: () => 25, distanceSelect: { options: [{ value: "25" }, { value: "50" }] },
  };
  vm.runInNewContext([
    "discoveryLocationPhrase", "nextHomeDiscoveryRadiusOption", "homeClubEmptyStateMarkup",
  ].map(productionFunction).join("\n"), state);
  return state;
}

test("empty cities show a neutral club message without promising future inventory", () => {
  const state = clubFixture();
  state.discoveryMarket = () => ({ venues: [{ hidden: true }] });
  const markup = state.homeClubEmptyStateMarkup("Las Vegas");
  assert.match(markup, /section class="home-results-empty"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /No clubs in Las Vegas yet/);
  assert.match(markup, /Try another city or check back later/);
  assert.match(markup, /data-home-empty-action="choose-city"/);
  assert.doesNotMatch(markup, /adding club profiles|<svg|clear-filters|expand-radius/);
});

test("club empty states preserve all-city, nearby and escaped location wording", () => {
  const state = clubFixture();
  assert.match(state.homeClubEmptyStateMarkup("All cities"), /No clubs across all cities yet/);
  assert.match(state.homeClubEmptyStateMarkup('City <name> & "region"'), /No clubs in City &lt;name> &amp; &quot;region&quot; yet/);
  state.userLocationOutsideMarkets = true;
  assert.match(state.homeClubEmptyStateMarkup("Las Vegas"), /No MyDancr clubs near you/);
  assert.doesNotMatch(state.homeClubEmptyStateMarkup("Las Vegas"), /No clubs in Las Vegas/);
});

test("filter-empty club results retain radius expansion, clear filters and city selection", () => {
  const state = clubFixture();
  state.discoveryMarket = () => ({ venues: [{ name: "Fixture Club" }] });
  state.selectedVenueFilter = () => "Fixture Club";
  const markup = state.homeClubEmptyStateMarkup("Las Vegas");
  assert.match(markup, /No clubs match these filters/);
  assert.match(markup, /data-home-empty-action="expand-radius" data-radius-value="50"/);
  assert.match(markup, /data-home-empty-action="clear-filters"/);
  assert.match(markup, /data-home-empty-action="choose-city"/);
  state.selectedRadiusMiles = () => 50;
  assert.doesNotMatch(state.homeClubEmptyStateMarkup("Las Vegas"), /expand-radius/);
});

test("all result types share a wrapping, full-width empty state without card or warning decoration", () => {
  let declarations;
  css.walkRules("#results .home-results-empty", rule => {
    declarations = Object.fromEntries(rule.nodes.filter(node => node.type === "decl").map(node => [node.prop, node.value]));
  });
  assert.ok(declarations);
  for (const [property, value] of Object.entries({
    "box-sizing": "border-box", "grid-column": "1 / -1", width: "100%", "min-width": "0",
    "max-width": "100%", height: "auto", "grid-template-columns": "minmax(0, 1fr)",
    "white-space": "normal", "overflow-wrap": "anywhere", "font-size": "16px",
    border: "0", background: "transparent", "box-shadow": "none",
  })) assert.equal(declarations[property], value, property);
  assert.equal(declarations.overflow, undefined, "empty text must not be clipped");
  assert.match(productionFunction("renderHomeDancerGrid"), /dancer-directory-filter-empty home-results-empty/);
  assert.match(productionFunction("renderHomeTvFeedMessage"), /retryCity \? "locked" : "home-results-empty"/);
  assert.match(productionFunction("homeClubEmptyStateMarkup"), /section class="home-results-empty"/);
});
