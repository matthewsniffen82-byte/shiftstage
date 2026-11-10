import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileVip } from './helpers/vip-dashboard-fixture.mjs';

function notice(vip = false) {
  const slots = [], requests = [], effects = [];
  let cursor = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (previous && deps.every((dep, i) => dep === previous.deps[i])) return;
      effects.push(() => { previous?.cleanup(); slots[index] = { deps, cleanup: effect() }; });
    },
  };
  const Component = compileVip('app/components/AccountTermsNotice.tsx', {
    react: hooks,
    './RequestTermsCheckbox': { __esModule: true, default: () => '18+ checkbox' },
    '../dashboard/dashboard-session': {
      requestDashboardJson: (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })),
    },
  }).default;
  function render() {
    cursor = 0;
    const tree = Component({ accountId: 'guest', vip });
    effects.splice(0).forEach(run => run());
    return tree;
  }
  return { requests, render, html: () => renderToStaticMarkup(render()) };
}

for (const vip of [false, true]) {
  test(`${vip ? 'VIP' : 'guest'} checkbox stays hidden while checking and after confirming existing acceptance`, async () => {
    const ui = notice(vip);
    assert.equal(ui.html(), '');
    const [request] = ui.requests;
    assert.equal(request.url, vip ? '/api/account/terms?vip=true' : '/api/account/terms');
    assert.equal(ui.html(), '');
    request.resolve({ terms: { accepted: true } });
    await new Promise(setImmediate);
    assert.equal(ui.html(), '');
    assert.equal(ui.requests.length, 1);
  });
}

test('a failed check can be retried and an outstanding acceptance shows the checkbox', async () => {
  const ui = notice();
  ui.render();
  ui.requests[0].reject(new Error('offline'));
  await new Promise(setImmediate);
  const retry = ui.render();
  assert.match(renderToStaticMarkup(retry), /Try again/);
  assert.doesNotMatch(renderToStaticMarkup(retry), /18\+ checkbox/);
  retry.props.children.find(child => child.type === 'button').props.onClick();
  ui.render();
  assert.equal(ui.html(), '');
  ui.requests[1].resolve({ terms: { accepted: false } });
  await new Promise(setImmediate);
  assert.match(ui.html(), /18\+ checkbox/);
  assert.match(ui.html(), /Accept updated terms/);
});
