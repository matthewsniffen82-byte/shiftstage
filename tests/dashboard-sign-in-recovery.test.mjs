import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/dashboard/DashboardClient.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('recovery.tsx', source, ts.ScriptTarget.Latest, true);
const component = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'DashboardSignInRecovery');
const code = ts.transpileModule(`${component.getText(file)}\nexport { DashboardSignInRecovery };`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function fixture(account) {
  const states = [], refs = [], effects = [], requests = [], saved = [];
  let stateIndex = 0, refIndex = 0, mounted = true, opened = 0;
  let response = { ok: false, body: { ok: false, error: 'Email or password is incorrect.' } };
  const exports = {};
  vm.runInNewContext(code, {
    exports, Error, AbortController, PasswordField: 'password-field',
    require: name => require(name),
    useState(initial) {
      const index = stateIndex++;
      if (mounted) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useRef(initial) { return refs[refIndex++] ||= { current: initial }; },
    useEffect(effect) { if (mounted) effects.push(effect); },
    readSession: () => ({ account }), storedSessionAccount: session => session.account,
    captureBrowserAuthSessionGuard: () => () => true,
    persistDashboardSession: session => { saved.push(session); return true; },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: response.ok, json: async () => response.body }; },
  });
  const render = () => { stateIndex = refIndex = 0; const tree = exports.DashboardSignInRecovery({ role: 'venue', onSignedIn: () => opened++ }); mounted = false; return tree; };
  render().props.onClick(); effects.forEach(effect => effect());
  return { render, saved, requests, get opened() { return opened; }, respond(next) { response = next; } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test('recovery suggests only the email from the matching expired account and keeps it editable', () => {
  for (const account of [{ role: 'venue', email: 'registered@example.test' }, { role: 'customer', email: 'other@example.test' }, null]) {
    const app = fixture(account), input = nodes(app.render()).find(node => node.type === 'input');
    assert.equal(input.props.value, account?.role === 'venue' ? account.email : '');
    input.props.onChange({ target: { value: 'corrected@example.test' } });
    assert.equal(nodes(app.render()).find(node => node.type === 'input').props.value, 'corrected@example.test');
    assert.equal(nodes(app.render()).find(node => node.type === 'password-field').props.autoComplete, 'current-password');
    assert.equal(nodes(app.render()).some(node => node.props?.['aria-label'] === 'Password requirements'), false);
  }
});

test('a failed sign-in stays open with its error before the action and never saves credentials', async () => {
  const app = fixture({ role: 'venue', email: 'registered@example.test' });
  nodes(app.render()).find(node => node.type === 'password-field').props.onChange({ target: { value: 'synthetic-password' } });
  await app.render().props.onSubmit({ preventDefault() {} });
  assert.equal(app.opened, 0); assert.equal(app.saved.length, 0);
  const tree = nodes(app.render()), message = tree.findIndex(node => node.props?.role === 'status');
  assert.equal(tree[message].props.children, 'Email or password is incorrect.');
  assert.ok(message < tree.findIndex(node => node.type === 'button' && node.props.type === 'submit'));
  assert.equal(tree.find(node => node.props.type === 'submit').props.disabled, false);
});

test('valid venue sign-in saves the verified session and reopens the dashboard', async () => {
  const app = fixture({ role: 'venue', email: 'registered@example.test' });
  app.respond({ ok: true, body: { ok: true, account: { role: 'venue', email: 'registered@example.test' }, session: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' } } });
  await app.render().props.onSubmit({ preventDefault() {} });
  assert.equal(app.saved.length, 1); assert.equal(app.opened, 1);
  assert.equal(JSON.parse(app.requests[0].options.body).email, 'registered@example.test');
  assert.equal(app.saved[0].account.role, 'venue');
});
