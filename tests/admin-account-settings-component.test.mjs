import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('app/admin/AdminAccountSettings.tsx', 'utf8');
const ast = ts.createSourceFile('settings.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const form = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ChangeAdminEmail');
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
const text = node => typeof node === 'string' ? node : [node?.props?.children].flat(Infinity).map(child => typeof child === 'object' ? text(child) : String(child ?? '')).join('');
const settle = () => new Promise(resolve => setImmediate(resolve));

function mount() {
  const slots = [], effects = [], pending = []; let cursor = 0, tree, accountId = 'admin';
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useEffect(effect, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) { old?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = effect(); }); } },
  };
  const exports = {}, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(form.getText(ast) + '\nexport { ChangeAdminEmail };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, ...hooks, AbortController, Error, styles: {},
    readAdminSession: () => accountId ? { account: { id: accountId } } : null,
    requestAdminJson: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })),
    require: name => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; },
  });
  function render() { cursor = 0; tree = exports.ChangeAdminEmail({ accountId: 'admin' }); while (effects.length) effects.shift()(); return nodes(tree); }
  render();
  return { pending, render, all: () => nodes(tree), text: () => text(tree),
    input(id, value) { nodes(tree).find(node => node.props?.id === id).props.onChange({ target: { value } }); render(); },
    submit() { const result = nodes(tree).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); render(); return result; },
    async complete(index, data = { userId: 'admin', email: null, username: 'owner', usernameOnly: true }) { pending[index].resolve(data); await settle(); render(); },
    async fail(index) { pending[index].reject(new Error('Please try again.')); await settle(); render(); },
    switchAccount(id) { accountId = id; }, close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('email form shows current account, prevents duplicate sends and waits for inbox proof', async () => {
  const f = mount(); await f.complete(0);
  assert.match(f.text(), /Current username: owner/);
  f.input('admin-new-email', 'new@example.invalid'); f.input('admin-current-password', 'current-password');
  const submitting = f.submit(); f.submit();
  assert.equal(f.pending.length, 2); assert.equal(f.pending[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(f.pending[1].options.body), { email: 'new@example.invalid', currentPassword: 'current-password' });
  assert.ok(f.all().find(node => node.props?.type === 'submit').props.disabled);
  await f.complete(1, { userId: 'admin', message: 'Check your new inbox to finish.' }); await submitting;
  assert.match(f.text(), /Check your new inbox/); assert.match(f.text(), /Current username: owner/);
  assert.equal(f.all().find(node => node.props?.id === 'admin-current-password').props.value, ''); f.close();
});

test('loading and send failures are retryable and never claim the email changed', async () => {
  const f = mount(); await f.fail(0);
  f.all().find(node => node.type === 'button' && text(node) === 'Try again').props.onClick(); f.render();
  await f.complete(1, { userId: 'admin', email: 'current@example.invalid', usernameOnly: false });
  assert.match(f.text(), /both your current and new inboxes/);
  f.input('admin-new-email', 'new@example.invalid'); f.input('admin-current-password', 'wrong');
  const submitted = f.submit(); await f.fail(2); await submitted;
  assert.match(f.text(), /Please try again/); assert.match(f.text(), /Current email: current@example.invalid/);
  assert.equal(f.all().find(node => node.props?.id === 'admin-current-password').props.value, '');
  assert.equal(f.all().find(node => node.props?.type === 'submit').props.disabled, false); f.close();
});

test('closing settings aborts requests and a changed account cannot receive stale confirmation feedback', async () => {
  const closed = mount(); closed.close(); assert.equal(closed.pending[0].options.signal.aborted, true);
  await closed.complete(0); assert.equal(closed.all().some(node => node.type === 'form'), false);
  const f = mount(); await f.complete(0);
  f.input('admin-new-email', 'new@example.invalid'); f.input('admin-current-password', 'password');
  const submitted = f.submit(); f.switchAccount('another-admin');
  await f.complete(1, { userId: 'admin', message: 'Private confirmation message' }); await submitted;
  assert.doesNotMatch(f.text(), /Private confirmation message/); f.close();
  assert.equal(f.pending[1].options.signal.aborted, false); // It already settled; no late UI update was accepted.
});
