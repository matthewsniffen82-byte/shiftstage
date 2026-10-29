import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import postcss from 'postcss';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const grid = postcss.parse(read('app/internal/internal-guest.css'));
const profile = postcss.parse(read('src/live-shell/styles/internal-profile-embed.css'));
function declarations(css, selector) {
  const matches = [];
  css.walkRules(rule => { if (rule.selector === selector) matches.push(rule); });
  assert.equal(matches.length, 1, selector);
  return Object.fromEntries(matches[0].nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]));
}
const gridCancel = 'body.dancr-button-system .ir-shell.ir-guest button.ir-table-request[data-request-sent]';
const profileCancel = 'html.internal-profile-embed [data-internal-table-request][data-request-sent]';
const profileLabel = 'html.internal-profile-embed body.dancr-button-system #profileBackdrop #profileModal .profile-actions-compact.profile-venue-actions :is(#goingBtn, .profile-action-icon-control)[data-internal-table-request][data-request-sent]';

test('grid and profile cancellation share a visible charcoal face, border, white label and press feedback', () => {
  assert.equal(declarations(grid, gridCancel)['--ir-guest-control-edge'], '#85858f');
  assert.equal(declarations(profile, profileCancel)['--profile-action-border'], '#85858f');
  assert.equal(declarations(grid, gridCancel + '::before').background, 'linear-gradient(#303037, #303037)');
  assert.equal(declarations(profile, profileCancel)['--profile-action-background'], 'linear-gradient(#303037, #303037)');
  assert.equal(declarations(grid, gridCancel).color, '#fff');
  assert.equal(declarations(profile, profileLabel + ':enabled').color, '#fff');
  for (const [css, selector] of [[grid, gridCancel], [profile, profileLabel]]) {
    assert.equal(declarations(css, selector + ':enabled').opacity, '1');
    assert.equal(declarations(css, selector + ':enabled').cursor, 'pointer');
    assert.equal(declarations(css, selector + '[aria-busy="true"]').opacity, '.55');
    assert.equal(declarations(css, selector + '[aria-busy="true"]').cursor, 'wait');
  }
  assert.equal(declarations(grid, gridCancel + ':enabled:active::before').background, 'linear-gradient(#41414a, #41414a)');
  assert.equal(declarations(profile, profileCancel + ':enabled:active')['--profile-action-background'], 'linear-gradient(#41414a, #41414a)');
});

test('View terms is an unobtrusive disclosure that keeps its touch target, focus ring and content', () => {
  const terms = 'body .ir-guest .ir-terms';
  assert.equal(declarations(grid, terms).border, '0');
  assert.equal(declarations(grid, terms).background, 'none');
  const summary = declarations(grid, terms + ' summary');
  assert.equal(summary.width, 'fit-content');
  assert.equal(summary['min-height'], '44px');
  assert.equal(summary['font-size'], '12px');
  assert.equal(summary['font-weight'], '500');
  assert.equal(summary.cursor, 'pointer');
  assert.match(declarations(grid, terms + ' summary:focus-visible').outline, /2px solid/);
  const roster = read('app/internal/InternalRoster.tsx');
  assert.match(roster, /<details className="ir-terms"><summary>View terms<\/summary><div>/);
  assert.match(roster, /TABLE_REQUEST_NOTICE/);
  assert.match(roster, /href=\{ACCESS_TERMS_HREF\}/);
});

test('new requests use the saved club accent with a violet fallback and keep the request state machine', () => {
  assert.match(declarations(grid, 'body.dancr-button-system .ir-shell.ir-guest button.ir-table-request::before').background, /#6930c4, #482083/);
  const request = declarations(profile, 'html.internal-profile-embed [data-internal-table-request]:not([data-request-sent])');
  assert.equal(request['--profile-action-background'], 'linear-gradient(var(--internal-profile-accent, #6d28d9), var(--internal-profile-accent, #6d28d9))');
  assert.equal(request['--profile-action-label'], 'var(--internal-profile-on-accent, #fff)');
  assert.match(read('src/live-shell/app/internal-profile-bridge.js'), /confirmed \|\| internalTableRequest.busy \|\| \(sent \? !internalTableRequest.requestId : !profile.scheduled\)/);
});

test('card feedback floats above its action, stays within each grid edge and has a touch-sized dismiss control', () => {
  const notice = 'body .ir-shell.ir-guest .ir-dancer-notice';
  const styles = declarations(grid, notice);
  assert.equal(styles.position, 'absolute', 'feedback cannot change portrait size or grid spacing');
  assert.equal(styles.bottom, '52px', 'leave the 44px request button unobstructed');
  assert.equal(styles.left, '0');
  assert.equal(styles.width, 'min(240px, calc(100vw - 24px))');
  const middle = declarations(grid, 'body .ir-shell.ir-guest .ir-dancer:nth-child(3n + 2) .ir-dancer-notice');
  assert.equal(middle.left, '50%');
  assert.equal(middle.transform, 'translateX(-50%)');
  const right = declarations(grid, 'body .ir-shell.ir-guest .ir-dancer:nth-child(3n) .ir-dancer-notice');
  assert.equal(right.left, 'auto'); assert.equal(right.right, '0');
  const card = declarations(grid, 'body .ir-shell.ir-guest .ir-directory-grid .ir-dancer[data-has-notice]');
  assert.equal(card.overflow, 'visible'); assert.equal(card['z-index'], '5');
  const dismiss = declarations(grid, 'body.dancr-button-system .ir-shell.ir-guest button.ir-dancer-notice-dismiss');
  assert.equal(dismiss.position, 'absolute');
  assert.equal(dismiss.width, '44px'); assert.equal(dismiss.height, '44px');
  assert.equal(dismiss['align-items'], 'center'); assert.equal(dismiss['justify-content'], 'center');
});
