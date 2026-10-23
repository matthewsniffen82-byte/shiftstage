import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const css = postcss.parse(readFileSync('app/dashboard/venue-media-review.css', 'utf8'));
function values(selector, media) {
  const result = {};
  css.walkRules(rule => {
    if (rule.selector !== selector || (rule.parent.type === 'atrule' ? rule.parent.params : undefined) !== media) return;
    rule.walkDecls(decl => { result[decl.prop] = decl.value; });
  });
  return result;
}

test('the media filter reserves space below its full-height dropdown before either grid', () => {
  const controls = values('#venue-dashboard #venue-media-reviews .venue-media-controls');
  assert.equal(controls['margin-bottom'], '12px');
  assert.equal(controls.display, 'flex');
  assert.equal(controls['flex-wrap'], 'wrap');
  assert.equal(controls['align-items'], 'flex-end');
  assert.equal(controls.gap, '8px');
  const filter = values('#venue-dashboard #venue-media-reviews .venue-media-controls > label');
  assert.equal(filter.flex, '1 1 240px');
  assert.equal(filter['min-width'], '0');
  assert.equal(values('#venue-dashboard #venue-media-reviews label')['margin-bottom'], undefined,
    'rejection-form labels must not inherit filter spacing');
  const select = values('#venue-dashboard #venue-media-reviews .venue-media-controls select');
  assert.equal(select.display, 'block');
  assert.equal(select['box-sizing'], 'border-box');
  assert.equal(select.width, '100%');
  assert.equal(select['min-width'], '0');
  assert.equal(select['min-height'], '44px');
  assert.equal(select.height, '44px');
  assert.equal(select['font-size'], '16px');
  assert.equal(select.padding, '8px 40px 8px 12px', 'leave room for the dropdown arrow');
  assert.equal(select.margin, '0');
  assert.equal(select.position, undefined, 'keep the full dropdown in normal flow');
  assert.equal(filter.height, undefined, 'allow larger text and native controls to grow');
});

test('All dancers matches the dropdown height without expanding into a large full-width box', () => {
  const back = values('#venue-dashboard #venue-media-reviews .venue-media-back');
  assert.equal(back.display, 'inline-flex');
  assert.equal(back['min-height'], '44px');
  assert.equal(back.flex, '0 1 auto');
  assert.equal(back['max-width'], '100%');
  assert.equal(back.margin, '0');
  assert.equal(back.padding, '8px 12px');
  assert.equal(back['border-radius'], '8px');
  assert.equal(back['font-size'], '13px');
  assert.equal(back['white-space'], 'normal');
});

test('filter spacing preserves the existing three-column portrait grids and mobile width', () => {
  const selector = '#venue-media-reviews :is(.venue-media-dancer-grid, .venue-media-review-grid)';
  const grid = values(selector);
  assert.equal(grid['grid-template-columns'], 'repeat(3, minmax(0, 1fr))');
  assert.equal(grid.gap, 'var(--dancr-media-grid-gap, 3px)');
  const mobile = values(selector, '(max-width: 679px)');
  assert.equal(mobile.width, '100vw');
  assert.equal(mobile['margin-inline'], 'calc(50% - 50vw)');
  assert.equal(mobile['margin-top'], undefined);
  const card = values('#venue-dashboard #venue-media-reviews .venue-media-dancer-card');
  assert.equal(card['aspect-ratio'], '9 / 16');
  assert.equal(card.margin, '0');
  assert.equal(card.overflow, 'hidden');
});
