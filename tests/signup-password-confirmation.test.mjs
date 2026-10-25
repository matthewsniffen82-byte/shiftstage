import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = file => readFileSync(file, 'utf8');
const shell = read('src/live-shell/shell.html');
const file24 = 'src/live-shell/app/24-events.js';
const file23 = 'src/live-shell/app/23-events.js';
const sourceFunction = (file, name) => ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  .statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText();
const sourceHandler = (file, id) => read(file).match(new RegExp(`document\\.getElementById\\("${id}"\\)\\.addEventListener\\("submit"[\\s\\S]*?\\n    \\}\\);`))[0];

function fixture(role, confirmation = 'Pass1!', mode = 'signup') {
  const nodes = new Map(), calls = [], statuses = [];
  let handler;
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', checked: true, textContent: 'Create account', disabled: false, hidden: false, dataset: {},
      focus() { this.focused = true; }, reportValidity() { return Boolean(this.value); },
      setAttribute() {}, removeAttribute() {}, addEventListener(_name, fn) { handler = fn; },
    });
    return nodes.get(id);
  };
  const passwordIds = { customer: 'customerPassword', dancer: 'dancerPassword', venue: 'venueLoginPassword', admin: 'adminPassword' };
  const confirmIds = { customer: 'customerConfirmPassword', dancer: 'dancerConfirmPassword', venue: 'venueConfirmPassword', admin: 'adminConfirmPassword' };
  node(passwordIds[role]).value = 'Pass1!';
  node(confirmIds[role]).value = confirmation;
  node('venueSignupCode').value = 'VALID'; node('venueLoginEmail').value = 'signup@example.test';
  node('dancerEmail').value = 'signup@example.test'; node('customerEmail').value = 'signup@example.test';
  const button = node(role === 'admin' ? mode === 'signup' ? 'adminCreateBtn' : 'adminLoginBtn' : role === 'venue' ? 'venueJoinNowBtn' : 'authSubmit');
  const context = vm.createContext({
    document: { getElementById: node }, authMode: mode, adminAuthMode: mode, citySelect: { value: 'Las Vegas' },
    isCustomerLoggedIn: false, pendingAccountAuthReturnTo: '', customerSignupVenue: null,
    verifiedVenueSignupCode: 'VALID', verifiedVenueSignupPreview: { name: 'Club' }, formatVenueAccessCode: value => value,
    setVenueAuthStatus: value => statuses.push(value), setDancerSignupStatus: value => statuses.push(value),
    setCustomerAuthStatus: value => statuses.push(value), showToast() {}, friendlyAuthErrorMessage: value => value,
    showSignupEmailConfirmation() {}, startConfirmationResendCooldown() {}, updateAccountHeader() {},
    saveAuthResume: () => '/auth/callback', loadLiveAdminApprovals: async () => {},
    requestAuth: async input => { calls.push(input); return { requiresEmailConfirmation: true, account: { displayName: 'Admin' } }; },
  });
  const source = role === 'venue' ? sourceFunction(file24, 'submitVenueSignup')
    : sourceHandler(role === 'admin' ? file23 : file24, role === 'dancer' ? 'dancerSignupForm' : role === 'admin' ? 'adminLoginForm' : 'authForm');
  vm.runInContext(source, context);
  return { node, calls, button, statuses, password: node(passwordIds[role]), confirmation: node(confirmIds[role]),
    submit: () => role === 'venue' ? context.submitVenueSignup(button) : handler({ preventDefault() {}, submitter: button }),
  };
}

for (const role of ['customer', 'dancer', 'venue', 'admin']) {
  test(`${role} signup blocks a mismatch before sending credentials and accepts a corrected confirmation`, async () => {
    const f = fixture(role, 'Different1!');
    await f.submit();
    assert.equal(f.calls.length, 0);
    assert.equal(f.button.disabled, false);
    const message = role === 'admin' ? f.node('adminLiveStatus').textContent : f.statuses.at(-1);
    assert.equal(message, 'Passwords do not match.');
    f.confirmation.value = f.password.value;
    await f.submit();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].password, 'Pass1!');
    assert.equal(f.calls[0].role, role);
  });
  test(`${role} signup requires confirmation and compares spaces exactly`, async () => {
    for (const value of ['', ' Pass1!', 'Pass1! ']) {
      const f = fixture(role, value);
      await f.submit();
      assert.equal(f.calls.length, 0);
    }
    const f = fixture(role, ' Pass1! ');
    f.password.value = ' Pass1! ';
    await f.submit();
    assert.equal(f.calls[0].password, ' Pass1! ');
  });
}

test('admin sign-in does not require signup confirmation', async () => {
  const f = fixture('admin', '', 'login');
  await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].mode, 'login');
});

test('admin signup confirmation is required only in Create mode and clears when switching modes', () => {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); };
  const context = vm.createContext({ adminAuthMode: 'login', document: { getElementById: node, querySelectorAll: () => [] } });
  vm.runInContext(sourceFunction('src/live-shell/app/18-keep-admin-approval-card-open.js', 'setAdminAuthMode'), context);
  context.setAdminAuthMode('signup');
  assert.equal(node('adminConfirmPassword').required, true);
  assert.equal(node('adminConfirmPassword').disabled, false);
  assert.equal(node('adminConfirmPasswordField').hidden, false);
  node('adminConfirmPassword').value = 'Secret1!';
  context.setAdminAuthMode('login');
  assert.equal(node('adminConfirmPassword').required, false);
  assert.equal(node('adminConfirmPassword').disabled, true);
  assert.equal(node('adminConfirmPassword').value, '');
  assert.equal(node('adminConfirmPasswordField').hidden, true);
});

test('all homepage signup confirmations have consistent labels, autocomplete and visibility controls', () => {
  for (const id of ['customerConfirmPassword', 'dancerConfirmPassword', 'venueConfirmPassword', 'venueRequestConfirmPassword', 'adminConfirmPassword']) {
    assert.ok(shell.includes(`<label for="${id}">Confirm password</label>`));
    const input = shell.match(new RegExp(`<input id="${id}"[^>]*>`))[0];
    for (const attribute of ['type="password"', 'autocomplete="new-password"', 'placeholder="Re-enter password"']) assert.ok(input.includes(attribute), `${id}: ${attribute}`);
    assert.match(shell, new RegExp(`data-password-toggle="${id}" aria-label="Show confirm password" aria-pressed="false"`));
  }
  const nfcSignup = read('app/account/AccountClient.tsx');
  assert.match(nfcSignup, /if \(mode === "signup" && password !== confirmPassword\)/);
  assert.match(nfcSignup, /\{mode === "signup" \? \(\s*<label>\s*Confirm password/);
});
