import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync('app/admin/AdminClient.tsx', 'utf8');
const ast = ts.createSourceFile('client.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const inbox = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AdminSupportInbox');
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
const thread = i => ({ id: `thread-${i}`, subject: `Message ${i}`, status: 'open', userName: 'Club manager', userRole: 'venue', messages: [] });
const settle = () => new Promise(resolve => setImmediate(resolve));

function mount(initial = Array.from({ length: 12 }, (_, i) => thread(i))) {
  const slots = [], effects = [], pending = [], listeners = new Map(); let cursor = 0, tree, interval;
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useEffect(effect, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) { old?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = effect(); }); } },
  };
  const document = { visibilityState: 'visible', addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  const window = { setInterval(fn) { interval = fn; return 1; }, clearInterval() { interval = null; }, addEventListener: (event,fn) => listeners.set(event,fn), removeEventListener: event => listeners.delete(event) };
  const props = { threads: initial, onThreadsChange(value) { props.threads = value; } };
  const exports = {}, jsx = (type, props, key) => ({ type, props, key });
  vm.runInNewContext(compile(inbox.getText(ast) + '\nexport {AdminSupportInbox};'), {
    exports, SupportMessageReadTracker: "ReadTracker", AdminInboxActions: "ArchiveControls", ADMIN_DATA_CHANGED: "changed", ...hooks, document, window, AbortController, Error, Set,
    requestAdminJson: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })),
    asRecordArray: value => Array.isArray(value) ? value : [], formatDate: () => '', readAdminSession: () => ({ account: { id: 'admin' } }),
    require: name => { assert.equal(name, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; },
  });
  function render() { cursor = 0; tree = exports.AdminSupportInbox(props); while (effects.length) effects.shift()(); return nodes(tree); }
  render();
  return { pending, props, document, render, all: () => nodes(tree), tick: () => interval?.(), focus: () => listeners.get('visibilitychange')?.(),
    async complete(index, threads = initial, hasMore = false) { pending[index].resolve({ threads, hasMore }); await settle(); render(); },
    async fail(index) { pending[index].reject(new Error('Unavailable')); await settle(); render(); },
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('support displays more than eight messages and keeps draft replies through refresh', async () => {
  const f = mount(); await f.complete(0);
  assert.equal(f.all().filter(node => node.type === 'article' && node.props.className === 'support-inbox-thread').length, 12);
  f.all().find(node => node.type === 'textarea').props.onChange({ target: { value: 'Draft reply' } }); f.render();
  f.tick(); f.render(); assert.equal(f.all().filter(node => node.type === 'article' && node.props.className === 'support-inbox-thread').length, 12);
  await f.complete(1, [thread(99), ...f.props.threads]);
  assert.equal(f.all().filter(node => node.type === 'article' && node.props.className === 'support-inbox-thread').length, 13);
  assert.ok(f.all().some(node => node.type === 'textarea' && node.props.value === 'Draft reply'));
  assert.ok(f.pending.every(call => !call.options.method));
  const replyCard = f.all().find(node => node.type === 'article' && nodes(node).some(child => child.type === 'textarea' && child.props.value === 'Draft reply'));
  const form = nodes(replyCard).find(node => node.type === 'form');
  let prevented = false;
  form.props.onSubmit({ preventDefault() { prevented = true; } }); f.render();
  assert.equal(prevented, true);
  assert.equal(f.pending[2].options.method, 'POST');
  assert.equal(JSON.parse(f.pending[2].options.body).threadId, 'thread-0');
  assert.equal(JSON.parse(f.pending[2].options.body).message, 'Draft reply');
  form.props.onSubmit({ preventDefault() {} }); assert.equal(f.pending.length, 3);
  f.pending[2].resolve({ thread: { ...thread(0), status: 'answered', messages: [{ id: 'sent', senderRole: 'admin', body: 'Draft reply', createdAt: '2026-10-26T12:00:00Z' }] } });
  await settle(); f.render();
  assert.ok(f.all().some(node => node.props.className === 'support-inbox-message from-admin'));
  assert.ok(!f.all().some(node => node.type === 'textarea' && node.props.value === 'Draft reply'));
  f.close();
});

test('archiving support cancels stale refreshes, removes only selected threads and keeps other drafts', async () => {
  const f = mount(); await f.complete(0);
  f.all().filter(node => node.type === 'textarea')[1].props.onChange({ target: { value: 'Keep this draft' } }); f.render();
  f.tick(); f.render();
  const actions = f.all().find(node => node.type === 'ArchiveControls').props;
  actions.onStart(); f.render();
  assert.equal(f.pending[1].options.signal.aborted, true);
  assert.ok(f.all().filter(node => node.type === 'textarea').every(node => node.props.disabled));
  actions.onComplete([{ kind: 'support', id: 'thread-0' }]); actions.onSettled(); f.render();
  await f.complete(1);
  assert.equal(f.props.threads.length, 11); assert.ok(!f.props.threads.some(item => item.id === 'thread-0'));
  assert.ok(f.all().some(node => node.type === 'textarea' && node.props.value === 'Keep this draft')); f.close();
});

test('support failures retain messages, hidden pages do not poll, and late responses after unmount are ignored', async () => {
  const f = mount(); await f.complete(0); f.document.visibilityState = 'hidden'; f.tick(); assert.equal(f.pending.length, 1);
  f.document.visibilityState = 'visible'; f.focus(); await f.fail(1);
  assert.equal(f.all().filter(node => node.type === 'article' && node.props.className === 'support-inbox-thread').length, 12); assert.ok(f.all().some(node => node.props.role === 'alert'));
  f.tick(); const before = f.props.threads; f.close(); await f.complete(2, []);
  assert.equal(f.pending[2].options.signal.aborted, true); assert.equal(f.props.threads, before);
});

test('older message pages are reachable without duplicates or resetting drafts', async () => {
  const first = Array.from({ length: 100 }, (_, i) => thread(i)); const f = mount(first); await f.complete(0, first, true);
  f.all().find(node => node.type === 'button' && node.props.children === 'Load more messages').props.onClick();
  assert.match(f.pending[1].url, /page=1/); await f.complete(1, [thread(99), thread(100)], false);
  assert.equal(f.props.threads.length, 101); assert.equal(new Set(f.props.threads.map(item => item.id)).size, 101);
  assert.ok(!f.all().some(node => node.type === 'button' && node.props.children === 'Load more messages')); f.close();
});

test('support database pages prioritize open messages and use stable bounded ranges', async () => {
  const support = readFileSync('src/lib/dancr/support.ts', 'utf8');
  const ast = ts.createSourceFile('support.ts', support, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'listAdminSupportThreads');
  const calls = [], exports = {}; const query = new Proxy({}, { get(_target, method) {
    if (method === 'then') return resolve => resolve({ data: [thread(1)], error: null });
    return (...args) => { calls.push([method, ...args]); return query; };
  } });
  vm.runInNewContext(compile(fn.getText(ast)), { exports, ADMIN_THREAD_SELECT: 'id', SUPPORT_USER_ROLES: ['customer', 'dancer', 'venue'], mapSupportThread: value => value });
  const result = await exports.listAdminSupportThreads({ from: () => query }, 2);
  assert.equal(result[0].id, 'thread-1');
  assert.ok(calls.some(call => call[0] === 'order' && call[1] === 'status' && call[2].ascending === false));
  assert.deepEqual(calls.find(call => call[0] === 'range'), ['range', 200, 299]);
});
