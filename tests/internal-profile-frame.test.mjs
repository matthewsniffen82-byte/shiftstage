import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const code = ts.transpileModule(readFileSync('app/internal/InternalFullProfile.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture() {
  const refs = [], messages = [], timers = new Set(), exports = {};
  const child = { postMessage: message => messages.push(message) };
  let index = 0, effects = [], cleanups = [], receive;
  const context = {
    exports,
    window: {
      location: { origin: 'https://example.invalid' },
      setTimeout: callback => { timers.add(callback); return callback; }, clearTimeout: callback => timers.delete(callback),
      addEventListener: (_name, handler) => { receive = handler; }, removeEventListener() {},
    },
    require: name => name === 'react' ? {
      useRef: initial => { const slot = index++; return refs[slot] ||= { current: slot === 0 ? { contentWindow: child } : initial }; },
      useCallback: callback => callback, useEffect: effect => effects.push(effect),
    } : name === 'react/jsx-runtime' ? require(name) : {},
  };
  vm.runInNewContext(code, context);
  return {
    messages, timers,
    render(props) {
      cleanups.forEach(cleanup => cleanup?.()); effects = []; index = 0;
      const tree = exports.InternalFullProfile(props);
      cleanups = effects.map(effect => effect());
      return tree;
    },
    send(data, overrides = {}) { receive({ origin: context.window.location.origin, source: child, data, ...overrides }); },
  };
}

test('an idle viewer warms without a timeout and keeps the same frame URL when a profile opens', () => {
  const f = fixture();
  const props = { profile: null, onClose: () => assert.fail('An idle viewer cannot close a profile') };
  const idle = f.render(props);
  assert.equal(f.timers.size, 0);
  f.send({ type: 'mydancr:internal-profile-ready' });
  assert.equal(f.messages.at(-1).type, 'mydancr:internal-profile-clear');
  const loading = f.render({ ...props, profileId: id });
  assert.equal(loading.props.src, idle.props.src);
  assert.equal(f.timers.size, 1);
  const open = f.render({ ...props, profile: { id }, profileId: id });
  assert.equal(open.props.src, idle.props.src);
  assert.equal(f.messages.at(-1).type, 'mydancr:internal-profile-open');
  assert.equal(f.messages.at(-1).profile.id, id);
});

test('ready, error and close events from old profiles or other frames cannot affect the active profile', () => {
  const f = fixture();
  const calls = [];
  f.render({ profile: { id }, onReady: () => calls.push('ready'), onError: () => calls.push('error'), onClose: () => calls.push('close') });
  for (const type of ['shown', 'error', 'close']) {
    const data = { type: `mydancr:internal-profile-${type}`, profileId: id };
    f.send({ ...data, profileId: otherId });
    f.send(data, { source: {} });
    f.send(data, { origin: 'https://foreign.invalid' });
  }
  assert.deepEqual(calls, []);
  f.send({ type: 'mydancr:internal-profile-shown', profileId: id });
  assert.deepEqual(calls, ['ready']);
  assert.equal(f.timers.size, 0);
  f.send({ type: 'mydancr:internal-profile-close', profileId: id });
  assert.deepEqual(calls, ['ready', 'close']);
  f.render({ profile: null, onClose: () => assert.fail('A stale close cannot reopen or dismiss anything') });
  f.send({ type: 'mydancr:internal-profile-close', profileId: id });
  assert.equal(f.messages.at(-1).type, 'mydancr:internal-profile-clear');
});

test('customer profiles reuse the same frame with a public request and matching readiness', () => {
  const f = fixture(), calls = [];
  const idle = f.render({ profile: null, onClose() {} });
  const opened = f.render({ profile: null, profileId: id, publicSlug: 'star', hidden: true,
    onReady: () => calls.push('ready'), onClose() {} });
  assert.equal(opened.props.src, idle.props.src);
  assert.equal(opened.props.style.visibility, 'hidden');
  assert.deepEqual(JSON.parse(JSON.stringify(f.messages.at(-1))), { type: 'mydancr:public-profile-open', profileId: id, slug: 'star' });
  f.send({ type: 'mydancr:internal-profile-shown', profileId: otherId });
  assert.deepEqual(calls, []);
  f.send({ type: 'mydancr:internal-profile-shown', profileId: id });
  assert.deepEqual(calls, ['ready']);
  assert.equal(f.timers.size, 0);
});

test('VIP queue actions accept only the active trusted frame and never close the profile', () => {
  const f = fixture(), calls = [];
  const props = { profile: null, profileId: id, publicSlug: 'aria',
    vipRequest: { added: false, disabled: false, message: '' }, onVipRequest: () => calls.push('add'),
    onClose: () => assert.fail('Request must leave the full profile open') };
  f.render(props);
  const data = { type: 'mydancr:vip-profile-request', profileId: id };
  f.send({ ...data, profileId: otherId }); f.send(data, { source: {} }); f.send(data, { origin: 'https://foreign.invalid' });
  assert.deepEqual(calls, []);
  f.send(data); assert.deepEqual(calls, ['add']);
  for (const vipRequest of [undefined, { added: true, disabled: false }, { added: false, disabled: true }]) {
    f.render({ ...props, vipRequest }); f.send(data);
  }
  assert.deepEqual(calls, ['add']);
  f.render({ ...props, publicSlug: undefined }); f.send(data);
  assert.deepEqual(calls, ['add'], 'internal table profiles cannot send VIP selections');
  f.render({ ...props, profileId: '' }); f.send(data);
  assert.deepEqual(calls, ['add']);
});
