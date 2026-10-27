import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const css = postcss.parse(readFileSync('app/dashboard/venue-media-review.css', 'utf8'));
function values(selector, media) {
  selector = selector.replaceAll('#venue-media-reviews', ':is(#venue-media-reviews, #venue-join-media, #venue-dancer-approvals)');
  const result = {};
  css.walkRules(rule => {
    if (rule.selector !== selector || (rule.parent.type === 'atrule' && rule.parent.name === 'media' ? rule.parent.params : undefined) !== media) return;
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

test('profile cards and their nested media share the same grid and action styles as media updates', () => {
  const shared = ':is(#venue-media-reviews, #venue-join-media, #venue-dancer-approvals)';
  for (const suffix of [' :is(.venue-media-dancer-grid, .venue-media-review-grid)', ' .venue-media-review-preview', ' .venue-media-review-actions']) {
    let found=false;css.walkRules(rule=>{if(rule.selector===shared+suffix)found=true;});assert.equal(found,true,suffix);
  }
  const actions=values('#venue-dashboard #venue-media-reviews .venue-media-review-actions button');
  assert.equal(actions['min-height'],'44px');assert.equal(actions.position,undefined,'actions remain below the media');
  assert.equal(values('#venue-media-reviews .venue-media-review-actions','(max-width: 699px)')['flex-direction'],'column');
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

test('three-column portrait grids stay inside the panel at mobile widths, like site admin', () => {
  const selector = '#venue-media-reviews :is(.venue-media-dancer-grid, .venue-media-review-grid)';
  const grid = values(selector);
  assert.equal(grid['grid-template-columns'], 'repeat(3, minmax(0, 1fr))');
  assert.equal(grid.gap, 'var(--dancr-media-grid-gap, 3px)');
  const mobile = values(selector, '(max-width: 679px)');
  assert.equal(mobile.width, undefined);
  assert.equal(grid.width, '100%');assert.equal(grid['max-width'],'100%');
  assert.equal(grid['margin-inline'], '0');assert.equal(grid['padding-inline'],'0');
  const card = values('#venue-dashboard #venue-media-reviews .venue-media-dancer-card');
  assert.equal(card['aspect-ratio'], '9 / 16');
  assert.equal(card.margin, '0');
  assert.equal(card.overflow, 'hidden');
});

test('club profile reviews match site admin grid, preview, identity, and action geometry',()=>{
  const admin=postcss.parse(readFileSync('app/admin/admin-media-grid.css','utf8'));
  const adminValues=selector=>{const result={};admin.walkRules(rule=>{if(rule.selector===selector)rule.walkDecls(decl=>{result[decl.prop]=decl.value;});});return result;};
  const pairs=[
    ['#venue-media-reviews :is(.venue-media-dancer-grid, .venue-media-review-grid)', '.admin-media-grid-workbench :is(.admin-media-dancer-grid, .admin-media-review-grid)', ['grid-template-columns','gap','width','max-width','margin-inline','padding-inline']],
    ['#venue-media-reviews .venue-media-review-preview','.admin-media-grid-workbench .admin-media-preview',['aspect-ratio','border-radius','overflow']],
    ['#venue-media-reviews .venue-media-dancer-identity','.admin-media-identity',['inset','gap','padding','background']],
    ['#venue-media-reviews .venue-media-dancer-identity > span','.admin-media-identity > span',['font-size','color']],
    ['#venue-dashboard #venue-media-reviews .venue-media-review-actions button','.admin-media-grid-workbench :is(.admin-media-card-actions,.admin-media-rejection) button',['min-height','padding','border-radius','font-size','gap','white-space','overflow-wrap']],
  ];
  for(const [clubSelector,adminSelector,props] of pairs){
    const club=values(clubSelector),site=adminValues(adminSelector);
    for(const prop of props)assert.equal(club[prop],site[prop],`${clubSelector}: ${prop}`);
  }
  const cardSelector='#venue-dashboard :is(#venue-media-reviews, #venue-join-media, #venue-dancer-approvals) .venue-media-dancer-card';
  const cardRule=css.nodes.find(node=>node.type==='atrule'&&node.name==='layer'&&node.params==='dancr-palette').nodes.find(node=>node.selector===cardSelector);
  assert.ok(cardRule,'portrait cards must override palette button sizing just like site admin');
  const card=values('#venue-dashboard #venue-media-reviews .venue-media-dancer-card');
  assert.equal(card['backdrop-filter'],'none');assert.equal(card['min-height'],'0');
  const label={};css.walkRules(rule=>{if(rule.selector==='.venue-media-main-label')rule.walkDecls(decl=>{label[decl.prop]=decl.value;});});
  assert.deepEqual(label,adminValues('.admin-media-main-label'));
});
