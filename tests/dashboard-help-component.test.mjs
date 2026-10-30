import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as knowledge from '../src/lib/dancr/dashboard-help.ts';
import * as support from '../app/components/dashboard-help-support.ts';
import { lockHelpPageScroll } from '../app/components/dashboard-help-scroll.ts';

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

function styleDeclaration() {
  const properties = new Map();
  return {
    getPropertyValue: name => properties.get(name)?.value || '',
    getPropertyPriority: name => properties.get(name)?.priority || '',
    setProperty: (name, value, priority = '') => properties.set(name, { value, priority }),
    removeProperty: name => properties.delete(name),
  };
}

function scrollPage() {
  const document = { body: { style: styleDeclaration() }, documentElement: { style: styleDeclaration(), clientWidth: 390 } };
  const window = {
    scrollX: 0, scrollY: 840, innerWidth: 390,
    getComputedStyle: () => ({ paddingRight: '8px' }),
    scrollTo({ left, top, behavior }) { this.scrollX = left; this.scrollY = top; this.lastScrollBehavior = behavior; },
  };
  return { document, window };
}

function fixture(role = 'customer', { messages = false, hash = '', startInMessages = false, renderMessages, onOpenChange, helpContext = 'dashboard' } = {}) {
  let active, draft = '', revision = 0;
  const renderInbox = renderMessages || (['admin', 'support'].includes(role) ? active => ({ type: 'AdminInbox', props: { active } }) : undefined);
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
  const page = scrollPage();
  const window = {
    ...page.window,
    setInterval: () => 1, clearInterval: () => {},
    location: { hash, pathname: '/dashboard/venue', search: '?help=support' },
    history: {
      state: { dashboard: 'preserved' },
      replaceState(state, _title, url) {
        this.state = state;
        const parsed = new URL(url, 'https://example.test');
        Object.assign(window.location, { hash: parsed.hash, pathname: parsed.pathname, search: parsed.search });
      },
    },
    addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    dispatchEvent(event) { for (const fn of [...(listeners.get(event.type) || [])]) fn(event); },
  };
  page.document.visibilityState = 'visible';
  page.document.addEventListener = window.addEventListener;
  page.document.removeEventListener = window.removeEventListener;
  const events = { OPEN_DASHBOARD_HELP: 'dancr:open-dashboard-help', DASHBOARD_HELP_UPDATED: 'dancr:dashboard-help-updated', openDashboardHelp: (accountId, view = 'messages') => window.dispatchEvent(new CustomEvent('dancr:open-dashboard-help', { detail: { accountId, view } })) };
  const messageExports = {}, exports = {};
  const context = {
    AbortController, crypto, Error, CustomEvent, HTMLElement: class {}, document: page.document, window,
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react-dom') return { createPortal: node => node };
      if (name === 'react/jsx-runtime') return require(name);
      if (name.endsWith('/dashboard-help')) return knowledge;
      if (name === './dashboard-help-support') return support;
      if (name === './dashboard-help-events') return events;
      if (name === './dashboard-help-scroll') return { lockHelpPageScroll: () => lockHelpPageScroll(page.document, window) };
      if (name === './DashboardHelpMessages') return messageExports;
      if (name === './SupportMessageReadTracker') return { default: 'ReadTracker' };
      if (name === './dashboard-message-unread') return { useSupportUnreadCount: (_id, enabled) => enabled ? 2 : null, MESSAGES_READ: 'dancr:messages-read' };
      if (name.endsWith('/dashboard-session')) return { readSession: () => session, requestDashboardJson: async (...args) => { calls.push(args); return respond(...args); } };
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_, name) => name }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(messagesCode, { ...context, exports: messageExports });
  vm.runInNewContext(code, { ...context, exports });
  function attachConversationRef(node) {
    if (!node || typeof node !== 'object') return;
    if (node.props?.['aria-label'] === 'Help conversation' && node.props.ref && !node.props.ref.current) {
      node.props.ref.current = { scrollTop: 0, scrollHeight: 900 };
    }
    for (const child of [node.props?.children].flat(Infinity)) attachConversationRef(child);
  }
  function mount(component, props) {
    const instance = { slots: [], index: 0, effects: [] }; mounted.push(instance);
    return { render() { const currentProps = typeof props === 'function' ? props() : props; active = instance; instance.index = 0; instance.effects = []; const tree = component(currentProps); attachConversationRef(tree); for (const effect of instance.effects) effect(); return tree; } };
  }
  const parentProps = () => ({ role, context: helpContext, accountId: 'account-one', renderMessages: renderInbox, onOpenChange });
  let parent = mount(exports.default, parentProps);
  const internal = mount(exports.InternalDashboardHelp, {});
  const accountLink = mount(exports.DashboardHelpShortcut, { panelId: 'customer-support', conversationCount: 1 });
  let view;
  if (messages) view = mount(messageExports.default, () => ({ role, accountId: 'account-one', draft, draftRevision: revision, onDraftChange: next => { draft = next; } }));
  else {
    const initial = parent.render();
    if (!hash) find(initial, node => node.type === 'button' && plainText(node).includes('Help')).props.onClick();
    const child = find(parent.render(), node => typeof node.type === 'function');
    view = mount(child.type, () => find(parent.render(), node => typeof node.type === 'function')?.props || child.props);
  }
  if (!messages && !hash && !startInMessages) find(view.render(), node => node.type === 'button' && plainText(node) === 'Quick Help').props.onClick();
  const render = () => { view.render(); return view.render(); };
  const button = label => find(render(), node => node.type === 'button' && plainText(node).replace(/\s+/g, ' ').trim() === label);
  return {
    calls, render, button, document: page.document, window, text: () => plainText(render()),
    changeContext(value) { helpContext = value; render(); },
    header: () => parent.render(),
    headerMessages: () => find(parent.render(), node => node.type === 'button' && node.props['aria-label']?.startsWith('Help & Messages')),
    posts: () => calls.filter(([, options]) => options.method === 'POST'),
    ask(question) { find(render(), node => node.type === 'input').props.onChange({ target: { value: question } }); find(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} }); },
    handoff() { button('Message the MyDancr Team').props.onClick(); },
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
    close() { find(render(), node => ['Close help', 'Close messages'].includes(node.props?.['aria-label'])).props.onClick(); },
    location: window.location, history: window.history,
    remountHelp() {
      for (const instance of mounted) for (const slot of instance.slots) slot?.cleanup?.();
      parent = mount(exports.default, parentProps);
      parent.render(); parent.render();
    },
    messagesProps: () => find(render(), node => node.type === messageExports.default)?.props,
    unmount() { for (const instance of mounted) for (const slot of instance.slots) slot?.cleanup?.(); },
  };
}

