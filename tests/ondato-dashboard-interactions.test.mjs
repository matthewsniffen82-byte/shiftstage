import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ondatoHostedUrl } from '../src/lib/dancr/ondato-url.ts';
import * as biometricConsent from '../src/lib/dancr/biometric-consent-version.ts';
import { webcrypto } from 'node:crypto';
import { ids } from './helpers/ondato-fixture.mjs';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync(new URL('../app/dashboard/DancerAgeVerificationGate.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const verification = status => ({ required: true, configured: true, status, verifiedAt: status === 'verified' ? '2026-01-01' : null });
const response = status => ({ ok: true, verification: verification(status) });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function elements(tree, type) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, type));
  return [...(tree.type === type ? [tree] : []), ...elements(tree.props?.children, type)];
}

// Component interactions with synthetic responses and deterministic timers;
// no browser, production journey, ID submission or real provider request.
function harness({ request = async () => response('not_started'), returned = false, profileSubmitted = true } = {}) {
  const slots = [], effects = [], cleanups = [], calls = [], changes = [], redirects = [], timers = new Map();
  let cursor = 0, dirty = true, tree, timerId = 0;
  let session = { accessToken: 'first-token', account: { id: 'first-dancer', role: 'dancer' } };
  const document = { visibilityState: 'visible' };
  const hooks = { ...React,
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true; }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useCallback(fn, deps) {
      const i = cursor++, prior = slots[i];
      if (!prior || deps.some((dep, j) => dep !== prior.deps[j])) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(effect, deps) {
      const i = cursor++, prior = slots[i];
      if (!prior || deps.some((dep, j) => dep !== prior[j])) {
        slots[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = effect(); });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, AbortController, URLSearchParams, document, crypto: webcrypto,
    window: { location: { search: returned ? '?age-verification=returned' : '', assign: url => redirects.push(url) } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === '@/src/lib/dancr/ondato-url') return { ondatoHostedUrl };
      if (name === '@/src/lib/dancr/biometric-consent-version') return biometricConsent;
      if (name === '../components/dashboard-help-scope') return { useDashboardHelpArea() {} };
      if (name === './dashboard-session') return {
        readSession: () => session,
        requestDashboardJson(path, options) { calls.push({ path, options }); return request(path, options); },
      };
      throw new Error(name);
    },
  });
  const onVerificationChange = value => changes.push(value);
  function render() {
    if (!dirty) return;
    dirty = false; cursor = 0;
    tree = exports.default({ children: React.createElement('div', null, 'PRIVATE_DANCER_TOOLS'), onVerificationChange, profileSubmitted });
    effects.splice(0).forEach(effect => effect());
  }
  render();
  return {
    calls, changes, redirects, timers, document,
    setSession(value) { session = value; },
    get session() { return session; },
    get html() { render(); return renderToStaticMarkup(tree); },
    button(primary = false) { render(); return elements(tree, 'button').find(button => button.props.className === `button ${primary ? 'primary' : 'secondary'}`); },
    consent() { render(); elements(tree, 'input')[0].props.onChange({ target: { checked: true } }); render(); },
    async settle() { await new Promise(resolve => setImmediate(resolve)); render(); },
    async tick() {
      const next = timers.entries().next().value;
      if (!next) return false;
      timers.delete(next[0]); assert.equal(next[1].delay, 15000); next[1].fn();
      await this.settle(); return true;
    },
    unmount() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

test('returning dancers see a delayed approval automatically without creating another session', async () => {
  const answers = ['pending', 'in_review', 'verified'];
  const ui = harness({ returned: true, request: async () => response(answers.shift()) });
  await ui.settle();
  assert.doesNotMatch(ui.html, /PRIVATE_DANCER_TOOLS/);
  assert.equal(ui.calls[0].options.method, 'GET');
  assert.equal(ui.calls[1].path, '/api/dancer/age-verification?action=refresh');
  await ui.tick();
  assert.match(ui.html, /PRIVATE_DANCER_TOOLS/);
  assert.equal(ui.changes.at(-1).status, 'verified');
  assert.equal(ui.timers.size, 0);
  assert.ok(ui.calls.slice(1).every(call => call.path.endsWith('?action=refresh')));
  ui.unmount();
});

test('a saved approval remains usable on return without depending on provider availability', async () => {
  const ui = harness({ returned: true, request: async (_path, options) => {
    assert.equal(options.method, 'GET'); return response('verified');
  } });
  await ui.settle(); assert.match(ui.html, /PRIVATE_DANCER_TOOLS/);
  assert.equal(ui.calls.length, 1); assert.equal(ui.timers.size, 0); ui.unmount();
});

test('slow saved approval goes from neutral loading to content without a verification prompt', async () => {
  const saved = deferred(); const ui = harness({ request: () => saved.promise });
  assert.match(ui.html, /role="status">Checking account status…/);
  assert.doesNotMatch(ui.html, /PRIVATE_DANCER_TOOLS|Verify you’re 18\+|Check verification status/);
  assert.equal(ui.button(), undefined);
  saved.resolve(response('verified')); await ui.settle();
  assert.match(ui.html, /PRIVATE_DANCER_TOOLS/);
  assert.doesNotMatch(ui.html, /Checking account status|Verify you’re 18\+/);
  assert.equal(ui.calls.length, 1); ui.unmount();
});

test('unfinished capture offers resume and rapid double clicks start only one request', async () => {
  const start = deferred();
  const ui = harness({ request: (path, options) => options.method === 'POST' && !path.includes('?') ? start.promise : Promise.resolve(response('pending')) });
  await ui.settle(); assert.match(ui.html, /Continue verification/);
  ui.consent(); const button = ui.button(true); button.props.onClick(); button.props.onClick();
  await ui.settle();
  assert.equal(ui.calls.filter(call => call.options.method === 'POST' && !call.path.includes('?')).length, 1);
  assert.equal(ui.button(true).props.disabled, true);
  start.resolve({ ok: true, url: `https://idv.ondato.com/?id=${ids.sessionId}` });
  await ui.settle(); assert.deepEqual(ui.redirects, [`https://idv.ondato.com/?id=${ids.sessionId}`]); ui.unmount();
});

test('unmount or switching accounts prevents a late verification redirect', async () => {
  for (const unmount of [true, false]) {
    const start = deferred();
    const ui = harness({ request: (_path, options) => options.method === 'POST' ? start.promise : Promise.resolve(response('not_started')) });
    await ui.settle(); ui.consent(); ui.button(true).props.onClick();
    if (unmount) ui.unmount();
    else ui.setSession({ accessToken: 'other', account: { id: 'other-dancer', role: 'dancer' } });
    start.resolve({ ok: true, url: `https://idv.ondato.com/?id=${ids.sessionId}` }); await ui.settle();
    assert.equal(ui.redirects.length, 0);
    if (unmount) assert.equal(ui.calls.at(-1).options.signal.aborted, true);
    ui.unmount();
  }
});

test('account changes discard old approval responses while token refresh for the same account works', async () => {
  for (const changedAccount of [true, false]) {
    const pending = deferred(); const ui = harness({ request: () => pending.promise });
    ui.setSession({ ...ui.session, accessToken: 'refreshed', ...(changedAccount ? { account: { id: 'other-dancer', role: 'dancer' } } : {}) });
    pending.resolve(response('verified')); await ui.settle();
    assert.equal(ui.html.includes('PRIVATE_DANCER_TOOLS'), !changedAccount);
    assert.equal(ui.changes.length, changedAccount ? 0 : 1); ui.unmount();
  }
});

test('a late background response or error cannot replace a newer manual approval', async () => {
  for (const failure of [false, true]) {
    const slow = deferred(); let count = 0;
    const ui = harness({ request: async () => ++count === 1 ? response('pending') : count === 2 ? slow.promise : response('verified') });
    await ui.settle(); ui.button().props.onClick(); await ui.settle();
    if (failure) slow.reject(new Error('stale provider failure')); else slow.resolve(response('in_review'));
    await ui.settle(); assert.match(ui.html, /PRIVATE_DANCER_TOOLS/);
    assert.equal(ui.changes.at(-1).status, 'verified'); assert.equal(ui.timers.size, 0); ui.unmount();
  }
});

test('a failed initial status read can be retried and successful retries clear the error', async () => {
  let count = 0;
  const ui = harness({ request: async () => { if (++count === 1) throw new Error('offline'); return response('not_started'); } });
  await ui.settle(); assert.match(ui.html, /role="alert"/);
  assert.match(ui.html, /Try again/);
  assert.doesNotMatch(ui.html, /PRIVATE_DANCER_TOOLS|Verify you’re 18\+|role="status"/);
  ui.button().props.onClick(); await ui.settle();
  assert.doesNotMatch(ui.html, /role="alert"/); assert.ok(ui.button(true)); ui.unmount();
});

test('automatic refresh is bounded, pauses requests in hidden tabs, and cancels on unmount', async () => {
  const ui = harness({ request: async () => response('in_review') });
  await ui.settle(); assert.equal(ui.calls.length, 2);
  ui.document.visibilityState = 'hidden'; await ui.tick(); assert.equal(ui.calls.length, 2);
  ui.document.visibilityState = 'visible';
  for (let i = 0; i < 12; i++) await ui.tick();
  assert.ok(ui.calls.length <= 10); assert.equal(ui.timers.size, 0); ui.unmount();
  const cancelled = harness({ request: async () => response('pending') });
  await cancelled.settle(); assert.equal(cancelled.timers.size, 1); cancelled.unmount();
  assert.equal(cancelled.timers.size, 0); assert.equal(cancelled.calls.at(-1).options.signal.aborted, true);
});

test('untrusted redirect URLs never leave the dancer dashboard', async () => {
  const ui = harness({ request: async (_path, options) => options.method === 'POST' ? { ok: true, url: 'https://example.invalid/' } : response('not_started') });
  await ui.settle(); ui.consent(); ui.button(true).props.onClick(); await ui.settle();
  assert.equal(ui.redirects.length, 0); assert.match(ui.html, /Unable to open verification/); ui.unmount();
});

test('profile and agreement setup must finish before automatic or manual provider refresh', async () => {
  const ui = harness({ profileSubmitted: false, returned: true, request: async (_path, options) => {
    assert.equal(options.method, 'GET'); return response('pending');
  } });
  await ui.settle(); assert.equal(ui.timers.size, 0); assert.equal(ui.button(true), undefined);
  ui.button().props.onClick(); await ui.settle(); assert.equal(ui.calls.length, 2); ui.unmount();
});

test('a background tab preserves its refresh budget until the dancer returns', async () => {
  const saved = deferred(); let count = 0;
  const ui = harness({ returned: true, request: async () => ++count === 1 ? saved.promise : response('verified') });
  ui.document.visibilityState = 'hidden'; saved.resolve(response('pending')); await ui.settle();
  for (let i = 0; i < 12; i++) await ui.tick();
  assert.equal(ui.calls.length, 1); assert.match(ui.html, /Continue verification/);
  ui.document.visibilityState = 'visible'; await ui.tick();
  assert.match(ui.html, /PRIVATE_DANCER_TOOLS/); assert.equal(ui.timers.size, 0); ui.unmount();
});
