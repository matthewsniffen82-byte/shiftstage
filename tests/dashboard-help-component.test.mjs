import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as knowledge from '../src/lib/dancr/dashboard-help.ts';
import * as support from '../app/components/dashboard-help-support.ts';

const require = createRequire(import.meta.url);
const compile = file => ts.transpileModule(readFileSync(new URL(`../app/components/${file}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const code = compile('DashboardHelp'), messagesCode = compile('DashboardHelpMessages');
const flush = () => new Promise(resolve => setImmediate(resolve));
const find = (node, predicate) => {
  if (!node || typeof node !== 'object' || node.props?.hidden) return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = find(child, predicate); if (result) return result; }
  return null;
};
const plainText = node => typeof node === 'string' ? node : !node || typeof node !== 'object' || node.props?.hidden ? '' : [node.props?.children].flat(Infinity).map(plainText).join(' ');
const thread = (id = 'receipt-one', body = 'Reviewed details only') => ({ id, subject: 'Existing conversation', status: 'open', lastMessageAt: '2026-10-25T12:00:00Z', messages: [{ id: 'm-one', body, senderRole: 'customer', createdAt: '2026-10-25T12:00:00Z' }] });

function fixture(role = 'customer', { messages = false, hash = '' } = {}) {
  let active, draft = '', revision = 0;
  let session = { accessToken: 'example-token', account: { id: 'account-one', role: knowledge.helpSupportRole(role) || 'admin' } };
  const calls = [], listeners = new Map(), mounted = [];
  let respond = async (_url, options) => options.method === 'GET' ? { threads: [] } : { thread: thread() };
  const hooks = {
    useState(initial) { const instance = active, slot = instance.index++; if (!(slot in instance.slots)) instance.slots[slot] = typeof initial === 'function' ? initial() : initial; return [instance.slots[slot], next => { instance.slots[slot] = typeof next === 'function' ? next(instance.slots[slot]) : next; }]; },
    useRef(initial) { const instance = active, slot = instance.index++; return instance.slots[slot] ||= { current: initial }; },
    useId() { active.index++; return 'help-test'; },
    useCallback(fn, deps) { const instance = active, slot = instance.index++, previous = instance.slots[slot]; if (!previous || deps.some((value, index) => value !== previous.deps[index])) instance.slots[slot] = { deps, fn }; return instance.slots[slot].fn; },
    useEffect(effect, deps) { const instance = active, slot = instance.index++, previous = instance.slots[slot]; if (!previous || deps.some((value, index) => value !== previous.deps[index])) { instance.effects.push(() => { previous?.cleanup?.(); instance.slots[slot] = { deps, cleanup: effect() }; }); } },
  };
  const window = {
    location: { hash },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
  };
  const events = { OPEN_DASHBOARD_HELP: 'dancr:open-dashboard-help', DASHBOARD_HELP_UPDATED: 'dancr:dashboard-help-updated', openDashboardHelp: (accountId, view = 'messages') => window.dispatchEvent(new CustomEvent('dancr:open-dashboard-help', { detail: { accountId, view } })) };
  const messageExports = {}, exports = {};
  const context = {
    AbortController, crypto, Error, CustomEvent, HTMLElement: class {}, document: { body: {} }, window,
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react-dom') return { createPortal: node => node };
      if (name === 'react/jsx-runtime') return require(name);
      if (name.endsWith('/dashboard-help')) return knowledge;
      if (name === './dashboard-help-support') return support;
      if (name === './dashboard-help-events') return events;
      if (name === './DashboardHelpMessages') return messageExports;
      if (name.endsWith('/dashboard-session')) return { readSession: () => session, requestDashboardJson: async (...args) => { calls.push(args); return respond(...args); } };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, name) => name }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(messagesCode, { ...context, exports: messageExports });
  vm.runInNewContext(code, { ...context, exports });
  function mount(component, props) {
    const instance = { slots: [], index: 0, effects: [] }; mounted.push(instance);
    return { render() { const currentProps = typeof props === 'function' ? props() : props; active = instance; instance.index = 0; instance.effects = []; const tree = component(currentProps); for (const effect of instance.effects) effect(); return tree; } };
  }
  const parent = mount(exports.default, { role, accountId: 'account-one' });
  const internal = mount(exports.InternalDashboardHelp, {});
  const accountLink = mount(exports.DashboardHelpShortcut, { panelId: 'customer-support', conversationCount: 1 });
  let view;
  if (messages) view = mount(messageExports.default, () => ({ role, accountId: 'account-one', draft, draftRevision: revision, onDraftChange: next => { draft = next; } }));
  else {
    const initial = parent.render();
    if (!hash) find(initial, node => node.type === 'button').props.onClick();
    const child = find(parent.render(), node => typeof node.type === 'function');
    view = mount(child.type, () => find(parent.render(), node => typeof node.type === 'function')?.props || child.props);
  }
  const render = () => { view.render(); return view.render(); };
  const button = label => find(render(), node => node.type === 'button' && plainText(node) === label);
  return {
    calls, render, button, text: () => plainText(render()),
    posts: () => calls.filter(([, options]) => options.method === 'POST'),
    ask(question) { find(render(), node => node.type === 'input').props.onChange({ target: { value: question } }); find(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} }); },
    handoff() { button('Message the team').props.onClick(); },
    draft(text) { find(render(), node => node.type === 'textarea').props.onChange({ target: { value: text } }); },
    submit: () => find(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    respond(fn) { respond = fn; },
    switchAccount() { session = { ...session, account: { ...session.account, id: 'account-two' } }; window.dispatchEvent(new Event('storage')); },
    closed: () => !find(parent.render(), node => typeof node.type === 'function'),
    internalHelp() { internal.render(); return internal.render(); },
    signOut() { session = null; },
    shortcut(accountId = 'account-one') { events.openDashboardHelp(accountId); },
    clickAccountLink() { find(accountLink.render(), node => node.type === 'button').props.onClick(); },
    deepLink(value) { window.location.hash = value; window.dispatchEvent(new Event('hashchange')); },
    messagesProps: () => find(render(), node => node.type === messageExports.default)?.props,
    unmount() { for (const instance of mounted) for (const slot of instance.slots) slot?.cleanup?.(); },
  };
}

test('local answers do not call a service and the assistant stays available beside messages', () => {
  const f = fixture('dancer'); f.ask('How do I adjust my avatar?');
  assert.match(f.text(), /position the part of the photo/);
  f.ask('Will it rain tomorrow?'); assert.match(f.text(), /don’t have a reliable answer/);
  f.handoff(); assert.match(f.messagesProps().draft, /Will it rain tomorrow/);
  f.button('Ask assistant').props.onClick(); assert.match(f.text(), /Will it rain tomorrow/);
  assert.equal(f.calls.length, 0); f.unmount();
});
test('account shortcut and old support links open Messages in the same dialog', () => {
  for (const role of ['customer', 'dancer', 'venue', 'vip', 'staff']) {
    const f = fixture(role); f.render(); f.clickAccountLink();
    assert.equal(f.button('Messages').props['aria-pressed'], true);
    f.button('Ask assistant').props.onClick();
    f.deepLink(`#${knowledge.helpSupportRole(role)}-support`);
    assert.equal(f.button('Messages').props['aria-pressed'], true);
    assert.ok(f.messagesProps()); f.unmount();
  }
});
test('opening an old support URL starts in Messages without a second click', () => {
  for (const hash of ['#customer-support', '#customer-support-section']) {
    const f = fixture('customer', { hash });
    assert.equal(f.button('Messages').props['aria-pressed'], true); f.unmount();
  }
});
test('cross-account open requests are ignored and switching accounts closes help', () => {
  const f = fixture(); f.render(); f.shortcut('someone-else');
  assert.equal(f.button('Ask assistant').props['aria-pressed'], true);
  f.switchAccount(); assert.equal(f.closed(), true); f.unmount();
});
test('prior conversations and team replies load and stay in the panel', async () => {
  const f = fixture('customer', { messages: true });
  const previous = thread('old', 'Original question'); previous.messages.push({ id: 'admin-reply', body: 'Here is the answer from the team.', senderRole: 'admin' });
  f.respond(async () => ({ threads: [previous] })); f.render(); await flush();
  find(f.render(), node => node.type === 'button' && node.key === 'old').props.onClick();
  assert.match(f.text(), /Original question/); assert.match(f.text(), /Here is the answer from the team/);
  assert.match(f.text(), /MyDancr team/); assert.equal(f.posts().length, 0); f.unmount();
});
test('reviewed message sends once, opens its conversation and supports replies', async () => {
  const f = fixture('vip', { messages: true }); f.render(); await flush();
  f.draft('Reviewed details only'); await f.submit();
  assert.equal(f.posts().length, 1); assert.equal(JSON.parse(f.posts()[0][1].body).message, 'Reviewed details only');
  assert.match(f.text(), /Replies will appear in this conversation/);
  f.draft('Follow-up question');
  f.respond(async () => ({ thread: { ...thread(), messages: [...thread().messages, { id: 'reply', body: 'Follow-up question', senderRole: 'customer' }] } }));
  await f.submit();
  assert.equal(JSON.parse(f.posts()[1][1].body).threadId, 'receipt-one');
  assert.match(f.text(), /Reply sent to the team/);
  assert.equal(find(f.render(), node => node.type === 'textarea').props.value, ''); f.unmount();
});
test('duplicate clicks are blocked, and failed sends retain their draft and retry key', async () => {
  const f = fixture('staff', { messages: true }); f.render(); await flush();
  let resolve; f.respond(() => new Promise(done => { resolve = done; }));
  f.draft('Please help'); const pending = f.submit(); await f.submit();
  assert.equal(f.posts().length, 1); assert.equal(f.button('Sending…').props.disabled, true);
  resolve({}); await pending;
  assert.equal(find(f.render(), node => node.type === 'textarea').props.value, 'Please help');
  const requestId = JSON.parse(f.posts()[0][1].body).requestId;
  f.respond(async () => ({ thread: thread() })); await f.submit();
  assert.equal(JSON.parse(f.posts()[1][1].body).requestId, requestId);
  assert.equal(f.posts()[1][1].expectedRole, 'venue'); f.unmount();
});
test('late history reads cannot erase a newly sent conversation', async () => {
  const f = fixture('customer', { messages: true }); let resolveRead;
  f.respond(async (_url, options) => options.method === 'GET' ? new Promise(done => { resolveRead = done; }) : { thread: thread() });
  f.render(); f.draft('New question'); await f.submit();
  resolveRead({ threads: [] }); await flush();
  assert.match(f.text(), /Existing conversation/); assert.match(f.text(), /Message sent to the team/); f.unmount();
});
test('switching conversations preserves reply drafts and uncertain-send retry keys', async () => {
  const f = fixture('customer', { messages: true });
  const first = { ...thread('first'), subject: 'First conversation' }, second = { ...thread('second'), subject: 'Second conversation' };
  f.respond(async () => ({ threads: [first, second] })); f.render(); await flush();
  find(f.render(), node => node.type === 'button' && node.key === 'first').props.onClick();
  f.draft('First reply'); f.respond(async () => { throw new Error('Connection lost'); }); await f.submit();
  const requestId = JSON.parse(f.posts()[0][1].body).requestId;
  f.button('‹ All conversations / new message').props.onClick();
  find(f.render(), node => node.type === 'button' && node.key === 'second').props.onClick();
  f.draft('Second reply'); f.respond(async () => ({ thread: second })); await f.submit();
  f.button('‹ All conversations / new message').props.onClick();
  find(f.render(), node => node.type === 'button' && node.key === 'first').props.onClick();
  assert.equal(find(f.render(), node => node.type === 'textarea').props.value, 'First reply');
  f.respond(async () => ({ thread: first })); await f.submit();
  assert.equal(JSON.parse(f.posts()[2][1].body).requestId, requestId); f.unmount();
});
test('refresh failures preserve history and draft; Refresh messages can recover', async () => {
  const f = fixture('customer', { messages: true });
  f.respond(async () => ({ threads: [thread('old')] })); f.render(); await flush(); f.draft('Unsent question');
  f.respond(async () => { throw new Error('Offline'); }); f.button('Refresh messages').props.onClick(); await flush();
  assert.match(f.text(), /Offline/); assert.match(f.text(), /Existing conversation/);
  assert.equal(find(f.render(), node => node.type === 'textarea').props.value, 'Unsent question');
  f.respond(async () => ({ threads: [thread('old')] })); f.button('Refresh messages').props.onClick(); await flush();
  assert.doesNotMatch(f.text(), /Offline/); f.unmount();
});
test('account switches block old submissions and suppress late reads', async () => {
  const f = fixture('customer', { messages: true }); let resolve;
  f.respond(() => new Promise(done => { resolve = done; })); f.render(); f.switchAccount();
  resolve({ threads: [thread('private')] }); await flush();
  assert.doesNotMatch(f.text(), /Existing conversation/); f.draft('Old account question'); await f.submit();
  assert.equal(f.posts().length, 0); assert.match(f.text(), /sign-in changed/); f.unmount();
});
test('closing while sending aborts delivery handling', async () => {
  const f = fixture('customer', { messages: true }); f.render(); await flush(); let resolve;
  f.respond(() => new Promise(done => { resolve = done; })); f.draft('Please help');
  const pending = f.submit(); f.unmount(); assert.equal(f.posts()[0][1].signal.aborted, true);
  resolve({ thread: thread() }); await pending; assert.doesNotMatch(f.text(), /Message sent to the team/);
});
for (const role of ['admin', 'reviewer', 'support', 'billing']) test(`${role} prepares email without claiming in-app delivery`, () => {
  const f = fixture(role, { messages: true }); f.render(); f.draft('Need help');
  const email = find(f.render(), node => node.type === 'a' && plainText(node) === 'Open email');
  assert.match(email.props.href, /^mailto:support@mydancr.com\?/); assert.match(f.text(), /Replies will arrive in your email inbox/);
  assert.equal(f.calls.length, 0); f.unmount();
});
test('shared internal links offer dashboard help only to signed-in club or admin accounts', () => {
  for (const [role, expected] of [['staff', 'staff'], ['venue', 'staff'], ['admin', 'admin'], ['customer', null], ['dancer', null]]) {
    const f = fixture(role); assert.equal(f.internalHelp()?.props.role || null, expected); f.unmount();
  }
  const f = fixture('staff'); f.signOut(); assert.equal(f.internalHelp(), null); f.unmount();
});
