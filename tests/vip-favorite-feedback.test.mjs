import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { dashboardHarness, dancers, state } from './helpers/vip-dashboard-fixture.mjs';

test('VIP hearts highlight and unhighlight before the save finishes', async () => {
  for (const favorite of [false, true]) {
    let finishSave;
    const ui = dashboardHarness({ hash: '#vip-plan', request: (url, options) => options.method === 'POST'
      ? new Promise(resolve => { finishSave = resolve; })
      : Promise.resolve(state(undefined, { dancers: [{ ...dancers[0], favorite, profileHref: '/dancers/aria' }] })) });
    await ui.settle();
    const pending = ui.planner().props.onFavorite(ui.planner().props.dancers[0]); ui.render();
    assert.equal(ui.planner().props.dancers[0].favorite, !favorite);
    const heart = renderToStaticMarkup(ui.tree()).match(/<button[^>]*class="vip-dancer-favorite"[^>]*>/)[0];
    assert.ok(heart.includes(`aria-pressed="${!favorite}"`));
    assert.match(heart, /aria-busy="true"/); assert.match(heart, /disabled=""/);
    await ui.planner().props.onFavorite(ui.planner().props.dancers[0]);
    assert.equal(ui.calls.filter(call => call.options.method === 'POST').length, 1);
    finishSave({ favorite: !favorite }); await pending; await ui.settle();
    assert.equal(ui.planner().props.dancers[0].favorite, !favorite);
    assert.equal(ui.planner().props.favoritePending.length, 0);
    ui.unmount();
  }
});

test('a failed heart save rolls back only that dancer while another save stays highlighted', async () => {
  const saves = new Map();
  const ui = dashboardHarness({ hash: '#vip-plan', request: (url, options) => options.method === 'POST'
    ? new Promise((resolve, reject) => saves.set(JSON.parse(options.body).dancerId, { resolve, reject }))
    : Promise.resolve(state()) });
  await ui.settle();
  const draft = { selected: ['dancer-3'], date: '2027-01-15', time: '21:30' };
  ui.planner().props.onChange(draft); ui.render();
  const first = ui.planner().props.onFavorite(dancers[0]);
  const second = ui.planner().props.onFavorite(dancers[1]); ui.render();
  assert.ok(ui.planner().props.dancers.slice(0, 2).every(dancer => dancer.favorite));
  saves.get(dancers[0].id).reject(new Error('Could not save favorite')); await first; await ui.settle();
  assert.notEqual(ui.planner().props.dancers[0].favorite, true);
  assert.equal(ui.planner().props.dancers[1].favorite, true);
  assert.deepEqual(Array.from(ui.planner().props.favoritePending), [dancers[1].id]);
  assert.match(renderToStaticMarkup(ui.tree()), /Could not save favorite/);
  saves.get(dancers[1].id).resolve({ favorite: true }); await second; await ui.settle();
  assert.equal(ui.planner().props.dancers[1].favorite, true);
  assert.deepEqual(ui.planner().props.draft, draft);
  ui.unmount();
});

test('a stale roster refresh cannot undo a pending or newly saved heart', async () => {
  for (const readFinishesFirst of [true, false]) {
    let delayReads = false, finishSave;
    const reads = [];
    const ui = dashboardHarness({ hash: '#vip-plan', request: (url, options) => options.method === 'POST'
      ? new Promise(resolve => { finishSave = resolve; })
      : delayReads ? new Promise(resolve => reads.push(resolve)) : Promise.resolve(state()) });
    await ui.settle();
    delayReads = true; ui.advance(16000); ui.event('focus');
    assert.equal(reads.length, 1);
    const pending = ui.planner().props.onFavorite(dancers[0]); ui.render();
    assert.equal(ui.planner().props.dancers[0].favorite, true);
    if (readFinishesFirst) {
      reads.shift()(state()); await ui.settle();
      assert.equal(ui.planner().props.dancers[0].favorite, true);
    }
    finishSave({ favorite: true }); await pending; await ui.settle();
    if (!readFinishesFirst) { reads.shift()(state()); await ui.settle(); }
    assert.equal(ui.planner().props.dancers[0].favorite, true);
    // A later fresh read remains authoritative (for example, another device removed it).
    ui.advance(16000); ui.event('focus');
    assert.equal(reads.length, 1);
    reads.shift()(state(undefined, { dancers: [{ ...dancers[0], favorite: false }] })); await ui.settle();
    assert.equal(ui.planner().props.dancers[0].favorite, false);
    ui.unmount();
  }
});
