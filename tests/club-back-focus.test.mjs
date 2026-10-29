import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import postcss from 'postcss';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('src/live-shell/app/22-create-home-tv-landing-preloader.js');
const focusStart = source.slice(source.indexOf('    function focusVenueProfileStart('), source.indexOf('    function closeVenueProfile('));
const css = postcss.parse(read('public/club-brand-cards.css'));

function fixture() {
  const attributes = new Set(), frames = [], events = new Map();
  let focused = 0;
  const back = {
    toggleAttribute(name, enabled) { if (enabled) attributes.add(name); else attributes.delete(name); },
    removeAttribute(name) { attributes.delete(name); },
    focus(options) { assert.equal(options.preventScroll, true); focused++; },
    addEventListener(name, callback) { events.set(name, callback); },
  };
  const context = { requestAnimationFrame: callback => frames.push(callback), results: { scrollTo() {}, querySelector: () => back } };
  vm.runInNewContext(focusStart, context);
  return {
    open(options) { context.focusVenueProfileStart(options); while (frames.length) frames.shift()(); },
    blur() { events.get('blur')?.(); },
    autoFocused: () => attributes.has('data-auto-focus'),
    focused: () => focused,
  };
}

test('touch opening keeps Back focused for navigation and clears the automatic marker on blur', () => {
  const f = fixture();
  f.open();
  assert.equal(f.focused(), 1);
  assert.equal(f.autoFocused(), true);
  f.blur();
  assert.equal(f.autoFocused(), false);
});

test('keyboard opening never suppresses the Back focus indicator', () => {
  const f = fixture();
  f.open({ showFocusRing: true });
  assert.equal(f.focused(), 1);
  assert.equal(f.autoFocused(), false);
});

test('the club palette hides only automatic Back focus and preserves keyboard outlines', () => {
  const rules = [];
  css.walkRules(rule => { if (rule.nodes.some(node => node.prop === 'outline')) rules.push(rule); });
  const automatic = rules.find(rule => rule.selector.includes('.venue-detail-close[data-auto-focus]'));
  assert.ok(automatic, 'the club palette must handle the existing automatic-focus marker');
  assert.equal(automatic.parent.name, 'layer');
  assert.equal(automatic.parent.params, 'dancr-palette');
  assert.match(automatic.selector, /\.club-hero-controls > \.venue-detail-close\[data-auto-focus\]:is\(:focus, :focus-visible\)/);
  const outline = automatic.nodes.find(node => node.prop === 'outline');
  assert.equal(outline.value, '0');
  assert.equal(outline.important, true);
  const keyboard = rules.find(rule => rule.selector.includes('.club-brand-hero') && rule.selector.includes(':focus-visible:not([data-auto-focus])'));
  assert.ok(keyboard, 'keyboard navigation must retain a visible ring');
  assert.match(keyboard.nodes.find(node => node.prop === 'outline').value, /^2px solid/);
  assert.equal(keyboard.parent, automatic.parent, 'the suppression must share the important palette layer');
});
