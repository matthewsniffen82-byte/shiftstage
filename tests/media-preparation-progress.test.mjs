import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { mediaPreparationPercent, isMediaProcessing } from '../app/dashboard/media-preparation-progress.ts';
import { loadMediaPreparationComponent } from './helpers/media-preparation-component.mjs';

test('overall progress reserves processing work after transfer and never reports premature completion', () => {
  for (const kind of ['photo', 'video']) {
    const transfer = value => mediaPreparationPercent({ kind, processing: false, transferProgress: value });
    assert.equal(transfer(0), 0);
    assert.equal(transfer(50), 35);
    assert.equal(transfer(100), 70);
    assert.equal(transfer(200), 70);
    assert.equal(transfer(-10), 0);
    assert.equal(transfer(NaN), 0);
    const processing = elapsedMs => mediaPreparationPercent({ kind, processing: true, elapsedMs });
    const samples = [0, 1000, 5000, 15_000, 60_000, 300_000, 86_400_000].map(processing);
    assert.equal(samples[0], transfer(100));
    assert.ok(samples.every((value, i) => value >= 70 && value <= 99 && (!i || value >= samples[i - 1])));
    assert.ok(samples[3] > samples[0]);
    assert.equal(samples.at(-1), 99);
    assert.equal(processing(-1000), 70);
    assert.equal(processing(NaN), 70);
  }
});

test('processing receipts stay distinct from review-ready uploads and failed preparation', () => {
  for (const item of [{ status: 'moderating' }, { status: 'pending', moderationStatus: 'pending' }, { status: 'pending', moderationStatus: 'moderating' }]) {
    assert.equal(isMediaProcessing(item), true);
  }
  for (const item of [{ status: 'submitted', moderationStatus: 'submitted' }, { status: 'pending', moderationStatus: 'pending_review' },
    { status: 'approved' }, { status: 'failed' }, { status: 'rejected', moderationStatus: 'moderating' },
    { status: 'moderating', moderationStatus: 'moderation_error' }, { status: 'pending', moderationStatus: 'error' }]) {
    assert.equal(isMediaProcessing(item), false);
  }
});

test('processing estimates advance, retain their start across saved receipts, and stop timers on retry or unmount', () => {
  let now = 100_000, cursor = 0, nextTimer = 0;
  const slots = [], effects = [], timers = new Map();
  const hooks = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
    },
    useEffect(fn, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, index) => value !== previous.deps[index])) effects.push(() => {
        previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const Component = loadMediaPreparationComponent({ hooks, Date: { now: () => now }, window: {
    setInterval(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); },
  } }).default;
  const render = props => {
    cursor = 0;
    const tree = Component({ kind: 'video', label: 'Video 1', ...props });
    effects.splice(0).forEach(fn => fn());
    return renderToStaticMarkup(tree);
  };
  assert.match(render({ transferProgress: 50 }), /Uploading · 35%/);
  assert.equal(timers.size, 0);
  const start = now;
  const processing = { processing: true, processingStartedAt: start };
  assert.match(render(processing), /Processing · 70% est\./);
  assert.equal(timers.size, 1);
  now += 30_000; timers.forEach(fn => fn());
  const advanced = render(processing);
  assert.match(advanced, /aria-valuenow="84"/);
  assert.match(advanced, /aria-valuetext="84% overall, estimated\. Processing\."/);
  assert.equal(timers.size, 1, 'receipt rerenders do not restart the estimate');
  now += 86_400_000; timers.forEach(fn => fn());
  assert.match(render(processing), /aria-valuenow="99"/);
  assert.match(render({ transferProgress: 0 }), /Uploading · 0%/);
  assert.equal(timers.size, 0, 'retry stops the previous processing timer');
  assert.match(render({ processing: true, processingStartedAt: now }), /Processing · 70% est\./);
  assert.equal(timers.size, 1);
  slots.forEach(slot => slot?.cleanup?.());
  assert.equal(timers.size, 0, 'completion, error, removal, and close unmount this component');
});
