import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../public/club-logos.js', import.meta.url), 'utf8');
const surfaceSelector = '#results :is(.club-brand-card, .club-brand-hero)';

function fixture({ userAgent = 'Android SamsungBrowser/30.0', canvasAvailable = true, initial = true } = {}) {
  const cards = [], canvases = [];
  let mutation;
  function card({ color = '#1c1c1e', publicCard = true } = {}) {
    const node = {
      color, publicCard, isConnected: true, surface: null, insertions: 0,
      closest: selector => selector === surfaceSelector && publicCard ? node : null,
      querySelector: () => node.surface,
      buttons: [], pins: [],
      querySelectorAll: selector => selector === '.free-entry-cta' ? node.buttons : selector === '[data-action-icon="pin"]' ? node.pins : [],
      prepend(canvas) { node.surface = canvas; node.insertions++; },
    };
    cards.push(node);
    return node;
  }
  const first = initial ? card() : null;
  const context = {
    window: { navigator: { userAgent }, addEventListener() {} },
    HTMLImageElement: class {},
    Path2D: class { constructor(path) { this.path = path; } },
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    getComputedStyle: node => ({ getPropertyValue: () => node.color, strokeWidth: '2.5' }),
    document: {
      readyState: 'complete', documentElement: {}, addEventListener() {},
      querySelectorAll: selector => selector === surfaceSelector ? cards.filter(node => node.publicCard) : [],
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const paint = { fillStyle: '', strokes: [], fillRect(...args) { this.rect = args; }, scale() {}, beginPath() {},
          arc(...args) { this.circle = args; }, stroke(path) { this.strokes.push(path?.path || 'circle'); } };
        const canvas = { paint, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; },
          getContext: () => canvasAvailable ? paint : null };
        canvases.push(canvas);
        return canvas;
      },
    },
  };
  vm.runInNewContext(source, context);
  return { first, card, canvases, api: context.window.MydancrClubLogos,
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
