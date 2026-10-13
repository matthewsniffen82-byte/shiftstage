import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const venue = postcss.parse(read("../app/dashboard/venue-dancer-grid.css"));
const home = postcss.parse(read("../src/live-shell/styles/override-styles-04-dancr-button-system-home-dancer-grid-action-rail-feed-card-actio.css"));
const homeGrid = "#results.home-dancer-grid.home-dancer-three-column";

function declarations(root, selector) {
  const values = {};
  root.walkRules(rule => {
    if (rule.selector !== selector || rule.parent.type !== "root") return;
    rule.walkDecls(({ prop, value }) => { values[prop] = value; });
  });
  return values;
}

test("venue roster and request grids match the homepage's columns and spacing at every width", () => {
  const expected = declarations(home, homeGrid);
  const actual = declarations(venue, "body .venue-dancer-grid");
  for (const property of ["grid-template-columns", "gap", "align-items"]) {
    assert.equal(actual[property], expected[property], property);
  }
  assert.equal(actual.width, "100%");
  assert.equal(actual["min-width"], "0");
  venue.walkRules(rule => {
    if (rule.selector !== "body .venue-dancer-grid") return;
    assert.equal(rule.parent.type, "root", "no two/four-column breakpoint overrides");
  });
});

test("venue photo tiles match homepage proportions without border insets or intrinsic width expansion", () => {
  const expected = declarations(home, `${homeGrid} > .home-dancer-grid-card`);
  const card = declarations(venue, "body .venue-dancer-grid .venue-dancer-card");
  const photo = declarations(venue, "body .venue-dancer-grid .venue-card-portrait");
  for (const property of ["width", "min-width", "margin", "padding", "border", "border-radius"]) {
    assert.equal(card[property], expected[property], property);
  }
  assert.equal(photo["aspect-ratio"], expected["aspect-ratio"]);
  assert.equal(photo["border-radius"], expected["border-radius"]);
  assert.equal(photo.width, "100%");
  assert.equal(card.overflow, "visible", "profile dialogs and staff menus must not be clipped");
  assert.equal(declarations(venue, "body .venue-dancer-grid .venue-card-details")["overflow-wrap"], "anywhere");
});

test("demo and live venue rosters and requests all use the same grid stylesheet", () => {
  for (const file of ["VenueDemoDashboard", "VenueNfcTagPanel"]) {
    const source = read(`../app/dashboard/${file}.tsx`);
    assert.ok(source.includes('import "./venue-dancer-grid.css";'));
    assert.ok(source.includes('className="venue-dancer-grid"'));
  }
  const internal = read("../app/internal/InternalRoster.tsx");
  assert.ok(internal.includes('import "../dashboard/venue-dancer-grid.css";'));
  assert.ok(internal.includes('className="venue-dancer-grid" aria-label="Table request cards"'));
});
