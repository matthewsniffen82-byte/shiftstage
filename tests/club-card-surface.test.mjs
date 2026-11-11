import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/club-logos.js', import.meta.url), 'utf8');
const surfaceSelector = '#results :is(.club-brand-card, .club-brand-hero)';
const cityPinSelector = '#cityPickerField :is(.city-picker-trigger-icon, .home-city-select-icon), #locationBtn > .discovery-location-icon';
const rosterPinSelector = '#results .home-dancer-grid-venue > [data-action-icon="pin"]';
const circleSelector = '.club-secondary-actions > :is(button, a), .club-hero-controls > button';

function fixture({ userAgent = 'Android SamsungBrowser/30.0', canvasAvailable = true, initial = true, city = false, roster = false } = {}) {
  const cards = [], canvases = [], cityPins = [], rosterPins = [];
  let mutation;
  function card({ color = '#1c1c1e', publicCard = true } = {}) {
    const node = {
      color, publicCard, isConnected: true, surface: null, insertions: 0,
      closest: selector => selector === surfaceSelector && publicCard ? node : null,
      querySelector: () => node.surface,
      buttons: [], pins: [], circles: [],
      querySelectorAll: selector => selector === '.free-entry-cta' ? node.buttons : selector === '[data-action-icon="pin"]' ? node.pins : selector === circleSelector ? node.circles : [],
      prepend(canvas) { node.surface = canvas; node.insertions++; },
    };
    cards.push(node);
    return node;
  }
  const first = initial ? card() : null;
  function locationPin(scope, pins) {
    const path = { tagName: 'path', getAttribute: () => 'M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z' };
    const svg = { querySelectorAll: () => [path] };
    const pin = { color: '#6d28ff', isConnected: true, surface: null,
      closest: selector => selector === scope ? pin : null,
      querySelector: selector => selector === 'svg' ? svg : pin.surface,
      querySelectorAll: () => [], append(canvas) { pin.surface = canvas; } };
    pins.push(pin);
    return pin;
  }
  const cityPin = () => locationPin(cityPinSelector, cityPins);
  const rosterPin = () => locationPin(rosterPinSelector, rosterPins);
  if (city) { cityPin(); cityPin(); }
  if (roster) rosterPin();
  const context = {
    window: { navigator: { userAgent }, addEventListener() {} },
    HTMLImageElement: class {},
    Path2D: class { constructor(path) { this.path = path; } },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    getComputedStyle: node => ({ getPropertyValue: name => node.tokens?.[name] ?? node.color, strokeWidth: '2.5' }),
    document: {
      readyState: 'complete', documentElement: { classList: { contains: name => name === 'is-android' && userAgent.includes('Android') } }, addEventListener() {},
      querySelectorAll(selector) {
        if (selector === surfaceSelector) return cards.filter(node => node.publicCard);
        if (selector === cityPinSelector) return cityPins;
        if (selector === rosterPinSelector) return rosterPins;
        return [];
      },
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const paint = { fillStyle: '', fills: [], strokes: [], fillRect(...args) { this.rect = args; this.fills.push(this.fillStyle); }, scale() {}, beginPath() {},
          arc(...args) { this.circle = args; }, stroke(path) { this.strokes.push(path?.path || 'circle'); } };
        const canvas = { paint, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
          getContext: () => canvasAvailable ? paint : null };
        canvases.push(canvas);
        return canvas;
      },
    },
  };
  vm.runInNewContext(source, context);
  return { first, card, canvases, cityPins, cityPin, rosterPins, rosterPin, api: context.window.MydancrClubLogos,
    insert: node => mutation([{ type: 'childList', addedNodes: [node] }]) };
}

test('Samsung public cards paint the shared charcoal beneath their content', () => {
  const f = fixture();
  const canvas = f.first.surface;
  assert.equal(canvas.paint.fillStyle, '#1c1c1e');
  assert.deepEqual(canvas.paint.rect, [0, 0, 1, 1]);
  assert.equal(canvas.width, 1);
  assert.equal(canvas.height, 1);
  assert.equal(canvas.attributes['aria-hidden'], 'true');
  assert.equal(canvas.className, 'club-brand-surface');
  const custom = f.card({ color: ' #242426 ' });
  f.insert(custom);
  assert.equal(custom.surface.paint.fillStyle, '#242426', 'read the token instead of imposing a second palette');
});

test('inserted and refreshed cards get one surface without duplicating it', () => {
  const f = fixture({ initial: false });
  const added = f.card();
  f.insert(added);
  f.insert(added);
  assert.equal(added.insertions, 1);
  added.surface = null;
  f.insert({ closest: () => added, querySelectorAll: () => [] });
  assert.equal(added.insertions, 2, 'restore the surface after the card content is replaced');
  const removed = f.card();
  removed.isConnected = false;
  f.insert(removed);
  assert.equal(removed.surface, null);
});

test('Safari, ordinary Android Chrome and React dashboard cards retain their CSS surfaces', () => {
  for (const userAgent of ['iPhone AppleWebKit/605.1 Safari/604.1', 'Android Chrome/143.0', '']) {
    const f = fixture({ userAgent });
    f.insert(f.first);
    assert.equal(f.canvases.length, 0);
  }
  const samsung = fixture({ initial: false });
  const savedCard = samsung.card({ publicCard: false });
  samsung.insert(savedCard);
  assert.equal(samsung.canvases.length, 0);
});

test('unavailable canvas falls back to CSS without breaking club logos', () => {
  const f = fixture({ canvasAvailable: false });
  assert.equal(f.first.surface, null);
  assert.equal(typeof f.api.fit, 'function');
});

