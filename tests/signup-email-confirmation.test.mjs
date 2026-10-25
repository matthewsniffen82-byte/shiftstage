import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const events = readFileSync('src/live-shell/app/24-events.js', 'utf8');
const helpers = readFileSync('src/live-shell/app/14-set-venue-auth-mode.js', 'utf8');
const shell = readFileSync('src/live-shell/shell.html', 'utf8');
const popup = helpers.match(/    function showSignupEmailConfirmation\(email\) \{[\s\S]*?\n    \}/)[0];

function fixture(role) {
  const formId = role === 'dancer' ? 'dancerSignupForm' : 'authForm';
  const handlerSource = events.match(new RegExp(`document\\.getElementById\\("${formId}"\\)\\.addEventListener\\("submit"[\\s\\S]*?\\n    \\}\\);`))[0];
  let handler, resolve, reject, opens = 0, cooldowns = 0;
  let request = new Promise((yes, no) => { resolve = yes; reject = no; });
  const statuses = [], toasts = [], attributes = new Map();
  const submit = { textContent: 'Create account', disabled: false, setAttribute: (k, v) => attributes.set(k, v), removeAttribute: k => attributes.delete(k) };
  const recipient = { textContent: '' };
  const dialog = { open: false, showModal() { this.open = true; opens++; } };
  const nodes = {
    [formId]: { addEventListener: (_event, fn) => { handler = fn; } }, authSubmit: submit,
    dancerEmail: { value: 'signup@example.test' }, customerEmail: { value: 'signup@example.test' },
    dancerPassword: { value: 'Example1!password' }, dancerConfirmPassword: { value: 'Example1!password' }, customerPassword: { value: 'Example1!password' }, customerConfirmPassword: { value: 'Example1!password' },
    customerTermsAccepted: { checked: true, dataset: { termsVersion: 'current' } }, customerEmailOptIn: { checked: false, dataset: {} },
    customerFollowEmailOptIn: { checked: false }, customerVenueShareOptIn: { checked: false },
    signupEmailConfirmation: dialog, signupEmailConfirmationRecipient: recipient,
  };
  vm.runInNewContext(`${popup}\n${handlerSource}`, {
    document: { getElementById: id => nodes[id] }, authMode: 'signup', isCustomerLoggedIn: false,
    citySelect: { value: 'Las Vegas' }, pendingAccountAuthReturnTo: '', customerSignupVenue: null, updateAccountHeader() {},
    saveAuthResume: () => '/auth/callback', requestAuth: () => request,
    setDancerSignupStatus: value => statuses.push(value), setCustomerAuthStatus: value => statuses.push(value),
    showToast: value => toasts.push(value), friendlyAuthErrorMessage: value => value,
    startConfirmationResendCooldown: () => { cooldowns++; },
  });
  return { dialog, recipient, submit, statuses, attributes, toasts,
    get opens() { return opens; }, get cooldowns() { return cooldowns; },
    send: () => handler({ preventDefault() {}, submitter: submit }),
    succeed: () => resolve({ requiresEmailConfirmation: true }), fail: () => reject(new Error('Unable to send confirmation.')),
    resend() { dialog.open = false; request = Promise.resolve({ requiresEmailConfirmation: true }); return this.send(); },
  };
}

for (const role of ['dancer', 'customer']) {
  test(`${role} confirmation opens a persistent popup after success and again after resend`, async () => {
    const ui = fixture(role), sending = ui.send();
    assert.equal(ui.opens, 0); assert.equal(ui.submit.disabled, true);
    ui.succeed(); await sending;
    assert.equal(ui.statuses.at(-1), 'Confirmation sent');
    assert.equal(ui.dialog.open, true); assert.equal(ui.opens, 1);
    assert.equal(ui.recipient.textContent, 'Sent to signup@example.test');
    assert.equal(ui.toasts.length, 0); assert.equal(ui.cooldowns, 1);
    assert.equal(ui.attributes.has('aria-busy'), false);
    await ui.resend(); assert.equal(ui.opens, 2); assert.equal(ui.cooldowns, 2);
  });
  test(`${role} send failure keeps the form retryable without showing a success popup`, async () => {
    const ui = fixture(role), sending = ui.send(); ui.fail(); await sending;
    assert.equal(ui.opens, 0); assert.equal(ui.cooldowns, 0);
    assert.equal(ui.statuses.at(-1), 'Unable to send confirmation.');
    assert.equal(ui.submit.disabled, false); assert.equal(ui.submit.textContent, 'Create account');
  });
}

test('the native confirmation dialog has an accessible title, instructions and an explicit dismiss action', () => {
  const dialog = shell.match(/<dialog id="signupEmailConfirmation"[\s\S]*?<\/dialog>/)[0];
  assert.match(dialog, /aria-labelledby="signupEmailConfirmationTitle"/);
  assert.match(dialog, /aria-describedby="signupEmailConfirmationRecipient signupEmailConfirmationInstructions"/);
  assert.match(dialog, />Check your email<\/h2>/);
  assert.match(dialog, /<strong>Confirm email<\/strong>/);
  assert.match(dialog, /<form method="dialog">[\s\S]*?autofocus>Got it<\/button>/);
  assert.doesNotMatch(popup, /setTimeout|innerHTML/);
});
