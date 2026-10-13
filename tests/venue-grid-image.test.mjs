import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/dashboard/VenueGridImage.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source + '\nexport { LoadedGridImage };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture(props = {}) {
  let state = 'loading', effect;
  const ref = { current: null }, exports = {};
  vm.runInNewContext(code, { exports, require(name) {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react') return {
      useState: () => [state, next => { state = next; }],
      useRef: () => ref,
      useEffect: callback => { effect = callback; },
    };
    throw new Error(name);
  } });
  return {
    wrapper: next => exports.default(next),
    render: () => exports.LoadedGridImage({ src: '/photo.jpg', ...props }),
    cached: image => { ref.current = image; effect(); },
  };
}
const image = tree => tree.props.children[0];

test('grid photos keep their placeholder until loaded, with eager opening and deferred later images', () => {
  const app = fixture({ priority: true });
  const pending = image(app.render());
  assert.equal(pending.props['data-venue-image-state'], 'loading');
  assert.equal(pending.props.loading, 'eager');
  assert.equal(pending.props.fetchPriority, 'high');
  pending.props.onLoad();
  assert.equal(image(app.render()).props['data-venue-image-state'], 'ready');
  assert.equal(image(fixture({ lazy: true }).render()).props.loading, 'lazy');
});

test('cached success and image failure settle without leaving a permanent loading placeholder', () => {
  const app = fixture();
  app.render(); app.cached({ complete: true, naturalWidth: 320 });
  assert.equal(image(app.render()).props['data-venue-image-state'], 'ready');
  image(app.render()).props.onError();
  assert.equal(image(app.render()).props['data-venue-image-state'], 'error');
  assert.equal(app.render().props.children[1].props.children, 'Photo unavailable');
  const broken = fixture(); broken.render(); broken.cached({ complete: true, naturalWidth: 0 });
  assert.equal(image(broken.render()).props['data-venue-image-state'], 'error');
});

test('missing photos differ from pending private downloads; changed sources reset image readiness', () => {
  const app = fixture();
  assert.equal(app.wrapper({ pending: true }).props['data-venue-image-state'], 'loading');
  assert.equal(app.wrapper({}).props.children, 'Photo unavailable');
  const original = app.wrapper({ src: '/one.jpg', srcSet: '/one-large.jpg 2x' });
  assert.equal(original.key, app.wrapper({ src: '/one.jpg', srcSet: '/one-large.jpg 2x' }).key);
  assert.notEqual(original.key, app.wrapper({ src: '/two.jpg' }).key);
  assert.notEqual(original.key, app.wrapper({ src: '/one.jpg', srcSet: '/one-new.jpg 2x' }).key);
});