test('every dashboard has one combined launcher with Messages selected first and Quick Help inside', () => {
  for (const role of ['customer', 'dancer', 'venue', 'vip', 'staff', 'reviewer', 'billing', 'admin', 'support']) {
    const f = fixture(role, { startInMessages: true });
    const hasUnread = knowledge.helpSupportRole(role) || ['admin', 'support'].includes(role);
    assert.match(f.headerMessages().props['aria-label'], hasUnread ? /Help & Messages, 2 unread/ : /^Help & Messages$/);
    assert.equal(f.headerMessages().props['aria-haspopup'], 'dialog');
    assert.equal([f.header().props.children].flat().filter(node => node?.type === 'button').length, 1);
    assert.equal(f.button('Messages').props['aria-pressed'], true);
    f.button('Quick Help').props.onClick(); assert.equal(f.button('Quick Help').props['aria-pressed'], true);
    f.headerMessages().props.onClick(); assert.equal(f.button('Messages').props['aria-pressed'], true);
    f.unmount();
  }
});

test('admin and support share the panel with their inbox; hidden messages pause reading and the panel releases its state', () => {
  for (const role of ['admin', 'support']) {
    const opened = [];
    const f = fixture(role, { startInMessages: true, onOpenChange: value => opened.push(value) });
    assert.equal(find(f.render(), node => node.type === 'AdminInbox').props.active, true);
    assert.equal(f.messagesProps(), undefined, 'admin inbox does not use the customer or email form');
    f.button('Quick Help').props.onClick();
    assert.equal(find(f.render(), node => node.type === 'AdminInbox'), null);
    f.button('Open messages').props.onClick();
    assert.equal(find(f.render(), node => node.type === 'AdminInbox').props.active, true);
    f.close(); assert.equal(f.closed(), true); assert.equal(opened.at(-1), false);
    f.unmount();
  }
});

