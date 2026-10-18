import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { dashboardHarness, dancers, state } from './helpers/vip-dashboard-fixture.mjs';

test('VIP follow icons highlight and unhighlight before the save finishes', async () => {
  for (const following of [false, true]) {
    let finishSave;
    const ui = dashboardHarness({ hash: '#vip-plan', request: (url, options) => options.method === 'POST'
      ? new Promise(resolve => { finishSave = resolve; })
      : Promise.resolve(state(undefined, { dancers: [{ ...dancers[0], following, profileHref: '/dancers/aria' }] })) });
    await ui.settle();
    const before = renderToStaticMarkup(ui.tree()).match(/<button[^>]*class="vip-dancer-follow"[\s\S]*?<\/button>/)[0];
    assert.match(before, /<circle cx="10" cy="8" r="5"/);
    assert.ok(before.includes(following ? 'm16 19 2 2 4-4' : 'M19 16v6m-3-3h6'));
    assert.ok(before.includes(following ? 'aria-label="Unfollow Aria"' : 'aria-label="Follow Aria"'));
    const pending = ui.planner().props.onFollow(ui.planner().props.dancers[0]); ui.render();
    assert.equal(ui.planner().props.dancers[0].following, !following);
    const follow = renderToStaticMarkup(ui.tree()).match(/<button[^>]*class="vip-dancer-follow"[^>]*>/)[0];
    assert.ok(follow.includes(`aria-pressed="${!following}"`));
    assert.match(follow, /aria-busy="true"/); assert.match(follow, /disabled=""/);
    await ui.planner().props.onFollow(ui.planner().props.dancers[0]);
    assert.equal(ui.calls.filter(call => call.options.method === 'POST').length, 1);
    finishSave({ following: !following }); await pending; await ui.settle();
    assert.equal(ui.planner().props.dancers[0].following, !following);
    assert.equal(ui.planner().props.followPending.length, 0);
    ui.unmount();
  }
});

test('a failed follow save rolls back only that dancer while another save stays highlighted', async () => {
  const saves = new Map();
  const ui = dashboardHarness({ hash: '#vip-plan', request: (url, options) => options.method === 'POST'
    ? new Promise((resolve, reject) => saves.set(JSON.parse(options.body).dancerId, { resolve, reject }))
    : Promise.resolve(state()) });
  await ui.settle();
  const draft = { selected: ['dancer-3'], date: '2027-01-15', time: '21:30' };
  ui.planner().props.onChange(draft); ui.render();
  const first = ui.planner().props.onFollow(dancers[0]);
  const second = ui.planner().props.onFollow(dancers[1]); ui.render();
  assert.ok(ui.planner().props.dancers.slice(0, 2).every(dancer => dancer.following));
  saves.get(dancers[0].id).reject(new Error('Could not save following')); await first; await ui.settle();
  assert.notEqual(ui.planner().props.dancers[0].following, true);
  assert.equal(ui.planner().props.dancers[1].following, true);
  assert.deepEqual(Array.from(ui.planner().props.followPending), [dancers[1].id]);
  assert.match(renderToStaticMarkup(ui.tree()), /Could not save following/);
  saves.get(dancers[1].id).resolve({ following: true }); await second; await ui.settle();
  assert.equal(ui.planner().props.dancers[1].following, true);
  assert.deepEqual(ui.planner().props.draft, draft);
  ui.unmount();
});

test('a stale roster refresh cannot undo a pending or newly saved follow', async () => {
  for (const readFinishesFirst of [true, false]) {
    let delayReads = false, finishSave;
    const reads = [];
    const ui = dashboardHarness({ hash: '#vip-plan', request: (url, options) => options.method === 'POST'
      ? new Promise(resolve => { finishSave = resolve; })
      : delayReads ? new Promise(resolve => reads.push(resolve)) : Promise.resolve(state()) });
    await ui.settle();
    delayReads = true; ui.advance(16000); ui.event('focus');
    assert.equal(reads.length, 1);
    const pending = ui.planner().props.onFollow(dancers[0]); ui.render();
    assert.equal(ui.planner().props.dancers[0].following, true);
    if (readFinishesFirst) {
      reads.shift()(state()); await ui.settle();
      assert.equal(ui.planner().props.dancers[0].following, true);
    }
    finishSave({ following: true }); await pending; await ui.settle();
    if (!readFinishesFirst) { reads.shift()(state()); await ui.settle(); }
    assert.equal(ui.planner().props.dancers[0].following, true);
    // A later fresh read remains authoritative (for example, another device removed it).
    ui.advance(16000); ui.event('focus');
    assert.equal(reads.length, 1);
    reads.shift()(state(undefined, { dancers: [{ ...dancers[0], following: false }] })); await ui.settle();
    assert.equal(ui.planner().props.dancers[0].following, false);
    ui.unmount();
  }
});
