import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('app/dashboard/DancerPhotoPreview.tsx', 'utf8') + '\nexport { PhotoPreview };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture(props = {}) {
  const slots = [], effects = [], timers = new Map(), exports = {};
  let cursor = 0, dirty = true, tree, nextTimer = 0;
  const jsx = (type, props, key) => ({ type, props, key });
  vm.runInNewContext(code, { exports, window: {
    setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  }, require(name) {
    if (name.endsWith('.css')) return {};
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react') return {
      useRef: initial => slots[cursor++] ||= { current: initial },
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value;
          if (!Object.is(next, slots[i])) { slots[i] = next; dirty = true; } }];
      },
      useEffect(fn, deps) {
        const i = cursor++, old = slots[i];
        if (!old || deps.some((v, n) => !Object.is(v, old.deps[n]))) effects.push(() => {
          old?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
        });
      },
    };
    throw Error(name);
  } });
  function render(cached) {
    do {
      dirty = false; cursor = 0;
      tree = exports.PhotoPreview({ src: '/processing.jpg', alt: 'Main photo', ...props });
      if (cached) tree.props.children[0].props.ref.current = cached;
      effects.splice(0).forEach(fn => fn());
    } while (dirty);
    return tree;
  }
  return { render, timers, wrapper: props => exports.default(props),
    get image() { return tree.props.children[0]; },
    get placeholder() { return tree.props.children[1]; },
    tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('a loading preview hides broken-image UI, then reveals the loaded photo with its crop intact', () => {
  const ui = fixture({ style: { objectPosition: '50% 25%' } }); ui.render();
  assert.equal(ui.image.props.style.visibility, 'hidden');
  assert.equal(ui.placeholder.props['aria-label'], 'Main photo: loading preview');
  ui.image.props.onLoad(); ui.render();
  assert.equal(ui.image.props.style.visibility, 'visible');
  assert.equal(ui.image.props.style.objectPosition, '50% 25%');
  assert.equal(ui.placeholder, null);
});

test('temporary preview failure retries automatically and recovers without a duplicate upload', () => {
  const ui = fixture(); ui.render(); const first = ui.image.key;
  ui.image.props.onError(); ui.render();
  assert.equal(ui.placeholder.props['aria-label'], 'Main photo: loading preview');
  assert.equal(ui.timers.values().next().value.delay, 1500);
  ui.tick(); assert.notEqual(ui.image.key, first);
  ui.image.props.onLoad(); ui.render();
  assert.equal(ui.image.props.style.visibility, 'visible');
  assert.equal(ui.timers.size, 0);
});

test('repeated failures stop retrying and show a clear unavailable state', () => {
  const ui = fixture(); ui.render();
  for (let i = 0; i < 3; i++) { ui.image.props.onError(); ui.render(); ui.tick(); }
  ui.image.props.onError(); ui.render();
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.placeholder.props['aria-label'], 'Main photo: preview unavailable');
  assert.equal(ui.image.props.style.visibility, 'hidden');
});

test('already cached previews settle even if their load event was missed', () => {
  const loaded = fixture(); loaded.render({ complete: true, naturalWidth: 200 });
  assert.equal(loaded.image.props.style.visibility, 'visible');
  const failed = fixture(); failed.render({ complete: true, naturalWidth: 0 });
  assert.equal(failed.image.props.style.visibility, 'hidden');
  assert.equal(failed.timers.size, 1);
});

test('new processing URLs reset readiness and unmount cancels outstanding retries', () => {
  const ui = fixture(); ui.render();
  assert.notEqual(ui.wrapper({ src: '/temp.jpg' }).key, ui.wrapper({ src: '/review.jpg' }).key);
  assert.notEqual(ui.wrapper({ src: '/review.jpg?token=expired' }).key, ui.wrapper({ src: '/review.jpg?token=renewed' }).key);
  ui.image.props.onError(); ui.render(); assert.equal(ui.timers.size, 1);
  ui.unmount(); assert.equal(ui.timers.size, 0);
});

test('empty sources do not emit broken image elements or start retry timers', () => {
  const ui = fixture({ src: '' }); ui.render();
  assert.equal(ui.image, null);
  assert.equal(ui.placeholder.props['aria-label'], 'Main photo: preview unavailable');
  assert.equal(ui.timers.size, 0);
});