test('onboarding help scopes initial topics, Browse topics, questions and support shortcuts', () => {
  const f = fixture('dancer', { helpContext: 'dancer-onboarding' });
  assert.match(f.text(), /Dancer setup/);
  assert.match(f.text(), /setting up your dancer profile/);
  for (const topic of knowledge.DANCER_ONBOARDING_HELP_TOPICS.slice(0, 4)) assert.ok(f.button(topic.title));
  f.button('Browse topics').props.onClick();
  for (const topic of knowledge.helpTopicsFor('dancer', 'dancer-onboarding')) assert.ok(f.button(topic.title));
  for (const title of ['Start or end Working Now', 'View my results', 'Choose public or club-only visibility']) assert.equal(f.button(title), null);
  f.ask('How do I view my results?');
  assert.match(f.text(), /don’t have a reliable answer/);
  assert.doesNotMatch(f.text(), /Open Results/);
  f.clickAccountLink();
  assert.equal(f.button('Messages').props['aria-pressed'], true);
  assert.equal(f.messagesProps().role, 'dancer');
  f.button('Quick Help').props.onClick();
  assert.match(f.text(), /setting up your dancer profile/);
  assert.equal(f.calls.length, 0);
  f.unmount();
});

test('club application help hides operational topics and restores them after approval', () => {
  const f = fixture('venue', { helpContext: 'venue-approval' });
  assert.match(f.text(), /Club application/);
  assert.match(f.text(), /your club application and approval/);
  for (const topic of knowledge.CLUB_APPROVAL_HELP_TOPICS.slice(0, 4)) assert.ok(f.button(topic.title));
  f.button('Browse topics').props.onClick();
  for (const topic of knowledge.CLUB_APPROVAL_HELP_TOPICS) assert.ok(f.button(topic.title));
  for (const title of ['Invite or manage the club team', 'Handle table requests', 'Manage the live roster', 'Read the operating guides']) assert.equal(f.button(title), null);
  f.ask('Handle table requests');
  assert.match(f.text(), /don’t have a reliable answer/);
  assert.doesNotMatch(f.text(), /Mark seen/);
  f.ask('approval email');
  assert.match(f.text(), /email you use to sign in/);
  f.handoff();
  const draft = f.messagesProps().draft;
  assert.equal(f.messagesProps().role, 'venue');
  f.changeContext('dashboard');
  assert.equal(f.messagesProps().draft, draft);
  f.button('Quick Help').props.onClick();
  f.button('Browse topics').props.onClick();
  assert.ok(f.button('Handle table requests'));
  assert.doesNotMatch(f.text(), /your club application and approval|email you use to sign in/);
  f.changeContext('venue-approval');
  assert.equal(f.button('Handle table requests'), null);
  assert.ok(f.button('Check my club approval'));
  assert.equal(f.calls.length, 0);
  f.unmount();
});

test('switching out of setup refreshes Quick Help while preserving the support handoff draft', () => {
  const f = fixture('dancer', { helpContext: 'dancer-onboarding' });
  f.ask('How do I upload photos?');
  assert.match(f.text(), /Pending approvals count/);
  f.handoff();
  const draft = f.messagesProps().draft;
  f.changeContext('dashboard');
  assert.equal(f.messagesProps().draft, draft);
  f.button('Quick Help').props.onClick();
  assert.ok(f.button('Start or end Working Now'));
  assert.doesNotMatch(f.text(), /Pending approvals count/);
  f.changeContext('dancer-onboarding');
  assert.equal(f.button('Start or end Working Now'), null);
  assert.ok(f.button('Save my name and city'));
  f.unmount();
});

