import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const venue = postcss.parse(read("../app/dashboard/venue-dancer-grid.css"));
const home = postcss.parse(read("../src/live-shell/styles/override-styles-04-dancr-button-system-home-dancer-grid-action-rail-feed-card-actio.css"));
const homeFinishes = postcss.parse(read("../public/dancr-ui-consistency.v1.css"));
const premium = postcss.parse(read("../app/dashboard/venue-premium.css"));
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

test("whole venue cards match homepage dimensions, not just the photo area", () => {
  const expected = declarations(home, `${homeGrid} > .home-dancer-grid-card`);
  homeFinishes.walkRules(rule => {
    if (!rule.selector.endsWith(".home-dancer-grid-card.is-compact-directory")) return;
    rule.walkDecls("border-radius", ({ value }) => { expected["border-radius"] = value; });
  });
  assert.equal(expected["border-radius"], "8px", "include the homepage's final rounded-card override");
  const card = declarations(venue, "body .venue-dancer-grid .venue-dancer-card");
  const photo = declarations(venue, "body .venue-dancer-grid .venue-card-portrait");
  for (const property of ["width", "min-width", "max-width", "height", "min-height", "max-height", "aspect-ratio", "margin", "padding", "border", "border-radius", "background"]) {
    assert.equal(card[property], expected[property], property);
  }
  assert.equal(photo["aspect-ratio"], expected["aspect-ratio"]);
  assert.equal(photo["border-radius"], expected["border-radius"]);
  assert.equal(photo.width, "100%");
  assert.equal(photo.height, "100%");
  assert.equal(declarations(venue, "body .venue-dancer-grid button.ir-profile-link.venue-card-profile")["border-radius"], expected["border-radius"]);
  assert.equal(card.overflow, "visible", "profile dialogs and staff menus must not be clipped");
  assert.equal(declarations(venue, "body .venue-dancer-grid .venue-card-details")["overflow-wrap"], "anywhere");
});

test("live venue grids recover the panel inset without moving headings or filters", () => {
  let panelInset, gridWidth, gridMargin;
  premium.walkRules(rule => {
    if (rule.selector.includes(":is(.info-panel, .venue-workspace-summary,")) {
      rule.walkDecls("padding", ({ value }) => { panelInset = parseFloat(value); });
    }
    if (rule.selector.includes(".venue-roster-content > .venue-dancer-grid")) {
      assert.ok(rule.selector.includes("#table-requests.ir-panel > .venue-dancer-grid"));
      rule.walkDecls("width", ({ value, important }) => {
        gridWidth = value;
        assert.ok(important, "override the shared public grid width");
      });
      rule.walkDecls("margin-inline", ({ value, important }) => {
        gridMargin = value;
        assert.ok(important, "override the shared public grid margins");
      });
    }
  });
  assert.ok(panelInset > 0);
  assert.equal(gridWidth, `calc(100% + ${panelInset * 2}px)`);
  assert.equal(gridMargin, `-${panelInset}px`);
});

test("roster channel labels wrap in full instead of truncating Internal or External", () => {
  const label = declarations(venue, 'body .venue-dancer-grid[aria-label="Dancer roster cards"] .venue-card-caption > small');
  assert.equal(label["white-space"], "normal");
  assert.equal(label.overflow, "visible");
  assert.equal(label["text-overflow"], "clip");
  assert.equal(label["overflow-wrap"], "normal", "keep each channel word intact");
  assert.equal(label["word-break"], "normal");
});

test("details, profile errors and actions cannot add height to a compact card", () => {
  const profile = declarations(venue, "body .venue-dancer-grid button.ir-profile-link.venue-card-profile");
  assert.equal(profile.height, "100%");
  const menu = declarations(venue, "body .venue-dancer-grid .venue-card-menu");
  assert.equal(menu.position, "absolute");
  assert.equal(menu.inset, "0");
  assert.equal(menu["pointer-events"], "none", "the menu wrapper must not cover the profile target");
  const popover = declarations(venue, "body .venue-dancer-grid .venue-card-menu > .venue-card-popover");
  assert.equal(popover.position, "absolute");
  assert.equal(popover.overflow, "auto");
  assert.equal(popover["pointer-events"], "auto");
  const error = declarations(venue, 'body .venue-dancer-grid .ir-profile-control > small[role="status"]');
  assert.equal(error.position, "absolute");
  assert.equal(error.overflow, "auto");
  for (const column of [1, 2]) {
    assert.equal(declarations(venue, `body .venue-dancer-grid .venue-dancer-card:nth-child(3n + ${column}) .venue-card-popover`).right, "auto");
  }
});

test("demo and live venue rosters and requests all use the same grid stylesheet", () => {
  for (const file of ["VenueDemoDashboard", "VenueNfcTagPanel", "VenueMostRequestedDancers", "VenueDancerPerformance"]) {
    const source = read(`../app/dashboard/${file}.tsx`);
    assert.ok(source.includes('import "./venue-dancer-grid.css";'));
    assert.match(source, /className="venue-dancer-grid(?: [^"]*)?"/);
  }
  const internal = read("../app/internal/InternalRoster.tsx");
  assert.ok(internal.includes('import "../dashboard/venue-dancer-grid.css";'));
  assert.ok(internal.includes('className="venue-dancer-grid" aria-label="Table request cards"'));
});
