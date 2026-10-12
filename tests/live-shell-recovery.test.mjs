import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createLiveShellRecoveryScript, createLiveShellVersionMismatchScript } from '../src/lib/dancr/live-shell-recovery.mjs';
import { sha256Source } from '../src/lib/security/root-content-security-policy.mjs';
import { liveShellRoute } from './helpers/live-shell-route.mjs';

function fixture({ href = 'https://www.mydancr.com/?city=Las+Vegas&profile=luna#photos', online = true, latest = 'new-release', failed = false } = {}) {
  const windowEvents = {}, documentEvents = {}, nodes = new Map(), navigations = [], requests = [], timers = new Map();
  let now = 100000, timerId = 0;
  const register = collection => (name, callback) => { (collection[name] ||= []).push(callback); };
  const createElement = tag => ({ tagName: tag.toUpperCase(), style: {}, children: [], events: {},
    setAttribute(key, value) { this[key] = value; },
    addEventListener(key, callback) { this.events[key] = callback; },
    append(...children) { this.children.push(...children); children.forEach(child => { if (child.id) nodes.set(child.id, child); }); },
  });
  const document = { body: createElement('body'), visibilityState: 'visible', activeElement: null,
    addEventListener: register(documentEvents), createElement, getElementById: id => nodes.get(id) || null };
  const navigator = { onLine: online };
  const window = { addEventListener: register(windowEvents),
    location: { href, origin: new URL(href).origin, replace: url => navigations.push(url), reload: () => navigations.push('reload') },
    history: { state: { preserved: true }, replaceState(state, title, url) { this.replacement = { state, title, url }; } },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
  };
  const context = vm.createContext({ window, document, navigator, URL, AbortController, Date: { now: () => now },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (failed) throw new Error('Network unavailable');
      return { ok: true, headers: { get: key => key === 'x-dancr-shell-release' ? latest : null } };
    },
  });
  vm.runInContext(createLiveShellRecoveryScript('current-release'), context);
  return { window, document, navigator, navigations, requests, timers, nodes,
    advance: () => { now += 30001; }, mismatch: () => vm.runInContext(createLiveShellVersionMismatchScript(), context),
    async emit(name, event = {}, onDocument = false) {
      for (const callback of (onDocument ? documentEvents : windowEvents)[name] || []) callback(event);
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('the real homepage is fresh, with an early CSP-allowlisted recovery script and release identity', async () => {
  const response = await liveShellRoute().route.GET();
  const html = await response.text();
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  const release = response.headers.get('x-dancr-shell-release');
  assert.match(release, /^[a-f0-9]{64}$/);
  const recovery = createLiveShellRecoveryScript(release);
  assert.ok(html.indexOf(`<script>${recovery}</script>`) < html.indexOf('rel="stylesheet"'));
  assert.ok(response.headers.get('content-security-policy').includes(sha256Source(recovery)));
  assert.match(html, /live-shell\.css\?v=[a-f0-9]{16}/);
});

test('failed essential styles or scripts automatically retry once while preserving the destination', async () => {
  for (const target of [
    { tagName: 'LINK', rel: 'stylesheet', href: '/outputs/dancr-aesthetic.css?v=old' },
    { tagName: 'SCRIPT', src: '/live-shell.js?v=old' },
  ]) {
    const f = fixture();
    await f.emit('error', { target }); await f.emit('error', { target });
    assert.equal(f.navigations.length, 1);
    const next = new URL(f.navigations[0]);
    assert.equal(next.searchParams.get('_dancr_reload'), '1');
    assert.equal(next.searchParams.get('city'), 'Las Vegas');
    assert.equal(next.searchParams.get('profile'), 'luna');
    assert.equal(next.hash, '#photos');
    assert.equal(f.window.__dancrShellAssetFailed, true);
  }
});

test('a repeated failure offers manual recovery rather than a reload loop', async () => {
  const f = fixture({ href: 'https://www.mydancr.com/?_dancr_reload=1' });
  f.mismatch(); f.mismatch();
  assert.deepEqual(f.navigations, []);
  assert.equal(f.document.body.children.length, 1);
  const notice = f.nodes.get('dancrShellRecovery');
  assert.equal(notice.role, 'alert');
  notice.children[1].events.click();
  assert.deepEqual(f.navigations, ['reload']);
});

test('old script versions recover without executing the current app on stale markup', () => {
  const f = fixture(); f.mismatch();
  assert.equal(f.navigations.length, 1);
  assert.equal(f.window.__dancrShellAssetFailed, true);
});

test('early repeated asset failures wait for the body before offering manual recovery', async () => {
  const f = fixture({ href: 'https://www.mydancr.com/?_dancr_reload=1' });
  const body = f.document.body;
  f.document.body = null;
  f.mismatch(); f.mismatch();
  assert.deepEqual(f.navigations, []);
  f.document.body = body;
  await f.emit('DOMContentLoaded', {}, true);
  assert.equal(body.children.length, 1);
  assert.ok(f.nodes.has('dancrShellRecovery'));
});

test('browser history and foreground restores check a fresh release without constant polling', async () => {
  const f = fixture();
  await f.emit('pageshow', { persisted: false });
  assert.equal(f.requests.length, 0);
  await f.emit('pageshow', { persisted: true });
  assert.equal(f.navigations.length, 1);
  assert.equal(f.requests[0].url, '/');
  assert.equal(f.requests[0].options.method, 'HEAD');
  assert.equal(f.requests[0].options.cache, 'no-store');
  assert.equal(f.requests[0].options.credentials, 'same-origin');
  await f.emit('visibilitychange', {}, true);
  assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
});

test('unchanged releases, lock pages and transient network errors do not reload a usable page', async () => {
  for (const options of [{ latest: 'current-release' }, { latest: null }, { failed: true }]) {
    const f = fixture(options);
    await f.emit('pageshow', { persisted: true });
    assert.equal(f.navigations.length, 0);
    assert.equal(f.timers.size, 0);
  }
});

test('editing forms prevents automatic recovery, including on a restored tab', async () => {
  for (const mode of ['input', 'change', 'focus']) {
    const f = fixture();
    if (mode === 'focus') f.document.activeElement = { matches: () => true };
    else await f.emit(mode, { target: { closest: () => ({}) } }, true);
    await f.emit('pageshow', { persisted: true }); f.mismatch();
    assert.equal(f.navigations.length, 0);
    assert.ok(f.nodes.has('dancrShellRecovery'));
  }
});

test('optional fonts, media and analytics failures cannot trigger a page reload', async () => {
  const f = fixture();
  for (const target of [
    { tagName: 'LINK', rel: 'stylesheet', href: 'https://fonts.googleapis.com/optional' },
    { tagName: 'IMG', src: '/photo.jpg' }, { tagName: 'VIDEO', src: '/video.mp4' },
    { tagName: 'SCRIPT', src: '/mydancr-performance.js' }, f.window,
  ]) await f.emit('error', { target });
  assert.equal(f.navigations.length, 0);
  assert.equal(f.window.__dancrShellAssetFailed, undefined);
});

test('offline failures wait for connectivity, and healthy loads clean the retry marker without losing history', async () => {
  const offline = fixture({ online: false });
  await offline.emit('error', { target: { tagName: 'SCRIPT', src: '/live-shell.js' } });
  assert.equal(offline.navigations.length, 0);
  offline.navigator.onLine = true; await offline.emit('online');
  assert.equal(offline.navigations.length, 1);
  const healthy = fixture({ href: 'https://www.mydancr.com/?city=Las+Vegas&profile=luna&_dancr_reload=1#photos' });
  await healthy.emit('load');
  assert.equal(healthy.window.history.replacement.url, '/?city=Las+Vegas&profile=luna#photos');
  assert.equal(healthy.window.history.replacement.state.preserved, true);
  const failed = fixture({ href: 'https://www.mydancr.com/?_dancr_reload=1' });
  failed.mismatch(); await failed.emit('load');
  assert.equal(failed.window.history.replacement, undefined);
});
