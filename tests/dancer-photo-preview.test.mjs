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
  let cursor = 0, dirty = true, tree, nextTimer = 0, refreshes = 0;
  const jsx = (type, props, key) => ({ type, props, key });
  vm.runInNewContext(code, { exports, URL, window: {
    setTimeout: (fn, delay) => { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  }, require(name) {
    if (name.endsWith('.css')) return {};
    if (name === './dancer-media-status') return { refreshDancerPhotoPreviews: () => { refreshes++; } };
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
    update(nextProps, cached) { Object.assign(props, nextProps); return render(cached); },
    get refreshes() { return refreshes; },
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
  assert.equal(ui.refreshes, 1, 'renew the private preview through the authenticated profile refresh');
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

const signed = (file, token) => `https://project.supabase.co/storage/v1/object/sign/review/owner/${file}?token=${token}`;

for (const file of ['main.jpg', 'main.jpg.avatar.jpg']) test(`${file}: renewing a private URL preserves the loaded preview and its image node`, () => {
  const first = signed(file, 'old'), next = signed(file, 'new');
  const ui = fixture({ src: first, style: { objectPosition: '50% 25%' }, loading: 'lazy' });
  ui.render(); ui.image.props.onLoad(); ui.render();
  const componentKey = ui.wrapper({ src: first }).key, imageKey = ui.image.key;
  ui.update({ src: next }, { complete: false, naturalWidth: 200 });
  assert.equal(ui.wrapper({ src: next }).key, componentKey, 'token renewal must not remount the preview');
  assert.equal(ui.image.key, imageKey, 'the browser keeps its current decoded image while loading the renewed URL');
  assert.equal(ui.image.props.src, next, 'the private URL still refreshes');
  assert.equal(ui.image.props.style.visibility, 'visible');
  assert.equal(ui.image.props.style.objectPosition, '50% 25%');
  assert.equal(ui.image.props.loading, 'lazy');
  assert.equal(ui.placeholder, null);
  assert.equal(ui.timers.size, 0);
  ui.image.props.onLoad(); ui.render();
  assert.equal(ui.placeholder, null);
});

test('an exhausted private URL receives a fresh retry budget when its token is renewed', () => {
  const ui = fixture({ src: signed('main.jpg', 'expired') }); ui.render();
  for (let i = 0; i < 3; i++) { ui.image.props.onError(); ui.render(); ui.tick(); }
  ui.image.props.onError(); ui.render(); assert.equal(ui.timers.size, 0);
  const imageKey = ui.image.key;
  ui.update({ src: signed('main.jpg', 'renewed') }, { complete: false, naturalWidth: 0 });
  assert.equal(ui.placeholder.props['aria-label'], 'Main photo: loading preview');
  assert.equal(ui.image.key, imageKey);
  ui.image.props.onError(); ui.render();
  assert.equal(ui.timers.values().next().value.delay, 1500);
  ui.tick(); ui.image.props.onLoad(); ui.render();
  assert.equal(ui.image.props.style.visibility, 'visible');
  assert.equal(ui.timers.size, 0);
});

test('a recovered preview stays mounted when a later refresh renews its URL', () => {
  const ui = fixture({ src: signed('main.jpg', 'first') }); ui.render();
  ui.image.props.onError(); ui.render(); ui.tick();
  ui.image.props.onLoad(); ui.render(); const imageKey = ui.image.key;
  ui.update({ src: signed('main.jpg', 'next') }, { complete: false, naturalWidth: 200 });
  assert.equal(ui.image.key, imageKey, 'reset the retry budget without discarding the recovered image');
  assert.equal(ui.image.props.style.visibility, 'visible');
  assert.equal(ui.placeholder, null);
});

test('renewing a failed URL cancels the old retry timer', () => {
  const ui = fixture({ src: signed('main.jpg', 'expired') }); ui.render();
  ui.image.props.onError(); ui.render(); const oldTimer = [...ui.timers.keys()][0];
  ui.update({ src: signed('main.jpg', 'renewed') }, { complete: false, naturalWidth: 0 });
  assert.equal(ui.timers.has(oldTimer), false);
  assert.equal(ui.timers.size, 0);
  ui.image.props.onLoad(); ui.render(); assert.equal(ui.placeholder, null);
});

test('replacement photos, changed crops, owners and storage origins reset the private preview', () => {
  const ui = fixture(), first = signed('main.jpg', 'first');
  for (const next of [signed('replacement.jpg', 'next'), signed('main.jpg.avatar.jpg', 'next'),
    first.replace('/owner/', '/other-owner/'), first.replace('project.supabase.co', 'other.supabase.co'),
    `${first}&v=2`, `${first}&width=100`, '', 'blob:new-upload']) {
    assert.notEqual(ui.wrapper({ src: first }).key, ui.wrapper({ src: next }).key);
  }
  const rendered = first.replace('/object/sign/', '/render/image/sign/') + '&width=80&height=80';
  assert.equal(ui.wrapper({ src: rendered }).key, ui.wrapper({ src: rendered.replace('token=first', 'token=next') }).key);
  assert.notEqual(ui.wrapper({ src: rendered }).key, ui.wrapper({ src: rendered.replace('width=80', 'width=100') }).key);
});
