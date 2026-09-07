import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/dashboard/DashboardClient.tsx', import.meta.url), 'utf8');
function between(start, end) {
  const first = source.indexOf(start, source.indexOf('function CustomerPanel('));
  const last = source.indexOf(end, first + start.length);
  assert.ok(first > 0 && last > first);
  return source.slice(first, last);
}
const actions = ts.transpileModule([
  between('  function beginCustomerAction(', '  function updateVenueFollow('),
  between('  function unfollowDancer(', '  function cancelGoing('),
].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture() {
  const requests = [];
  let saved = {
    follows: [{ dancerId: 'bella', dancer: { stageName: 'Bella' } }, { dancer: { id: 'ivy', stageName: 'Ivy' } }],
    venueFollows: [{ venueId: 'club' }],
    goingSignals: [{ shiftId: 'shift' }],
  };
  const context = vm.createContext({
    AbortController,
    mountedRef: { current: true }, actionSequenceRef: { current: 0 },
    actionAbortRef: { current: null }, actionInFlightRef: { current: false },
    setPendingAction: value => { context.pending = value; },
    setActionStatus: value => { context.status = value; },
    onSavedChange: update => { saved = update(saved); },
    requestDashboardJson: (path, options) => new Promise((resolve, reject) => { requests.push({ path, options, resolve, reject }); }),
  });
  vm.runInContext(actions, context);
  return { context, requests, saved: () => saved };
}

test('dashboard unfollow waits for persistence, removes only that dancer, and leaves other saved activity intact', async () => {
  const { context, requests, saved } = fixture();
  const before = saved();
  const action = context.unfollowDancer('bella');
  assert.equal(context.pending, 'dancer-bella');
  assert.equal(saved().follows.length, 2);
  assert.equal(requests[0].path, '/api/customer/follows');
  assert.equal(requests[0].options.expectedRole, 'customer');
  assert.deepEqual(JSON.parse(requests[0].options.body), { dancerId: 'bella', following: false, notificationsEnabled: false });
  requests[0].resolve({ ok: true, following: false });
  await action;
  assert.deepEqual(saved().follows, [before.follows[1]]);
  assert.equal(saved().venueFollows, before.venueFollows);
  assert.equal(saved().goingSignals, before.goingSignals);
  assert.equal(context.pending, '');
  assert.equal(context.status, 'Dancer unfollowed.');
});

test('a failed unfollow keeps the dancer visible and releases the button for a retry', async () => {
  const { context, requests, saved } = fixture();
  const action = context.unfollowDancer('ivy');
  requests[0].reject(new Error('Please try again.'));
  await action;
  assert.equal(saved().follows.length, 2);
  assert.equal(context.pending, '');
  assert.ok(context.status);
  const retry = context.unfollowDancer('ivy');
  requests[1].resolve({ ok: true, following: false });
  await retry;
  assert.equal(saved().follows.length, 1);
  assert.equal(saved().follows[0].dancerId, 'bella');
});

test('rapid taps create one unfollow request and an abandoned action cannot remove a card later', async () => {
  const { context, requests, saved } = fixture();
  const action = context.unfollowDancer('bella');
  await context.unfollowDancer('bella');
  await context.unfollowDancer('ivy');
  assert.equal(requests.length, 1);
  context.mountedRef.current = false;
  context.actionAbortRef.current.abort();
  requests[0].resolve({ ok: true, following: false });
  await action;
  assert.equal(saved().follows.length, 2);
});
