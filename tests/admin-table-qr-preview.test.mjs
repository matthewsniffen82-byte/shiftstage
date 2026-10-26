import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { renderTableQrPrintDocument, tableQrDownloadBlob } from '../app/admin/admin-table-qr-print.ts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3i8AAAAASUVORK5CYII=';
const images = [{ id: 'table-id', label: 'Table 201', imageDataUrl: png }];
const source = readFileSync(new URL('../app/admin/AdminTableQrPreview.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];

function fixture({ printFailure = false, imageFailure = false, inputImages = images } = {}) {
  const slots = [], effects = [], created = [], revoked = [];
  let cursor = 0, tree, closed = false, printed = 0, prepared = 0, focused = 0;
  const frame = { contentDocument: {}, contentWindow: { focus() {}, print() { if (printFailure) throw new Error('Unavailable'); printed++; } } };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index];
      if (!old || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) { old?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = effect(); }); } },
  };
  const exports = {}, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(code, { exports, URL: {
    createObjectURL(blob) { created.push(blob); return `blob:qr-${created.length}`; },
    revokeObjectURL(url) { revoked.push(url); },
  }, require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === './admin-table-qr-print') return { tableQrDownloadBlob, renderTableQrPrintDocument: async () => {
      prepared++; if (imageFailure) throw new Error('Image failed to load');
    } };
    throw new Error(name);
  } });
  const render = () => {
    cursor = 0; tree = exports.default({ name: 'Club', images: inputImages, onClose: () => { closed = true; } });
    for (const node of nodes(tree)) {
      if (node.props?.ref) node.props.ref.current = node.type === 'iframe' ? frame : { focus() { focused++; }, scrollIntoView() {} };
    }
    while (effects.length) effects.shift()();
  };
  const find = predicate => nodes(tree).find(predicate);
  const unmount = () => slots.forEach(slot => slot?.cleanup?.());
  render(); render();
  return { render, find, created, revoked, frame, unmount,
    state: () => ({ printed, prepared, closed, focused }),
    async loadFrame() { find(node => node.type === 'iframe').props.onLoad(); render(); await new Promise(resolve => setImmediate(resolve)); render(); },
  };
}

test('preview renders an actual PNG with direct user-activated download and full-size links', async () => {
  const f = fixture();
  const image = f.find(node => node.type === 'img');
  const download = f.find(node => node.type === 'a' && node.props.download);
  assert.equal(image.props.src, 'blob:qr-1');
  assert.equal(download.props.href, image.props.src);
  assert.equal(download.props.download, 'table-qr-table-id.png');
  assert.equal(download.props.onClick, undefined, 'Saving is a real link click, not an asynchronous synthetic click');
  assert.equal(f.find(node => node.type === 'a' && node.props.target === '_blank').props.href, image.props.src);
  assert.equal(f.created[0].type, 'image/png');
  assert.equal(Buffer.from(await f.created[0].arrayBuffer()).toString('base64'), png.split(',')[1]);
  assert.equal(f.state().printed, 0);
  assert.ok(f.state().focused > 0);
  f.find(node => node.type === 'button' && node.props.children === 'Close preview').props.onClick();
  assert.equal(f.state().closed, true); f.unmount();
  assert.deepEqual(f.revoked, ['blob:qr-1']);
});

test('printing waits for images and only runs on an explicit click in the prepared frame', async () => {
  const f = fixture();
  assert.ok(f.find(node => node.type === 'button' && node.props.disabled));
  await f.loadFrame();
  assert.equal(f.state().prepared, 1); assert.equal(f.state().printed, 0);
  const print = f.find(node => node.type === 'button' && node.props.children === 'Print / save PDF');
  assert.equal(print.props.disabled, false); print.props.onClick();
  assert.equal(f.state().printed, 1); f.unmount();
});

test('unavailable printing and failed print-image loads keep PNG download available', async () => {
  for (const options of [{ printFailure: true }, { imageFailure: true }]) {
    const f = fixture(options); await f.loadFrame();
    if (options.printFailure) { f.find(node => node.props.children === 'Print / save PDF').props.onClick(); f.render(); }
    assert.ok(f.find(node => node.props.role === 'alert'));
    assert.ok(f.find(node => node.type === 'a' && node.props.download));
    assert.equal(f.state().printed, 0); f.unmount();
  }
});

test('invalid image data cannot become a downloadable PNG', () => {
  for (const data of ['data:text/html;base64,PGgxPkJhZDwvaDE+', 'data:image/png;base64,cXI=', 'https://example.invalid/image.png']) {
    assert.throws(() => tableQrDownloadBlob(data), /could not be confirmed/);
    const f = fixture({ inputImages: [{ ...images[0], imageDataUrl: data }] });
    assert.ok(f.find(node => node.props.role === 'alert'));
    assert.equal(f.find(node => node.type === 'a'), undefined); f.unmount();
  }
});

test('print document preserves labels as text and waits for each image load', async () => {
  const elements = [], doc = { title: '', head: { append() {} }, body: { replaceChildren() {}, append() {} }, createElement(type) {
    const element = { type, append() {}, set src(value) { this.imageSource = value; queueMicrotask(() => this.onload()); } };
    elements.push(element); return element;
  } };
  await renderTableQrPrintDocument(doc, 'Club <script>', images);
  assert.equal(doc.title, 'Club <script> · Table QR signs');
  assert.equal(elements.find(element => element.type === 'h1').textContent, 'Club <script>');
  assert.equal(elements.find(element => element.type === 'h2').textContent, 'Table 201');
  assert.equal(elements.find(element => element.type === 'img').imageSource, png);
});
