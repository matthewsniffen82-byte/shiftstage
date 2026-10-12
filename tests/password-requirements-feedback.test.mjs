import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as policy from '../src/lib/dancr/password-policy.ts';

const require = createRequire(import.meta.url);
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const shell = read('src/live-shell/shell.html');
const authFile = 'src/live-shell/app/14-set-venue-auth-mode.js';
const script = file => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functionSource = (file, name) => script(file).statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)?.getText();
const inputs = ['customerPassword', 'venueLoginPassword', 'venueRequestPassword', 'dancerPassword', 'dancerAccountPassword', 'customerAccountPassword', 'adminPassword'];
const checklists = [...shell.matchAll(/<ul([^>]*data-password-requirements="([^"]+)"[^>]*)>([\s\S]*?)<\/ul>/g)]
  .map(match => ({ input: match[2], id: match[1].match(/\bid="([^"]+)"/)[1], labels: [...match[3].matchAll(/<li>([^<]+)<\/li>/g)].map(item => item[1]) }));

function events() {
  const listeners = new Map();
  return {
    addEventListener(name, listener) { const list = listeners.get(name) || []; list.push(listener); listeners.set(name, list); },
    emit(name) { for (const listener of listeners.get(name) || []) listener(); },
  };
}

// Isolated DOM event handlers with synthetic fields only. No browser or server.
function liveFixture(prefilled = {}) {
  const fields = new Map(), lists = [], tasks = [];
  for (const checklist of checklists) {
    fields.set(checklist.input, { ...events(), value: prefilled[checklist.input] || '', form: events() });
    const items = checklist.labels.map(textContent => {
      const classes = new Set(), attributes = {};
      return { textContent, attributes, classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
        setAttribute(name, value) { attributes[name] = value; }, met: () => classes.has('is-met') };
    });
    lists.push({ dataset: { passwordRequirements: checklist.input }, items, querySelectorAll: () => items });
  }
  const window = { ...events(), setTimeout: callback => tasks.push(callback) };
  const context = vm.createContext({ window, document: { getElementById: id => fields.get(id), querySelectorAll: () => lists } });
  vm.runInContext(functionSource(authFile, 'updatePasswordRequirements'), context);
  const bindings = script('src/live-shell/app/23-events.js').statements.filter(node => {
    const text = node.getText();
    return text.startsWith('document.querySelectorAll("[data-password-requirements]")')
      || text === 'window.addEventListener("pageshow", updatePasswordRequirements);'
      || text === 'updatePasswordRequirements();';
  });
  assert.equal(bindings.length, 3);
  vm.runInContext(bindings.map(node => node.getText()).join('\n'), context);
  return { fields, lists, window, context, flush: () => tasks.splice(0).forEach(callback => callback()),
    result: id => lists.find(list => list.dataset.passwordRequirements === id).items.map(item => item.met()) };
}

test('every primary homepage account password has a linked four-rule live checklist', () => {
  assert.deepEqual(checklists.map(list => list.input).sort(), [...inputs].sort());
  const primary = [...shell.matchAll(/<input\b[^>]*type="password"[^>]*>/g)].map(match => match[0])
    .filter(input => !/autocomplete="one-time-code"|id="[^"]*[Cc]onfirm/.test(input));
  assert.equal(primary.length, inputs.length);
  for (const list of checklists) {
    assert.equal(list.labels.length, policy.PASSWORD_REQUIREMENTS.length);
    assert.ok(primary.some(input => input.includes('id="' + list.input + '"') && input.includes('aria-describedby="' + list.id + '"')));
  }
  assert.doesNotMatch(shell.match(/<ul[^>]*id="customerPasswordRequirements"[^>]*>/)[0], /\bhidden\b/);
  assert.match(functionSource(authFile, 'setCustomerAuthMode'), /passwordRequirements.hidden = false/);
  const css = read('src/live-shell/styles/base-styles-04-auth-role-grid.css');
  assert.match(css, /\[data-password-requirements\] li.is-met\s*\{\s*color: #4ade80/);
  assert.match(css, /\[data-password-requirements\] li.is-met::marker/);
});

for (const id of inputs) test(id + ' highlights fulfilled rules and clears them again without affecting other fields', () => {
  const f = liveFixture();
  for (const password of ['', 'a', 'Ab', 'Ab1', 'Ab1!', 'Ab1!xy', 'abcdef', 'ABC123', 'Ab12  ', 'Ab12\u20acx', '']) {
    f.fields.get(id).value = password;
    f.fields.get(id).emit('input');
    assert.deepEqual(f.result(id), [...policy.passwordRequirementStatus(password)]);
    for (const item of f.lists.find(list => list.dataset.passwordRequirements === id).items) {
      assert.equal(item.attributes['aria-label'], (item.met() ? 'Met: ' : 'Not yet met: ') + item.textContent);
    }
    for (const other of inputs.filter(input => input !== id)) assert.deepEqual(f.result(other), [false, false, false, false]);
  }
});

test('prefilled, pasted, autofill change/focus, restored-page and reset values stay synchronized', () => {
  const f = liveFixture({ customerPassword: 'Ready1!' });
  assert.deepEqual(f.result('customerPassword'), [true, true, true, true]);
  for (const name of ['input', 'change', 'focus']) {
    f.fields.get('customerPassword').value = '';
    f.fields.get('customerPassword').emit(name);
    assert.deepEqual(f.result('customerPassword'), [false, false, false, false]);
    f.fields.get('customerPassword').value = 'Pasted1!';
    f.fields.get('customerPassword').emit(name);
    assert.deepEqual(f.result('customerPassword'), [true, true, true, true]);
  }
  f.fields.get('customerPassword').form.emit('reset');
  f.fields.get('customerPassword').value = '';
  f.flush();
  assert.deepEqual(f.result('customerPassword'), [false, false, false, false]);
  f.fields.get('adminPassword').value = 'Restored1!';
  f.window.emit('pageshow');
  assert.deepEqual(f.result('adminPassword'), [true, true, true, true]);
});

test('programmatic account password clears reset the checklist immediately', () => {
  const f = liveFixture({ dancerAccountPassword: 'Ready1!', customerAccountPassword: 'Ready1!' });
  vm.runInContext(functionSource('src/live-shell/app/03-submit-password-recovery-form.js', 'clearAccountCenterFields'), f.context);
  for (const role of ['customer', 'dancer']) {
    f.context.role = role;
    vm.runInContext('clearAccountCenterFields(role, "password")', f.context);
    assert.deepEqual(f.result(role + 'AccountPassword'), [false, false, false, false]);
  }
  for (const [file, name] of [
    ['src/live-shell/app/13-open-profile-modal.js', 'clearAuthFields'],
    [authFile, 'clearDancerSignupFields'],
    ['src/live-shell/app/18-keep-admin-approval-card-open.js', 'logoutAdminAccount'],
  ]) assert.match(functionSource(file, name), /updatePasswordRequirements\(\)/);
});

const compiled = {};
vm.runInNewContext(ts.transpileModule(read('app/components/PasswordRequirements.tsx'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports: compiled, require: name => name === '@/src/lib/dancr/password-policy' ? policy : require(name) });

test('React checklist shows the same live green checks, accessible states, and reversals', () => {
  for (const password of ['', 'Ab1', 'Ab1!xy', 'abcdef', 'ABC123', 'Ab12\u20acx', '']) {
    const met = policy.passwordRequirementStatus(password);
    const html = renderToStaticMarkup(React.createElement(compiled.PasswordRequirements, { password }));
    assert.equal((html.match(/aria-label="Met:/g) || []).length, met.filter(Boolean).length);
    assert.equal((html.match(/aria-label="Not yet met:/g) || []).length, met.filter(value => !value).length);
    assert.equal((html.match(/color:#4ade80/g) || []).length, met.filter(Boolean).length);
    assert.equal((html.match(/\u2713/g) || []).length, met.filter(Boolean).length);
  }
});

test('all React account password surfaces bind the shared checklist to the live password value', () => {
  for (const file of [
    'app/account/AccountClient.tsx', 'app/admin/AdminClient.tsx', 'app/venue-team/invite/[token]/VenueTeamInviteClient.tsx',
    'app/vip/VipClient.tsx', 'app/account/reset-password/VipPasswordSetup.tsx',
    'app/account/reset-password/ResetPasswordClient.tsx', 'app/vip/VipAccountPanel.tsx', 'app/dashboard/CustomerAccountPanel.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /<PasswordRequirements password=\{password\} \/>/, file);
    assert.doesNotMatch(source, /mode === "signup" \? <PasswordRequirements|!passwordSaved && <><PasswordRequirements/, file);
    assert.match(source, /setPassword\(event.target.value\)/, file);
  }
});
