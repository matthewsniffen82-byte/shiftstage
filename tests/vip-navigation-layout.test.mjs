import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { compileVip, dashboardHarness } from './helpers/vip-dashboard-fixture.mjs';
import { plannerHarness } from './helpers/vip-planner-fixture.mjs';

function measurement({ observer = true, active = true, mounted = true } = {}) {
  let height = 74.25, cleanup, resize, observed, disconnected = false;
  const values = new Map(), events = new Map();
  const element = { getBoundingClientRect: () => ({ height }) };
  const surface = { style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) } };
  const window = {
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name),
    ...(observer ? { ResizeObserver: class {
      constructor(callback) { resize = callback; }
      observe(target) { observed = target; }
      disconnect() { disconnected = true; }
    } } : {}),
  };
  const { useVipElementHeight: measureHeight } = compileVip('app/vip/useVipElementHeight.ts', {
    react: { useEffect: callback => { cleanup = callback(); } },
  }, { window });
  measureHeight({ current: mounted ? element : null }, { current: surface }, '--vip-nav-height', active);
  return { values, events, element, observed, disconnected: () => disconnected,
    resize: next => { height = next; resize?.(); }, orientation: next => { height = next; events.get('resize')?.(); },
    cleanup: () => cleanup?.() };
}

test('sticky offsets track actual control height including wrapped labels, zoom and orientation changes', () => {
  const ui = measurement();
  assert.equal(ui.observed, ui.element);
  assert.equal(ui.values.get('--vip-nav-height'), '75px');
  ui.resize(112.5); assert.equal(ui.values.get('--vip-nav-height'), '113px');
  ui.orientation(66); assert.equal(ui.values.get('--vip-nav-height'), '66px');
  ui.resize(0); assert.equal(ui.values.get('--vip-nav-height'), '66px', 'hidden controls must not erase the last useful size');
  ui.cleanup(); assert.equal(ui.disconnected(), true); assert.equal(ui.events.size, 0); assert.equal(ui.values.size, 0);
});

test('height measurements degrade safely without ResizeObserver and ignore inactive or unmounted controls', () => {
  const ui = measurement({ observer: false });
  ui.orientation(120); assert.equal(ui.values.get('--vip-nav-height'), '120px');
  ui.cleanup(); assert.equal(ui.events.size, 0);
  for (const options of [{ active: false }, { mounted: false }]) {
    const inactive = measurement(options);
    assert.equal(inactive.values.size, 0); assert.equal(inactive.events.size, 0); assert.equal(inactive.observed, undefined);
  }
});

test('navigation and the complete dancer header own measured refs while the roster uses document scrolling', async () => {
  const ui = dashboardHarness(); await ui.settle();
  assert.ok(ui.nodes().find(node => node.type === 'main').props.ref);
  assert.ok(ui.nodes().find(node => node.type === 'nav').props.ref); ui.unmount();
  const planner = plannerHarness();
  const header = planner.nodes().find(node => node.props?.className === 'vip-roster-header');
  assert.ok(header.props.ref);
  assert.ok(planner.nodes(header).some(node => node.type === 'h3' && node.props.children === 'Choose your dancers'));
  assert.ok(planner.nodes(header).some(node => node.props?.type === 'search'));
  assert.ok(planner.nodes(header).some(node => node.props?.className === 'vip-roster-filters'));
  const grid = planner.nodes().find(node => node.props?.className === 'vip-dancers');
  assert.ok(!planner.nodes(header).includes(grid));
  assert.equal(grid.props.tabIndex, undefined);
  assert.ok(planner.nodes(grid).some(node => node.props?.className === 'vip-dancer-follow'));
});

test('the dancer box sticks from its heading below safe-area-aware navigation instead of from the filter buttons', () => {
  const root = postcss.parse(readFileSync(new URL('../app/vip/vip-working-alerts.css', import.meta.url), 'utf8'));
  const rules = [];
  root.walkRules(rule => rules.push(rule));
  const values = selector => Object.fromEntries(rules.filter(rule => rule.selector === selector && rule.parent.type === 'root')
    .flatMap(rule => rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value])));
  const prefix = 'body.dancr-button-system #vip-dashboard ';
  const nav = values(prefix + '.vip-dashboard-nav');
  const filters = values(prefix + '.vip-roster-filters[role=group]');
  const header = values(prefix + '.vip-roster-header');
  assert.equal(nav.top, 'env(safe-area-inset-top, 0px)');
  assert.equal(filters.position, undefined);
  assert.equal(header.position, 'sticky');
  assert.equal(header.top, 'calc(env(safe-area-inset-top, 0px) + var(--vip-nav-height))');
  assert.equal(header['z-index'], '4');
  assert.equal(header['padding-block'], '4px'); assert.equal(header['box-shadow'], 'none');
  assert.equal(header.background, 'linear-gradient(#4a365f, #4a365f) top / 100% 1px no-repeat, linear-gradient(#100c17, #100c17)');
  assert.equal(filters['grid-template-columns'], 'repeat(2, minmax(0, 1fr))');
  const wideFilters = rules.find(rule => rule.parent.params === '(min-width: 900px)' && rule.selector === prefix + '.vip-roster-filters[role=group]');
  assert.equal(wideFilters.nodes.find(node => node.prop === 'grid-template-columns').value, 'repeat(4, minmax(0, 1fr))');
  const grid = values(prefix + '.vip-dancers');
  assert.equal(grid['max-height'], 'none'); assert.equal(grid.overflow, 'visible'); assert.equal(grid['overscroll-behavior-y'], 'auto');
  const tile = values(prefix + ':is(.vip-dancer, .vip-dancer a, .vip-dancer button, .vip-dancer input)');
  assert.match(tile['scroll-margin-top'], /var\(--vip-nav-height\).*var\(--vip-roster-header-height\)/);
  assert.match(tile['scroll-margin-bottom'], /120px.*safe-area-inset-bottom/);
  const short = rules.find(rule => rule.parent.params === '(max-height: 500px)' && rule.selector.includes('.vip-dashboard-nav'));
  assert.ok(short.selector.includes('.vip-roster-header'));
  assert.ok(short.nodes.some(node => node.prop === 'position' && node.value === 'static'));
});
