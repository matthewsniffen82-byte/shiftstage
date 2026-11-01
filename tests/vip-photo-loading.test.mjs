import assert from 'node:assert/strict';
import test from 'node:test';
import { deferMediaLoad } from '../src/lib/defer-media-load.ts';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';

test('VIP photos defer private requests, preserve authorization, and clean up loaded blobs', async () => {
  let effect, notify, current = true; const element = {}, calls = [], revoked = [], states = [];
  class Observer { constructor(callback) { notify = callback; } observe(target) { assert.equal(target, element); } disconnect() {} }
  const Photo = compileVip('app/vip/VipDancerPhoto.tsx', {
    react: { useRef: () => ({ current: element }), useEffect: callback => { effect = callback; }, useState: initial => { const index = states.length; states.push(initial); return [initial, value => { states[index] = value; }]; } },
    '@/src/lib/defer-media-load': { deferMediaLoad: (node, load) => deferMediaLoad(node, load, { Observer }) },
    '@/src/lib/dancr/browser-session': { readBrowserAuthSession: () => ({ accessToken: 'vip-token', refreshToken: 'refresh-token' }), isCurrentBrowserSession: () => current },
  }, {
    setTimeout, clearTimeout, URL: { createObjectURL: () => 'blob:authorized', revokeObjectURL: value => revoked.push(value) },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, blob: async () => ({}) }; },
  }).default;
  const render = () => Photo({ dancer: { stage_name: 'Aria', photoUrl: '/api/internal/avatar/dancer' }, width: 56, height: 72 });
  const tree = render(); assert.equal(tree.props.ref.current, element); assert.equal(tree.props.style.height, 72);
  let cleanup = effect(); assert.equal(calls.length, 0);
  notify([{ isIntersecting: true }]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); assert.equal(calls[0].options.headers.authorization, 'Bearer vip-token');
  assert.equal(calls[0].options.headers['x-dancr-refresh-token'], 'refresh-token');
  assert.equal(states[0], 'blob:authorized'); cleanup();
  assert.equal(calls[0].options.signal.aborted, true); assert.deepEqual(revoked, ['blob:authorized']);
  render(); cleanup = effect(); current = false; notify([{ isIntersecting: true }]);
  assert.equal(calls.length, 1, 'an account change while off-screen prevents a late authenticated fetch'); cleanup();
});
