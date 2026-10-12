import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import React from 'react';
import ts from 'typescript';
import postcss from 'postcss';

const require = createRequire(import.meta.url);
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const text = node => React.isValidElement(node) ? React.Children.toArray(node.props.children).map(text).join('') : typeof node === 'string' ? node : '';
function compile(path, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, URLSearchParams, AbortController, Error, ...globals, require: name => name.endsWith('.css') ? {} : dependencies[name] || require(name) });
  return exports;
}
function fixture({ savedEmail = 'manager@example.com', storageBlocked = false, deliveryFailed = false, response = async () => ({ ok: true, json: async () => ({ message: 'Confirmation link requested.' }) }) } = {}) {
  const slots = [], calls = [], timers = new Map();
  let cursor = 0, dirty = true, effects = [], tree;
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++; slots[i] ||= { value: initial };
      return [slots[i].value, value => { if (!Object.is(slots[i].value, value)) { slots[i].value = value; dirty = true; } }];
    },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
    },
  };
  const Component = compile('app/venue/confirm-email/VenueEmailConfirmation.tsx', {
    react: hooks, 'next/link': { __esModule: true, default: 'a' },
  }, {
    window: { location: { search: deliveryFailed ? '?delivery=failed' : '' }, setTimeout: fn => { timers.set(1, fn); return 1; }, clearTimeout: id => timers.delete(id) },
    sessionStorage: { getItem: () => { if (storageBlocked) throw Error('Unavailable'); return savedEmail; } },
    fetch: (url, options) => { calls.push({ url, options }); return response(options); },
  }).default;
  function render() {
    dirty = true;
    for (let i = 0; dirty && i < 15; i++) { dirty = false; cursor = 0; effects = []; tree = Component(); effects.forEach(run => run()); }
    assert.equal(dirty, false);
    return walk(tree);
  }
  const find = type => render().find(node => node.type === type);
  return { calls, timers, render, find, content: () => text(tree), submit: () => find('form').props.onSubmit({ preventDefault() {} }),
    close: () => slots.forEach(slot => slot?.cleanup?.()) };
}

test('club confirmation is compact, names the recipient, and retains the existing sign-in destination', () => {
  const f = fixture(); f.render();
  assert.equal(text(f.find('h1')), 'Check your email');
  assert.match(f.content(), /We sent a confirmation link to manager@example.com/);
  assert.equal(f.find('input'), undefined);
  assert.equal(f.find('ol'), undefined);
  assert.doesNotMatch(f.content(), /Club details saved|Wait for club approval|waiting-for-approval|Check spam/);
  assert.equal(f.find('a').props.href, '/?venueAccess=1&venueMode=login');
  assert.equal(text(f.find('a')), 'Already confirmed? Sign in');
  assert.equal(f.find('button').props.disabled, false);
  f.close();
});

test('missing or blocked browser storage keeps a required email field for resending', async () => {
  for (const options of [{ savedEmail: '' }, { storageBlocked: true }]) {
    const f = fixture(options);
    const input = f.find('input');
    assert.equal(input.props.type, 'email');
    assert.equal(input.props.required, true);
    assert.equal(f.find('label').props.htmlFor, input.props.id);
    assert.equal(f.find('button').props.disabled, true);
    input.props.onChange({ target: { value: 'another@example.com' } });
    await f.submit();
    assert.deepEqual(JSON.parse(f.calls[0].options.body), { email: 'another@example.com' });
    assert.match(f.content(), /Confirm the email used for your club account/);
    f.close();
  }
});

test('resend keeps the same endpoint, prevents duplicate requests and restores its action', async () => {
  let resolve;
  const f = fixture({ response: () => new Promise(done => { resolve = done; }) });
  const pending = f.submit();
  assert.equal(f.find('button').props.disabled, true);
  assert.equal(f.find('button').props['aria-busy'], true);
  assert.equal(text(f.find('button')), 'Sending…');
  await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, '/api/venue/signup-requests/confirmation');
  assert.deepEqual(JSON.parse(f.calls[0].options.body), { email: 'manager@example.com' });
  resolve({ ok: true, json: async () => ({ message: 'Confirmation link requested.' }) });
  await pending;
  assert.equal(f.find('button').props.disabled, false);
  assert.equal(f.render().find(node => node.props.role === 'status').props.children, 'Confirmation link requested.');
  assert.equal(f.timers.size, 0);
  f.close();
});

test('delivery and resend failures remain visible without claiming successful delivery', async () => {
  const f = fixture({ deliveryFailed: true, response: async () => ({ ok: false, json: async () => ({ error: 'Please wait before requesting another email.' }) }) });
  assert.equal(f.find('section').props['data-state'], 'error');
  assert.doesNotMatch(f.content(), /We sent a confirmation link/);
  assert.match(f.content(), /couldn’t send the email/);
  await f.submit();
  assert.equal(f.render().find(node => node.props.role === 'alert').props.children, 'Please wait before requesting another email.');
  assert.equal(f.find('button').props.disabled, false);
  f.close();
});

test('the shared mobile dock is absent on club confirmation but remains on discovery', () => {
  for (const pathname of ['/venue/confirm-email', '/dancers', '/venues', '/tv']) {
    const { GlobalMobileBottomNav } = compile('app/components/GlobalMobileBottomNav.tsx', {
      react: { ...React, useState: initial => [initial, () => {}], useRef: () => ({ current: null }), useEffect() {} },
      'next/navigation': { usePathname: () => pathname },
      '@/src/lib/dancr/navigation': { homeDiscoveryHref: view => `/?view=${view}` },
    });
    const result = GlobalMobileBottomNav();
    if (pathname === '/venue/confirm-email') assert.equal(result, null);
    else assert.ok(walk(result).some(node => node.props.className === 'global-mobile-bottom-nav'));
  }
});

test('confirmation uses shared account controls with a bounded panel and wrapping recipient', () => {
  const f = fixture();
  assert.match(f.find('section').props.className, /account-form-surface/);
  assert.equal(f.find('button').props['data-sign-in-action'], true);
  const css = postcss.parse(source('app/venue/confirm-email/venue-email-confirmation.css'));
  const declarations = selector => {
    let found;
    css.walkRules(rule => { if (rule.selector === selector) found = Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value])); });
    assert.ok(found, selector); return found;
  };
  assert.equal(declarations('.venue-confirm-copy strong')['overflow-wrap'], 'anywhere');
  assert.equal(declarations('body.dancr-button-system .venue-confirm-card.account-form-surface').width, 'min(100%, 500px)');
  assert.equal(declarations('body.dancr-button-system .venue-confirm-card .account-form-primary')['white-space'], 'normal');
  f.close();
});
