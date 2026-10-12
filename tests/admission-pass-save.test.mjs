import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const pass = {
  qrImage: 'data:image/png;base64,issued-qr', venueName: 'Echo House', title: 'Free Entry',
  arrivalLabel: 'Private car', expiresAt: '2099-07-12T04:00:00Z', timezone: 'America/Los_Angeles', offerHours: '6 PM–11 PM',
};
const png = new File(['issued-pass-image'], 'mydancr-echo-house-qr-pass.png', { type: 'image/png' });
function load(path, globals) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, File, Blob, Date, Intl, ...globals });
  return exports;
}

function imageFixture(options = {}) {
  const calls = [], timers = [];
  const context = {
    fillRect: (...args) => calls.push(['fill', ...args]),
    fillText: (...args) => calls.push(['text', ...args]),
    measureText: value => ({ width: value.length * 10 }),
    drawImage: (image, ...args) => calls.push(['qr', image.src, ...args]),
  };
  const canvas = { getContext: () => options.noContext ? null : context, toBlob(cb, type) { calls.push(['encode', type]); cb(options.noBlob ? null : new Blob(['encoded-image'], { type })); } };
  const link = { click() { calls.push(['click', this.href, this.download]); if (options.clickFails) throw new Error('Download blocked'); }, remove() { calls.push(['remove']); } };
  const api = load('src/lib/dancr/admission-pass-image.ts', {
    Image: class { set src(value) { this.value = value; queueMicrotask(() => options.badImage ? this.onerror() : this.onload()); } get src() { return this.value; } },
    document: { createElement: tag => tag === 'canvas' ? canvas : link, body: { appendChild: item => calls.push(['append', item]) } },
    URL: { createObjectURL: file => { calls.push(['url', file]); return 'blob:pass'; }, revokeObjectURL: url => calls.push(['revoke', url]) },
    window: { setTimeout: (callback, delay) => timers.push({ callback, delay }) },
  });
  return { api, calls, canvas, context, timers };
}

test('the downloadable PNG preserves the issued QR and includes the club, arrival, venue-local expiry and offer hours', async () => {
  const f = imageFixture(), file = await f.api.createAdmissionPassImage(pass);
  assert.equal(file.type, 'image/png');
  assert.equal(file.name, 'mydancr-echo-house-qr-pass.png');
  assert.equal(f.canvas.width, 720); assert.equal(f.canvas.height, 1112);
  assert.equal(f.context.imageSmoothingEnabled, false);
  assert.deepEqual(f.calls.find(call => call[0] === 'qr'), ['qr', pass.qrImage, 40, 208, 640, 640]);
  const text = f.calls.filter(call => call[0] === 'text').map(call => call[1]).join('\n');
  assert.match(text, /Echo House\nFree Entry/);
  assert.match(text, /Private car/);
  assert.match(text, /Expires Jul 11, 2099, 9:00 PM PDT/);
  assert.match(text, /6 PM–11 PM \(venue local time\)/);
  assert.match(text, /Staff checks current validity/);
  assert.deepEqual(f.calls.find(call => call[0] === 'encode'), ['encode', 'image/png']);
});

test('a failed QR load, missing canvas or failed image encoder does not produce a broken download', async () => {
  for (const options of [{ badImage: true }, { noContext: true }, { noBlob: true }]) {
    const f = imageFixture(options);
    await assert.rejects(f.api.createAdmissionPassImage(pass));
    assert.equal(f.calls.some(call => call[0] === 'click'), false);
  }
});

test('saving downloads the prepared file and releases its object URL after the browser has time to consume it', () => {
  const f = imageFixture(); f.api.saveAdmissionPassImage(png);
  assert.equal(f.calls.find(call => call[0] === 'url')[1], png);
  assert.deepEqual(f.calls.find(call => call[0] === 'click'), ['click', 'blob:pass', png.name]);
  assert.ok(f.calls.some(call => call[0] === 'remove'));
  assert.equal(f.calls.some(call => call[0] === 'revoke'), false);
  assert.ok(f.timers[0].delay >= 1000);
  f.timers[0].callback();
  assert.deepEqual(f.calls.at(-1), ['revoke', 'blob:pass']);
});

test('a blocked download still cleans up its temporary link and URL', () => {
  const f = imageFixture({ clickFails: true });
  assert.throws(() => f.api.saveAdmissionPassImage(png), /Download blocked/);
  assert.ok(f.calls.some(call => call[0] === 'remove'));
  f.timers[0].callback(); assert.deepEqual(f.calls.at(-1), ['revoke', 'blob:pass']);
});

function buttonFixture(options = {}) {
  const slots = [], calls = [];
  let props = { ...pass, ...options.props }, cursor = 0, effects = [], tree;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(value) { const i = cursor++; slots[i] ||= { value }; return [slots[i].value, next => { slots[i].value = next; }]; },
    useEffect(callback, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, j) => value !== previous.deps[j])) effects.push(() => {
        previous?.cleanup?.(); slots[i] = { deps, cleanup: callback() };
      });
    },
  };
  const imports = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/src/lib/dancr/admission-pass-image': {
      createAdmissionPassImage: async input => { calls.push(['prepare', input]); if (options.failPrepare) throw new Error('Canvas unavailable'); return png; },
      saveAdmissionPassImage: file => { calls.push(['save', file]); if (options.failSave) throw new Error('Download blocked'); },
    },
  };
  const { default: Component } = load('app/deals/pass/[token]/AdmissionPassSaveButton.tsx', { require: name => { assert.ok(name in imports); return imports[name]; } });
  function render() { cursor = 0; effects = []; tree = Component(props); effects.forEach(effect => effect()); }
  render();
  return { calls, button: () => tree.props.children[0], message: () => tree.props.children[1]?.props.children,
    async ready() { await new Promise(resolve => setImmediate(resolve)); render(); },
    click() { this.button().props.onClick(); render(); },
    update(next) { props = { ...props, ...next }; render(); },
  };
}

test('Save to phone waits for a prepared image and starts a download only on the guest’s click', async () => {
  const ui = buttonFixture();
  assert.equal(ui.button().props.disabled, true);
  assert.equal(ui.calls.some(call => call[0] === 'save'), false);
  await ui.ready(); assert.equal(ui.button().props.disabled, false);
  ui.click(); assert.equal(ui.calls.find(call => call[0] === 'save')[1], png);
  assert.match(ui.message(), /Download started/);
});

test('expiration is checked again at download time, before the next status refresh', async () => {
  const ui = buttonFixture({ props: { expiresAt: '2000-01-01T00:00:00Z' } });
  await ui.ready(); ui.click();
  assert.equal(ui.calls.some(call => call[0] === 'save'), false);
  assert.match(ui.message(), /expired/);
});

test('changing passes disables saving the previous image while the new image prepares', async () => {
  const ui = buttonFixture(); await ui.ready();
  ui.update({ qrImage: 'data:image/png;base64,new-issued-qr' });
  assert.equal(ui.button().props.disabled, true);
  ui.click(); assert.equal(ui.calls.some(call => call[0] === 'save'), false);
  await ui.ready(); assert.equal(ui.button().props.disabled, false);
});

test('image or download failures leave a useful screenshot fallback without claiming the pass was saved', async () => {
  const prepare = buttonFixture({ failPrepare: true }); await prepare.ready();
  assert.equal(prepare.button().props.disabled, true); assert.match(prepare.message(), /screenshot/);
  const save = buttonFixture({ failSave: true }); await save.ready(); save.click();
  assert.match(save.message(), /Unable to save/); assert.doesNotMatch(save.message(), /Download started/);
});
