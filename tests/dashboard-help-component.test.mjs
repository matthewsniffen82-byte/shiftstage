import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as knowledge from '../src/lib/dancr/dashboard-help.ts';
import { sendHelpMessage } from '../app/components/dashboard-help-support.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/components/DashboardHelp.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
  return null;
};
const plainText = node => typeof node === 'string' ? node : !node || typeof node !== 'object' ? '' : [node.props?.children].flat(Infinity).map(plainText).join(' ');

function fixture(role = 'customer') {
  let active;
  let session = { accessToken: 'example-token', account: { id: 'account-one', role: knowledge.helpSupportRole(role) || 'admin' } };
  const calls = [], listeners = new Map();
  let respond = async () => ({ ok: true, thread: { id: 'receipt-one' } });
  const hooks = {
    useState(initial) { const instance = active, slot = instance.index++; if (!(slot in instance.slots)) instance.slots[slot] = typeof initial === 'function' ? initial() : initial; return [instance.slots[slot], next => { instance.slots[slot] = typeof next === 'function' ? next(instance.slots[slot]) : next; }]; },
    useRef(initial) { const instance = active, slot = instance.index++; return instance.slots[slot] ||= { current: initial }; },
    useId() { active.index++; return 'help-test'; },
    useEffect(effect, deps) { const instance = active, slot = instance.index++, previous = instance.slots[slot]; if (!previous || deps.some((value, index) => value !== previous.deps[index])) { instance.effects.push(() => { previous?.cleanup?.(); instance.slots[slot] = { deps, cleanup: effect() }; }); } },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, AbortController, crypto, Error, document: { body: {} },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react-dom') return { createPortal: node => node };
      if (name === 'react/jsx-runtime') return require(name);
      if (name.endsWith('/dashboard-help')) return knowledge;
      if (name === './dashboard-help-support') return { sendHelpMessage };
      if (name.endsWith('/dashboard-session')) return { readSession: () => session, requestDashboardJson: async (...args) => { calls.push(args); return respond(...args); } };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, name) => name }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  function mount(component, props) {
    const instance = { slots: [], index: 0, effects: [] };
    return {
      render() { active = instance; instance.index = 0; instance.effects = []; const tree = component(props); for (const effect of instance.effects) effect(); return tree; },
      unmount() { for (const slot of instance.slots) slot?.cleanup?.(); },
    };
  }
  const parent = mount(exports.default, { role, accountId: 'account-one' });
  const internal = mount(exports.InternalDashboardHelp, {});
  find(parent.render(), node => node.type === 'button').props.onClick();
  const child = find(parent.render(), node => typeof node.type === 'function');
  const dialog = mount(child.type, child.props);
  const render = () => dialog.render();
  const button = label => find(render(), node => node.type === 'button' && plainText(node) === label);
  const ask = question => {
    find(render(), node => node.type === 'input').props.onChange({ target: { value: question } });
    find(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  };
  return {
    calls, render, button, ask, text: () => plainText(render()),
    handoff() { button('Send to the team').props.onClick(); },
    draft(text) { find(render(), node => node.type === 'textarea').props.onChange({ target: { value: text } }); },
    submit: () => find(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    respond(fn) { respond = fn; },
    switchAccount() { session = { ...session, account: { ...session.account, id: 'account-two' } }; listeners.get('storage')?.(); },
    closed: () => !find(parent.render(), node => typeof node.type === 'function'),
    internalHelp() { internal.render(); return internal.render(); },
    signOut() { session = null; },
    unmount() { dialog.unmount(); parent.unmount(); internal.unmount(); },
  };
}

test('local questions and topic buttons never call a service; unknown answers offer handoff', () => {
  const f = fixture('dancer');
  f.ask('How do I adjust my avatar?');
  assert.match(f.text(), /position the part of the photo/);
  f.ask('Will it rain tomorrow?');
  assert.match(f.text(), /don’t have a reliable answer/);
  f.button('Browse topics').props.onClick();
  f.button('View my results').props.onClick();
  assert.match(f.text(), /cannot read your current totals/);
  assert.equal(f.calls.length, 0);
  f.unmount();
});
test('human handoff is reviewed and editable, with no send until submission', async () => {
  const f = fixture();
  f.ask('A button is missing'); f.handoff();
  assert.equal(f.calls.length, 0);
  assert.match(find(f.render(), node => node.type === 'textarea').props.value, /A button is missing/);
  f.draft('Reviewed details only');
  await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(JSON.parse(f.calls[0][1].body).message, 'Reviewed details only');
  assert.match(f.text(), /Message sent to the team/);
  assert.equal(find(f.render(), node => node.type === 'form'), null);
  f.unmount();
});
test('duplicate clicks are blocked and delivery waits for a server receipt', async () => {
  const f = fixture('vip');
  let resolve;
  f.respond(() => new Promise(done => { resolve = done; }));
  f.handoff(); f.draft('Please help with a visit');
  const pending = f.submit();
  await f.submit();
  assert.equal(f.calls.length, 1);
  assert.equal(f.button('Sending…').props.disabled, true);
  assert.doesNotMatch(f.text(), /Message sent to the team/);
  resolve({ thread: { id: 'receipt' } }); await pending;
  assert.match(f.text(), /Message sent to the team/);
  f.unmount();
});
test('retries retain the draft and idempotency key after an uncertain response', async () => {
  const f = fixture('staff');
  f.respond(async () => { throw new Error('Connection lost'); });
  f.handoff(); f.draft('Table request is stuck');
  await f.submit();
  const first = JSON.parse(f.calls[0][1].body);
  assert.match(f.text(), /Connection lost/);
  assert.equal(find(f.render(), node => node.type === 'textarea').props.value, 'Table request is stuck');
  f.respond(async () => ({ thread: { id: 'receipt' } }));
  await f.submit();
  assert.equal(JSON.parse(f.calls[1][1].body).requestId, first.requestId);
  assert.equal(f.calls[0][1].expectedRole, 'venue');
  f.unmount();
});
test('account switching closes private chat and prevents stale submissions', async () => {
  const f = fixture();
  f.handoff(); f.draft('Private question'); f.switchAccount();
  assert.equal(f.closed(), true);
  await f.submit();
  assert.equal(f.calls.length, 0);
  assert.match(f.text(), /sign-in changed/);
  f.unmount();
});
test('closing a pending handoff aborts delivery handling', async () => {
  const f = fixture(); let resolve;
  f.respond(() => new Promise(done => { resolve = done; }));
  f.handoff(); f.draft('Please help');
  const pending = f.submit(); f.unmount();
  assert.equal(f.calls[0][1].signal.aborted, true);
  resolve({ thread: { id: 'late' } }); await pending;
  assert.doesNotMatch(f.text(), /Message sent to the team/);
});
for (const role of ['admin', 'reviewer', 'support', 'billing']) test(`${role} prepares email without claiming delivery`, () => {
  const f = fixture(role);
  f.handoff(); f.draft('Need help with this workspace');
  const email = find(f.render(), node => node.type === 'a' && plainText(node) === 'Open email');
  assert.match(email.props.href, /^mailto:support@mydancr.com\?/);
  assert.match(f.text(), /Opening the draft does not send it/);
  assert.doesNotMatch(f.text(), /Message sent to the team/);
  assert.equal(f.calls.length, 0);
  f.unmount();
});
test('shared internal links expose dashboard help only to signed-in club or admin accounts', () => {
  for (const [role, expected] of [['staff', 'staff'], ['venue', 'staff'], ['admin', 'admin'], ['customer', null], ['dancer', null]]) {
    const f = fixture(role);
    assert.equal(f.internalHelp()?.props.role || null, expected);
    assert.equal(f.calls.length, 0);
    f.unmount();
  }
  const signedOut = fixture('staff'); signedOut.signOut();
  assert.equal(signedOut.internalHelp(), null);
  signedOut.unmount();
});
