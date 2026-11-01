import assert from 'node:assert/strict';
import test from 'node:test';
import { deferMediaLoad } from '../src/lib/defer-media-load.ts';

test('authenticated media does not fetch until near the viewport and starts only once', () => {
  const element = {}, observers = [];
  class Observer {
    constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  let loads = 0;
  const cancel = deferMediaLoad(element, () => loads++, { Observer });
  assert.equal(loads, 0);
  const observer = observers[0];
  assert.equal(observer.target, element);
  assert.equal(observer.options.rootMargin, '600px 0px');
  observer.callback([{ isIntersecting: false }]); assert.equal(loads, 0);
  observer.callback([{ isIntersecting: true }]); assert.equal(loads, 1);
  observer.callback([{ isIntersecting: true }]); assert.equal(loads, 1);
  assert.equal(observer.disconnected, true); cancel();

  const cancelPending = deferMediaLoad(element, () => loads++, { Observer });
  cancelPending(); observers[1].callback([{ isIntersecting: true }]);
  assert.equal(loads, 1, 'unmounted cards cannot start a late authenticated request');
});

test('priority media and browsers without observation load immediately', () => {
  let loads = 0;
  class Observer { constructor() { throw new Error('priority media should not observe'); } }
  deferMediaLoad({}, () => loads++, { eager: true, Observer })();
  deferMediaLoad(null, () => loads++, { Observer })();
  deferMediaLoad({}, () => loads++, { Observer: undefined })();
  assert.equal(loads, 3);
});
