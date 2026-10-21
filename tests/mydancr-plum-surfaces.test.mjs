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
const venueRules = rules.filter(rule => rule.parent.type === "atrule" && rule.parent.params === "venue-fills");

test("the plum palette preserves branded roots, descendants, and portal contexts", () => {
  assert.ok(rules.length > 0);
  for (const rule of rules.filter(rule => rule !== followRule && !venueRules.includes(rule))) {
    assert.match(rule.selector, /^html:not\(\.internal-profile-embed\)/);
    assert.ok(rule.selector.includes("body.dancr-button-system:not(:has(.ir-shell, .venue-embed-profile-page,"));
    assert.ok(rule.selector.includes('#profileBackdrop.show #profileModal:is([data-venue-brand*="rhino" i], [data-venue-brand="talk-of-the-town"])'));
    assert.ok(rule.selector.includes(':not(:where(:is([data-venue-brand*="rhino" i], [data-venue-brand="talk-of-the-town"]), :is([data-venue-brand*="rhino" i], [data-venue-brand="talk-of-the-town"]) *))'));
  }
  assert.equal(venueRules.length, 3);
  for (const rule of venueRules) {
    assert.ok(rule.selector.startsWith('html:not(.internal-profile-embed) body.dancr-button-system:not(.venue-grid-embed)'));
    assert.ok(rule.selector.includes(':not(:has(.ir-shell, .venue-embed-profile-page))'));
    assert.ok(rule.selector.includes(':not(:where(.ir-shell, .ir-shell *, .venue-embed-profile-page, .venue-embed-profile-page *))'));
    assert.doesNotMatch(rule.selector, /data-venue-brand/, 'public Rhino metadata must not opt out of MyDancr fills');
    assert.equal(rule.parent.parent.params, 'dancr-follow-controls', 'venue fills must outrank legacy important control fills');
    if (rule.nodes.some(node => node.value.includes('--dancr-color-control-plum'))) {
      for (const state of ['[aria-pressed="true"]', '.is-active', '.is-confirmed', ':disabled', '[aria-disabled="true"]']) {
        assert.ok(rule.selector.includes(`:not(${state})`));
      }
    }
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

test("unselected discovery controls have neutral outlines while the city list uses its selected fill", () => {
  const idle = rules.find(rule => rule.nodes.some(node => node.prop === '--discovery-control-edge'));
  assert.ok(idle);
  for (const target of [
    '#citySelectButton:not([aria-expanded="true"])',
    '#homeFilterToggle:not(.has-active-filters):not(.is-open)',
    '.city-picker-option:not([aria-selected="true"])',
    '.dancer-directory-filter[aria-selected="false"]',
  ]) assert.ok(idle.selector.includes(target), target);
  assert.deepEqual(idle.nodes.map(node => [node.prop, node.value, node.important]), [
    ['--discovery-control-face', 'var(--dancr-color-control-plum)', true],
    ['--discovery-control-edge', '#34343c', true],
  ]);
  assert.equal(idle.parent.params, 'dancr-follow-controls');
  const selected = [];
  postcss.parse(css).walkRules(rule => {
    if (rule.selector.endsWith('.city-picker-option[aria-selected="true"]')) selected.push(rule);
  });
  assert.ok(selected.some(rule => rule.nodes.some(node => node.prop === '--discovery-control-face' && node.value === 'var(--dancr-color-control-selected)' && node.important)));
});

test("Saved venue cards include plum surfaces and controls with actual branded context exclusions", () => {
  const generated = postcss.parse(savedVenueCardStyles([palette.toString()]));
  const cards = [];
  generated.walkRules(rule => cards.push(rule));
  assert.equal(cards.length, 2);
  for (const rule of cards) {
    assert.match(rule.selector, /^#customer-dashboard/);
    assert.ok(rule.selector.includes(':not(:has(.ir-shell, .venue-embed-profile-page))'));
    assert.ok(rule.selector.includes(':not(:where(.ir-shell, .ir-shell *, .venue-embed-profile-page, .venue-embed-profile-page *))'));
    assert.doesNotMatch(rule.selector, /data-venue-brand/);
    if (rule.selector.includes('.venue-card-secondary-actions')) {
      assert.ok(rule.selector.includes(':not([aria-pressed="true"])'));
      assert.ok(rule.selector.includes(':not([aria-disabled="true"])'));
    }
    assert.equal(rule.parent.params, 'venue-fills');
    assert.equal(rule.parent.parent.params, 'dancr-follow-controls');
  }
  assert.ok(cards.some(rule => rule.nodes.some(node => node.prop === 'background-color' && node.value === 'var(--dancr-color-surface-plum)')));
  assert.ok(cards.some(rule => rule.nodes.some(node => node.prop === '--venue-utility-face' && node.value === 'var(--dancr-color-control-plum)')));
});
