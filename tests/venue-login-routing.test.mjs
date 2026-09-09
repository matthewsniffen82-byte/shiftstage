import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { persistResponseSession, DASHBOARD_SESSION_KEY } from '../app/dashboard/dashboard-session.ts';

const home = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');
function homeFunction(name) {
  const start = home.search(new RegExp(`    (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return home.slice(start, home.indexOf('\n    }', start) + 6);
}
function homeFixture(role = 'venue') {
  const navigation = [];
  const context = vm.createContext({ URL, console,
    window: { location: { assign: path => navigation.push(path) } },
    closeAuthPage() {}, updateAccountHeader() {}, showToast() {}, syncSignedInAccountControl() {}, prepareRealCustomerDashboardState() {},
    openAuthRole() { throw Error('Unexpected sign-in'); },
  });
  vm.runInContext(`let authSession = ${JSON.stringify({ accessToken: 'test', account: { role } })};
    let isCustomerLoggedIn = true, isDancerLoggedIn = false, isVenueLoggedIn = false, activeDashboardType = 'customer', pendingVenueAuthReturnTo = '';
    ${['isVenueSession', 'restoreLoggedInSessionState', 'openUnifiedDashboard', 'startVenueDashboardSession', 'safeLocalReturnPath'].map(homeFunction).join('\n')}
    ${home.includes('function accountLoginDestination(') ? homeFunction('accountLoginDestination') : ''}`, context);
  return { context, navigation };
}

test('venue sign-in replaces stale customer controls with the authenticated venue role', async () => {
  const f = homeFixture();
  await f.context.startVenueDashboardSession();
  assert.deepEqual(f.navigation, ['/dashboard/venue']);
  assert.equal(vm.runInContext('activeDashboardType', f.context), 'venue');
  assert.equal(vm.runInContext('isCustomerLoggedIn', f.context), false);
  assert.equal(vm.runInContext('isVenueLoggedIn', f.context), true);
});

test('dashboard navigation uses the authenticated role when a stale customer button is clicked', () => {
  const f = homeFixture();
  f.context.openUnifiedDashboard('customer', 'customer-alerts');
  assert.deepEqual(f.navigation, ['/dashboard/venue']);
});

for (const role of ['customer', 'dancer', 'venue']) test(`${role} sign-in only preserves return links compatible with its dashboard`, () => {
  const f = homeFixture(role);
  const destination = f.context.accountLoginDestination;
  assert.equal(typeof destination, 'function');
  assert.equal(destination(role, '/dashboard/customer#customer-alerts'), role === 'customer' ? '/dashboard/customer#customer-alerts' : `/dashboard/${role}`);
  assert.equal(destination(role, '/dashboard/venue?period=7d'), role === 'venue' ? '/dashboard/venue?period=7d' : `/dashboard/${role}`);
  assert.equal(destination(role, '/deals/claim/test'), '/deals/claim/test');
  assert.equal(destination(role, '//outside.example'), `/dashboard/${role}`);
  assert.equal(destination(role, '/account?role=customer'), `/dashboard/${role}`);
});

test('the actual sign-in handler replaces a stale customer return destination after venue authentication', async () => {
  const f = homeFixture();
  const elements = new Map();
  let submitHandler;
  f.context.document = { getElementById: id => {
    if (!elements.has(id)) elements.set(id, { value: 'test@example.invalid', textContent: 'Sign in', setAttribute() {}, removeAttribute() {},
      addEventListener: (_event, handler) => { submitHandler = handler; } });
    return elements.get(id);
  } };
  f.context.citySelect = { value: 'Las Vegas' };
  f.context.setCustomerAuthStatus = () => {};
  f.context.friendlyAuthErrorMessage = message => { throw Error(message); };
  f.context.requestAuth = async () => ({ session: { accessToken: 'test' }, account: { role: 'venue' } });
  vm.runInContext('let authMode = "login", pendingAccountAuthReturnTo = "/dashboard/customer#customer-alerts";', f.context);
  vm.runInContext(home.match(/document\.getElementById\("authForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/)[0], f.context);
  await submitHandler({ preventDefault() {} });
  assert.deepEqual(f.navigation, ['/dashboard/venue']);
  assert.equal(vm.runInContext('activeDashboardType', f.context), 'venue');
});

for (const role of ['venue', 'dancer', 'admin']) test(`customer page redirects a server-verified ${role} before requesting customer data`, async () => {
  const source = readFileSync(new URL('../app/dashboard/customer-dashboard-loader.ts', import.meta.url), 'utf8');
  const exports = {}, updates = [], requests = [];
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: () => ({
      requestAccountJson: async () => ({ account: { id: 'test', role } }),
      requestDashboardJson: async path => { requests.push(path); return {}; },
      requestOptionalDashboardJson: async path => { requests.push(path); return {}; },
      DashboardDataRequestError: class extends Error {}, dashboardLoadErrorMessage: error => error.message,
    }),
  });
  await exports.loadCustomerDashboard(new AbortController().signal, (panel, data) => updates.push([panel, data]));
  assert.deepEqual(updates, [['redirect', role === 'admin' ? '/admin' : `/dashboard/${role}`]]);
  assert.deepEqual(requests, []);
});

test('account verification refreshes a cached customer role without restoring a replaced session', () => {
  const previousWindow = globalThis.window;
  const store = new Map([[DASHBOARD_SESSION_KEY, JSON.stringify({ accessToken: 'original', account: { id: 'same-user', role: 'customer' } })]]);
  globalThis.window = { localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) }, dispatchEvent() {} };
  try {
    persistResponseSession({ account: { id: 'same-user', role: 'venue' } }, { authorization: 'Bearer original' }, true);
    assert.equal(JSON.parse(store.get(DASHBOARD_SESSION_KEY)).account.role, 'venue');
    store.set(DASHBOARD_SESSION_KEY, JSON.stringify({ accessToken: 'different-login', account: { id: 'different-user', role: 'customer' } }));
    persistResponseSession({ account: { id: 'same-user', role: 'venue' }, session: { accessToken: 'obsolete-rotated' } }, { authorization: 'Bearer original' }, true);
    assert.equal(JSON.parse(store.get(DASHBOARD_SESSION_KEY)).account.id, 'different-user');
    assert.equal(JSON.parse(store.get(DASHBOARD_SESSION_KEY)).accessToken, 'different-login');
  } finally { globalThis.window = previousWindow; }
});
