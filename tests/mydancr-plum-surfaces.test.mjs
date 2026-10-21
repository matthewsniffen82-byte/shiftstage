import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import { savedVenueCardStyles } from "../src/lib/dancr/saved-venue-card-styles.mjs";

const css = readFileSync(new URL("../public/dancr-ui-consistency.v1.css", import.meta.url), "utf8");
const palette = postcss.parse(css.slice(css.indexOf("/* Extend the sharing palette")));
const rules = [];
palette.walkRules(rule => rules.push(rule));
const followRule = rules.find(rule => rule.selector.includes(':is(#followBtn, [data-follow-control="text"])'));

test("the general plum palette excludes Rhino roots, descendants, and branded portal contexts", () => {
  assert.ok(rules.length > 0);
  for (const rule of rules.filter(rule => rule !== followRule)) {
    assert.match(rule.selector, /^html:not\(\.internal-profile-embed\)/);
    assert.ok(rule.selector.includes("body.dancr-button-system:not(:has(.ir-shell, .venue-embed-profile-page,"));
    assert.ok(rule.selector.includes('#profileBackdrop.show #profileModal:is([data-venue-brand*="rhino" i], [data-venue-brand="talk-of-the-town"])'));
    assert.ok(rule.selector.includes(':not(:where(:is([data-venue-brand*="rhino" i], [data-venue-brand="talk-of-the-town"]), :is([data-venue-brand*="rhino" i], [data-venue-brand="talk-of-the-town"]) *))'));
  }
});

test("public profile Follow uses plum regardless of venue affiliation, while branded and selected controls are excluded", () => {
  assert.ok(followRule);
  assert.ok(followRule.selector.startsWith('html:not(.internal-profile-embed) body.dancr-button-system:not(.venue-grid-embed)'));
  assert.ok(followRule.selector.includes(':is(#profileBackdrop #profileModal, .public-profile-shell) .profile-actions-compact'));
  assert.ok(followRule.selector.includes(':not(:where(.ir-shell *, .venue-embed-profile-page *))'));
  assert.doesNotMatch(followRule.selector, /data-venue-brand|\.profile-share|#goingBtn|\.profile-action-going/);
  for (const state of ['[aria-pressed="true"]', '.is-confirmed', '[data-internal-table-request]', ':disabled', '[aria-disabled="true"]']) {
    assert.ok(followRule.selector.includes(`:not(${state})`));
  }
  assert.deepEqual(followRule.nodes.map(node => [node.prop, node.value, node.important]), [
    ['--follow-control-face', 'var(--dancr-color-control-plum)', true],
    ['--follow-control-edge', 'var(--dancr-color-control-border)', true],
  ]);
});

test("fills cannot alter VIP champagne text, geometry, navigation, or primary and gray controls", () => {
  palette.walkDecls(decl => {
    assert.ok(/^(background|border-color|--(?:follow-control|profile-utility|profile-action|venue-utility|dancr-report|discovery-control|picker)-)/.test(decl.prop), decl.prop);
  });
  for (const rule of rules) {
    const target = rule.selector.split("\n").at(-1);
    assert.doesNotMatch(target, /free-entry|vip-primary|primary-action|bottom-nav|social-nav|mydancr-refresh|profile-media-control|home-tv-feed|end-working/);
    if (target.includes(".profile-actions-compact")) {
      assert.ok(target.includes(':not([aria-pressed="true"])'));
      assert.ok(target.includes(":not([data-internal-table-request])"));
    }
    if (target.includes(".profile-media-tabs")) assert.ok(target.includes('button:not(.active):not([aria-selected="true"])'));
  }
});

test("Saved venue cards retain the Rhino exclusions when styles are generated", () => {
  const generated = postcss.parse(savedVenueCardStyles([palette.toString()]));
  const cards = [];
  generated.walkRules(rule => cards.push(rule));
  assert.ok(cards.length > 0);
  for (const rule of cards) {
    assert.match(rule.selector, /^#customer-dashboard/);
    assert.ok(rule.selector.includes(':not(:where(:is([data-venue-brand*="rhino" i]'));
    assert.ok(rule.selector.includes('.venue-embed-profile-page'));
    assert.ok(rule.selector.includes(':not([aria-pressed="true"])'));
  }
});
