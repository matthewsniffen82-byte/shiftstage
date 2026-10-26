import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const compile = file => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));
function environment(file) {
  let cursor = 0, timerId = 0, session = { accessToken: 'token', account: { id: 'one', role: 'venue' } };
  const slots = [], effects = [], calls = [], listeners = new Map(), timers = new Map(), intervals = new Map(), events = [];
  const document = { visibilityState: 'visible', addEventListener, removeEventListener };
  function addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); }
  function removeEventListener(type, fn) { listeners.get(type)?.delete(fn); }
  function dispatchEvent(event) { events.push(event); listeners.get(event.type)?.forEach(fn => fn(event)); }
  const window = { addEventListener, removeEventListener, dispatchEvent, setInterval(fn) { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id) };
  const hooks = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => slots[i] = typeof next === 'function' ? next(slots[i]) : next]; },
    useEffect(fn, deps) { const i = cursor++, prev = slots[i]; if (!prev || deps.some((value, index) => value !== prev.deps[index])) { effects.push(() => { prev?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); } },
  };
  let observer;
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; this.targets = []; observer = this; }
    observe(element) { this.targets.push(element); }
    disconnect() { this.targets = []; }
  }
  const exports = {};
  vm.runInNewContext(compile(file), {
    exports, document, window, AbortController, CustomEvent, IntersectionObserver, Error, Set,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    require(name) {
      if (name === 'react') return hooks;
      if (name.endsWith('/dashboard-session')) return { readSession: () => session, requestDashboardJson: (path, options) => new Promise((resolve, reject) => calls.push({ path, options, resolve, reject })) };
      if (name.endsWith('/admin-data-events')) return { ADMIN_INBOX_ARCHIVE_CHANGED: 'archive' };
      if (name === './dashboard-help-events') return { DASHBOARD_HELP_UPDATED: 'help-updated' };
      if (name === './dashboard-message-unread') return { MESSAGES_READ: 'read' };
      assert.fail(name);
    },
  });
  return {
    calls, document, events, intervals, exports,
    render(fn) { cursor = 0; const value = fn(exports); while (effects.length) effects.shift()(); return value; },
    emit: (type, detail) => dispatchEvent(new CustomEvent(type, { detail })),
    switchAccount() { session = { ...session, account: { ...session.account, id: 'two' } }; },
    tick() { [...intervals.values()].forEach(fn => fn()); },
    runTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    intersect(ids, visible = true) { observer.callback(ids.map(id => ({ target: { dataset: { supportMessageId: id } }, isIntersecting: visible }))); },
    observed: () => observer?.targets.length || 0,
    close() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('badge polls while visible, refreshes after reads/archives, and ignores stale account responses', async () => {
  const f = environment('app/components/dashboard-message-unread.ts');
  const render = () => f.render(api => api.useSupportUnreadCount('one', true));
  assert.equal(render(), null); assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ unreadCount: 4 }); await settle(); assert.equal(render(), 4);
  f.document.visibilityState = 'hidden'; f.tick(); assert.equal(f.calls.length, 1);
  f.document.visibilityState = 'visible'; f.emit('visibilitychange'); assert.equal(f.calls.length, 2);
  f.calls[1].resolve({ unreadCount: 2 }); await settle(); assert.equal(render(), 2);
  f.emit('dancr:messages-read', { accountId: 'someone-else' }); assert.equal(f.calls.length, 2);
  f.emit('dancr:messages-read', { accountId: 'one' }); assert.equal(f.calls.length, 3);
  f.emit('archive'); assert.equal(f.calls[2].options.signal.aborted, true);
  f.calls[3].resolve({ unreadCount: 0 }); await settle(); assert.equal(render(), 0);
  f.tick(); f.switchAccount(); f.emit('storage');
  f.calls[4].resolve({ unreadCount: 99 }); await settle(); assert.equal(render(), null);
  f.close(); assert.equal(f.intervals.size, 0);
});

test('unauthorized roles do not fetch badges and failures never claim zero unread', async () => {
  const f = environment('app/components/dashboard-message-unread.ts');
  assert.equal(f.render(api => api.useSupportUnreadCount('one', false)), null); assert.equal(f.calls.length, 0);
  const render = () => f.render(api => api.useSupportUnreadCount('one', true)); render();
  f.calls[0].resolve({ unreadCount: 3 }); await settle(); assert.equal(render(), 3);
  f.tick(); f.calls[1].reject(new Error('offline')); await settle(); assert.equal(render(), null); f.close();
});

function tracker(active = true) {
  const f = environment('app/components/SupportMessageReadTracker.tsx');
  const elements = ['seen', 'offscreen', 'later'].map(id => ({ dataset: { supportMessageId: id } }));
  const props = { container: { current: { querySelectorAll: () => elements } }, revision: 1, active, accountId: 'one' };
  const render = () => f.render(api => api.default(props)); render();
  return { ...f, props, render };
}

test('only visible incoming bubbles are marked read, never hidden panes or unseen later replies', async () => {
  const f = tracker(false); assert.equal(f.observed(), 0);
  f.props.active = true; f.render(); assert.equal(f.observed(), 3);
  f.intersect(['seen']); f.intersect(['offscreen'], false); f.runTimers();
  assert.equal(f.calls.length, 1); assert.deepEqual(JSON.parse(f.calls[0].options.body).messageIds, ['seen']);
  f.calls[0].resolve({ ok: true, readIds: ['seen'] }); await settle();
  assert.equal(f.events.filter(event => event.type === 'read').length, 1);
  f.intersect(['seen']); f.runTimers(); assert.equal(f.calls.length, 1, 'no duplicate receipts');
  f.document.visibilityState = 'hidden'; f.emit('visibilitychange'); assert.equal(f.observed(), 0);
  f.intersect(['later']); f.runTimers(); assert.equal(f.calls.length, 1);
  f.close();
});

test('failed receipts leave badges intact and retry when visible; identity changes and unmount suppress updates', async () => {
  const f = tracker(); f.intersect(['seen']); f.runTimers();
  f.calls[0].reject(new Error('offline')); await settle(); assert.equal(f.events.length, 0);
  f.emit('focus'); f.intersect(['seen']); f.runTimers(); assert.equal(f.calls.length, 2);
  f.switchAccount(); f.calls[1].resolve({ ok: true }); await settle();
  assert.equal(f.events.filter(event => event.type === 'read').length, 0);
  f.intersect(['later']); f.runTimers(); assert.equal(f.calls.length, 2);
  f.close(); assert.equal(f.calls[1].options.signal.aborted, true);
});
