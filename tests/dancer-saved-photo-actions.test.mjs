import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync('app/dashboard/DancerSavedPhotoCrop.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ fails = false, pending = true } = {}) {
  const slots = [], exports = {}, uploads = [];
  let cursor = 0, tree;
  const jsx = (type, props) => ({ type, props });
  runInNewContext(code, {
    exports, AbortController, Error, crypto: globalThis.crypto,
    require: name => name === 'react' ? {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], next => { slots[i] = next; }]; },
      useRef(initial) { return slots[cursor++] ||= { current: initial }; }, useEffect() {},
    } : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : {
      uploadMainProfilePhoto: async (...args) => { uploads.push(args); if (fails) throw Error('Upload failed'); return { decision: 'review', profile: {} }; },
    },
  });
  function render() { cursor = 0; tree = exports.default({ photo: { id: 'pending-gallery', status: pending ? 'pending' : 'approved', isPrimary: false, sortOrder: 2 }, pendingReviewId: 'pending-gallery', replacementPhotoId: 'approved-gallery' }); }
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  render();
  return { uploads, nodes, settle,
    async select(file) { nodes().find(node => node.type === 'input').props.onChange({ target: { files: file ? [file] : [], value: '' } }); await settle(); },
    async retry() { nodes().find(node => node.type === 'button' && node.props.children === 'Retry crop save').props.onClick(); await settle(); },
  };
}
test('pending gallery replacement selects a new file while retaining both review and approved identities', async () => {
  const ui = fixture();
  assert.equal(ui.nodes().find(node => node.type === 'button').props.children, 'Choose another photo');
  const file = new File(['new'], 'new.jpg', { type: 'image/jpeg' });
  await ui.select(file);
  assert.equal(ui.uploads[0][0], file);
  assert.equal(ui.uploads[0][1].pendingReviewId, 'pending-gallery');
  assert.equal(ui.uploads[0][1].replacementPhotoId, 'approved-gallery');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.uploads[0][1].photoSlot)), { isPrimary: false, sortOrder: 2 });
});
test('canceling the pending replacement picker or selecting an invalid file writes nothing', async () => {
  const ui = fixture(); await ui.select();
  await ui.select(new File(['text'], 'note.txt', { type: 'text/plain' }));
  assert.equal(ui.uploads.length, 0);
});
test('a pending gallery retry keeps the selected file and idempotency key', async () => {
  const ui = fixture({ fails: true });
  await ui.select(new File(['new'], 'new.jpg', { type: 'image/jpeg' })); await ui.retry();
  assert.equal(ui.uploads.length, 2);
  assert.equal(ui.uploads[0][0], ui.uploads[1][0]);
  assert.equal(ui.uploads[0][1].uploadKey, ui.uploads[1][1].uploadKey);
});