test('club buttons and original pin paths use the same violet without duplicate paint', () => {
  const f = fixture();
  const button = { color: '#6d28ff', surface: null, querySelector() { return this.surface; }, prepend(canvas) { this.surface = canvas; } };
  const path = { tagName: 'path', getAttribute: () => 'M12 2L20 10L12 22L4 10Z' };
  const circle = { tagName: 'circle', getAttribute: key => ({ cx: '12', cy: '10', r: '2.5' })[key] };
  const svg = { querySelectorAll: () => [path, circle] };
  const pin = { color: '#6d28ff', surface: null, querySelector(selector) { return selector === 'svg' ? svg : this.surface; }, append(canvas) { this.surface = canvas; } };
  f.first.buttons.push(button); f.first.pins.push(pin);
  f.insert(f.first);
  assert.equal(button.surface.paint.fillStyle, '#6d28ff');
  assert.equal(pin.surface.paint.strokeStyle, button.surface.paint.fillStyle);
  assert.deepEqual(pin.surface.paint.strokes, [path.getAttribute(), 'circle']);
  assert.deepEqual(pin.surface.paint.circle.slice(0, 3), [12, 10, 2.5]);
  assert.equal(pin.surface.attributes['aria-hidden'], 'true');
  assert.equal(pin.querySelector('svg'), svg, 'keep the original SVG for fallback');
  const count = f.canvases.length;
  f.insert(f.first);
  assert.equal(f.canvases.length, count);
});

test('city selector pins receive the same violet on initial load and replacement without duplicate paint', () => {
  const f = fixture({ city: true, initial: false });
  for (const pin of f.cityPins) {
    assert.equal(pin.surface.paint.strokeStyle, '#6d28ff');
    assert.equal(pin.surface.attributes['aria-hidden'], 'true');
    assert.ok(pin.querySelector('svg'), 'retain the original pin for fallback');
    f.insert(pin);
    f.insert({ closest: () => pin, querySelectorAll: () => [] });
  }
  assert.equal(f.canvases.length, 2);
  const added = f.cityPin();
  f.insert(added);
  assert.equal(added.surface.paint.strokeStyle, '#6d28ff');
  const removed = f.cityPin();
  removed.isConnected = false;
  f.insert(removed);
  assert.equal(removed.surface, null);
});

test('city selector keeps its original SVG outside Samsung or when canvas is unavailable', () => {
  for (const options of [{ userAgent: 'Android Chrome/143.0' }, { userAgent: 'iPhone Safari/604.1' }, { canvasAvailable: false }]) {
    const f = fixture({ ...options, city: true, initial: false });
    for (const pin of f.cityPins) {
      f.insert(pin);
      assert.equal(pin.surface, null);
      assert.ok(pin.querySelector('svg'));
    }
  }
});

test('Android roster pins paint the brand token on load and refresh, including cards inserted as a group', () => {
  for (const userAgent of ['Android Chrome/143.0', 'Android SamsungBrowser/30.0']) {
    const f = fixture({ userAgent, initial: false, roster: true });
    assert.equal(f.rosterPins[0].surface.paint.strokeStyle, '#6d28ff');
    const added = f.rosterPin();
    added.color = '#d99eff';
    added.tokens = { '--dancr-color-brand-primary': '#6d28ff' };
    f.insert({ querySelectorAll: selector => selector === rosterPinSelector ? [added] : [] });
    assert.equal(added.surface.paint.strokeStyle, '#6d28ff');
    assert.equal(added.surface.attributes['aria-hidden'], 'true');
    f.insert(added);
    assert.equal(f.canvases.length, 2);
  }
});

test('roster pins retain the original SVG on iOS and when painting is unavailable', () => {
  for (const options of [{ userAgent: 'iPhone Safari/604.1' }, { canvasAvailable: false }]) {
    const f = fixture({ ...options, initial: false, roster: true });
    assert.equal(f.rosterPins[0].surface, null);
    assert.ok(f.rosterPins[0].querySelector('svg'));
  }
});

test('Samsung circle fills composite the shared tint over the club surface and recover after action updates', () => {
  const f = fixture();
  const button = { tokens: { '--dancr-color-surface-club': '#1c1c1e', '--dancr-circle-background': 'rgba(0, 0, 0, .45)' },
    surface: null, querySelector() { return this.surface; }, prepend(canvas) { this.surface = canvas; } };
  f.first.circles.push(button);
  f.insert(f.first);
  assert.deepEqual(button.surface.paint.fills, ['#1c1c1e', 'rgba(0, 0, 0, .45)']);
  assert.equal(button.surface.className, 'club-circle-fill');
  assert.equal(button.surface.attributes['aria-hidden'], 'true');
  const count = f.canvases.length;
  f.insert(f.first);
  assert.equal(f.canvases.length, count);
  button.surface = null;
  f.insert({ closest: selector => selector === surfaceSelector ? f.first : null, querySelectorAll: () => [] });
  assert.equal(f.canvases.length, count + 1, 'restore fill after follow/share replaces its contents');
  assert.deepEqual(button.surface.paint.fills, ['#1c1c1e', 'rgba(0, 0, 0, .45)']);
});

test('circle controls retain CSS fills outside Samsung and when canvas is unavailable', () => {
  for (const options of [{ userAgent: 'Android Chrome/143.0' }, { userAgent: 'iPhone Safari/604.1' }, { canvasAvailable: false }]) {
    const f = fixture(options);
    const button = { querySelector: () => null, prepend() { assert.fail('must keep CSS fallback'); } };
    f.first.circles.push(button);
    f.insert(f.first);
  }
});