test('dashboard selects setup help from the same approval and agreement gates as onboarding', () => {
  const source = readFileSync(new URL('../app/dashboard/DashboardClient.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('DashboardClient.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'DashboardHelp') {
      const attribute = node.attributes.properties.find(item => item.name?.getText(ast) === 'context');
      if (attribute && ts.isJsxExpression(attribute.initializer)) expression = attribute.initializer.expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression);
  for (const [role, status, agreement, expected] of [
    ['dancer', 'draft', undefined, 'dancer-onboarding'],
    ['dancer', 'pending_review', undefined, 'dancer-onboarding'],
    ['dancer', 'approved', { required: true, accepted: false }, 'dancer-onboarding'],
    ['dancer', 'approved', { required: true, accepted: true }, 'dashboard'],
    ['dancer', 'approved', undefined, 'dashboard'],
    ['venue', '', undefined, 'dashboard'],
    ['customer', '', undefined, 'dashboard'],
  ]) {
    const onboarding = source.match(/const dancerOnboarding = (.*);/)?.[1];
    assert.ok(onboarding);
    assert.equal(vm.runInNewContext(`const dancerOnboarding = (${onboarding}); ${expression}`, { role, dancerProfileStatus: status, state: { agreement } }), expected);
  }
});

test('the pending and rejected club request screen selects application help', () => {
  const source = readFileSync(new URL('../app/dashboard/DashboardClient.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('DashboardClient.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let requestBranch, context;
  function visit(node) {
    if (ts.isIfStatement(node) && node.expression.getText(ast).includes('state.venueRequest')) requestBranch = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(requestBranch);
  function findHelp(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'DashboardHelp') {
      context = node.attributes.properties.find(item => item.name?.getText(ast) === 'context')?.initializer.text;
    }
    ts.forEachChild(node, findHelp);
  }
  findHelp(requestBranch.thenStatement);
  assert.equal(context, 'venue-approval');
  const condition = requestBranch.expression.getText(ast);
  for (const status of ['pending', 'rejected']) assert.equal(vm.runInNewContext(condition, { role: 'venue', state: { venueRequest: { status } }, isLoading: false }), true);
  assert.ok(!vm.runInNewContext(condition, { role: 'venue', state: { venueRequest: null }, isLoading: false }));
});

test('local answers do not call a service and the assistant stays available beside messages', () => {
  const f = fixture('dancer'); f.ask('How do I adjust my avatar?');
  assert.match(f.text(), /position the part of the photo/);
  f.ask('Will it rain tomorrow?'); assert.match(f.text(), /don’t have a reliable answer/);
  f.handoff(); assert.match(f.messagesProps().draft, /Will it rain tomorrow/);
  f.button('Quick Help').props.onClick(); assert.match(f.text(), /Will it rain tomorrow/);
  assert.equal(f.calls.length, 0); f.unmount();
});

test('help starts at the introduction, then follows answers without jumping while typing', () => {
  const f = fixture('venue');
  const log = () => find(f.render(), node => node.props?.['aria-label'] === 'Help conversation').props.ref.current;
  assert.equal(log().scrollTop, 0);
  f.button('Browse topics').props.onClick();
  assert.equal(log().scrollTop, 0, 'browsing before a question should also start at the first topic');
  f.button('Hide topics').props.onClick();
  f.ask('How do I invite staff?');
  assert.equal(log().scrollTop, log().scrollHeight, 'a new answer must still come into view');
  log().scrollTop = 75;
  find(f.render(), node => node.type === 'input').props.onChange({ target: { value: 'Another question' } });
  assert.equal(log().scrollTop, 75, 'typing should preserve where the user is reading');
  f.unmount();
  const reopened = fixture('venue');
  assert.equal(find(reopened.render(), node => node.props?.['aria-label'] === 'Help conversation').props.ref.current.scrollTop, 0);
  reopened.unmount();
});
test('account shortcut and old support links open Messages in the same dialog', () => {
  for (const role of ['customer', 'dancer', 'venue', 'vip', 'staff']) {
    const f = fixture(role); f.render(); f.clickAccountLink();
    assert.equal(f.button('Messages').props['aria-pressed'], true);
    f.button('Quick Help').props.onClick();
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

test('closing linked support prevents approval refreshes from reopening it', () => {
  for (const [role, hash] of [['venue', '#venue-support'], ['venue', '#venue-support-section'], ['staff', '#venue-support'], ['dancer', '#dancer-support'], ['customer', '#customer-support'], ['vip', '#vip-support'], ['admin', '#admin-support'], ['support', '#admin-support']]) {
    const f = fixture(role, { hash });
    assert.equal(f.button('Messages').props['aria-pressed'], true);
    f.close();
    assert.equal(f.closed(), true);
    assert.equal(f.location.hash, '');
    assert.equal(f.location.pathname, '/dashboard/venue');
    assert.equal(f.location.search, '?help=support');
    assert.deepEqual(f.history.state, { dashboard: 'preserved' });
    f.remountHelp();
    assert.equal(f.closed(), true, 'refreshing a dashboard must not replay a dismissed support link');
    f.deepLink(hash);
    assert.equal(f.closed(), false, 'a new deliberate support click must still open help');
    f.unmount();
  }
});

test('closing help preserves an unrelated dashboard section', () => {
  const f = fixture('venue');
  f.deepLink('#venue-dancer-roster');
  f.close();
  assert.equal(f.location.hash, '#venue-dancer-roster');
  assert.equal(f.closed(), true);
  f.unmount();
});
test('cross-account open requests are ignored and switching accounts closes help', () => {
  const f = fixture(); f.render(); f.shortcut('someone-else');
  assert.equal(f.button('Quick Help').props['aria-pressed'], true);
  f.switchAccount(); assert.equal(f.closed(), true); f.unmount();
});
test('prior conversations and team replies load and stay in the panel', async () => {
  const f = fixture('customer', { messages: true });
  const previous = thread('old', 'Original question'); previous.messages.push({ id: 'admin-reply', body: 'Here is the answer from the team.', senderRole: 'admin' });
  f.respond(async () => ({ threads: [previous, thread('own-message')] })); f.render(); await flush();
  assert.match(plainText(find(f.render(), node => node.type === 'button' && node.key === 'old')), /New message/);
  assert.doesNotMatch(plainText(find(f.render(), node => node.type === 'button' && node.key === 'own-message')), /New message/);
  find(f.render(), node => node.type === 'button' && node.key === 'old').props.onClick();
  assert.match(f.text(), /Original question/); assert.match(f.text(), /Here is the answer from the team/);
  assert.match(f.text(), /MyDancr team/); assert.equal(f.posts().length, 0);
  previous.messages.at(-1).readAt = '2026-10-25T12:01:00Z';
  f.button('‹ Conversations').props.onClick(); f.button('Refresh').props.onClick(); await flush();
  assert.doesNotMatch(plainText(find(f.render(), node => node.type === 'button' && node.key === 'old')), /New message/);
  f.unmount();
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
  f.button('‹ Conversations').props.onClick();
  find(f.render(), node => node.type === 'button' && node.key === 'second').props.onClick();
  f.draft('Second reply'); f.respond(async () => ({ thread: second })); await f.submit();
  f.button('‹ Conversations').props.onClick();
  find(f.render(), node => node.type === 'button' && node.key === 'first').props.onClick();
  assert.equal(find(f.render(), node => node.type === 'textarea').props.value, 'First reply');
  f.respond(async () => ({ thread: first })); await f.submit();
  assert.equal(JSON.parse(f.posts()[2][1].body).requestId, requestId); f.unmount();
});
test('refresh failures preserve history and draft; Refresh messages can recover', async () => {
  const f = fixture('customer', { messages: true });
  f.respond(async () => ({ threads: [thread('old')] })); f.render(); await flush(); f.draft('Unsent question');
  f.respond(async () => { throw new Error('Offline'); }); f.button('Refresh').props.onClick(); await flush();
  assert.match(f.text(), /Offline/); assert.match(f.text(), /Existing conversation/);
  assert.equal(find(f.render(), node => node.type === 'textarea').props.value, 'Unsent question');
  f.respond(async () => ({ threads: [thread('old')] })); f.button('Refresh').props.onClick(); await flush();
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

for (const role of Object.keys(knowledge.HELP_ROLE_LABELS)) {
  test(`${role} uses shared help styling and releases the page scroll lock on unmount`, () => {
    const f = fixture(role);
    const dialog = f.render();
    assert.equal(dialog.props.className, 'dialog');
    assert.equal(find(dialog, node => node.props?.['aria-label'] === 'Help conversation').props.ref.current.scrollTop, 0);
    assert.match(f.text().replace(/\s+/g, ' '), new RegExp(`Quick answers about your ${knowledge.HELP_ROLE_LABELS[role].toLowerCase()} dashboard`));
    assert.equal(f.document.body.style.getPropertyValue('position'), 'fixed');
    assert.equal(f.document.body.style.getPropertyValue('top'), '-840px');
    assert.equal(f.document.documentElement.style.getPropertyValue('overflow'), 'hidden');
    f.window.scrollY = 0;
    f.unmount();
    assert.equal(f.document.body.style.getPropertyValue('position'), '');
    assert.equal(f.document.documentElement.style.getPropertyValue('overflow'), '');
    assert.equal(f.window.scrollY, 840);
  });

  test(`${role} shows a labeled, expanded message box`, () => {
    const f = fixture(role, { messages: true });
    assert.equal(find(f.render(), node => node.type === 'textarea').props.rows, 4);
    assert.equal(find(f.render(), node => node.type === 'textarea').props.placeholder, 'Type your message here…');
    assert.ok(find(f.render(), node => node.props?.className === 'compactSendRow'));
    assert.match(f.text(), /Your message to MyDancr/);
    f.unmount();
  });
}

test('Escape dismisses help through the same close handler', () => {
  const f = fixture('venue');
  let prevented = false;
  f.render().props.onCancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(f.closed(), true);
  f.unmount();
  assert.equal(f.document.body.style.getPropertyValue('position'), '');
});

test('scroll lock preserves existing styles, priorities, scroll offset and unrelated edits', () => {
  const { document, window } = scrollPage();
  const root = document.documentElement.style, body = document.body.style;
  root.setProperty('overflow', 'auto', 'important');
  body.setProperty('position', 'relative');
  body.setProperty('padding-right', '8px', 'important');
  window.innerWidth = 405;
  window.scrollX = 12;
  const unlock = lockHelpPageScroll(document, window);
  assert.equal(root.getPropertyPriority('overflow'), 'important');
  assert.equal(body.getPropertyValue('left'), '-12px');
  assert.equal(body.getPropertyValue('padding-right'), 'calc(8px + 15px)');
  body.setProperty('color', 'red');
  window.scrollY = 0;
  unlock();
  assert.equal(root.getPropertyValue('overflow'), 'auto');
  assert.equal(root.getPropertyPriority('overflow'), 'important');
  assert.equal(body.getPropertyValue('position'), 'relative');
  assert.equal(body.getPropertyPriority('position'), '');
  assert.equal(body.getPropertyValue('padding-right'), '8px');
  assert.equal(body.getPropertyPriority('padding-right'), 'important');
  assert.equal(body.getPropertyValue('color'), 'red');
  assert.equal(window.scrollX, 12);
  assert.equal(window.scrollY, 840);
  assert.equal(window.lastScrollBehavior, 'instant');
  window.scrollY = 900;
  unlock();
  assert.equal(window.scrollY, 900, 'repeated cleanup must not jump the page again');
});

test('mobile scroll lock leaves padding alone and survives an effect cleanup/reopen cycle', () => {
  const { document, window } = scrollPage();
  const body = document.body.style;
  body.setProperty('padding-right', '8px');
  const first = lockHelpPageScroll(document, window);
  assert.equal(body.getPropertyValue('padding-right'), '8px');
  first();
  const second = lockHelpPageScroll(document, window);
  assert.equal(body.getPropertyValue('top'), '-840px');
  second();
  assert.equal(body.getPropertyValue('top'), '');
  assert.equal(body.getPropertyValue('position'), '');
  assert.equal(window.scrollY, 840);
});
