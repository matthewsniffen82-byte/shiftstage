import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { mediaReview } from './helpers/media-review-label.mjs';

const code = ts.transpileModule(readFileSync('app/dashboard/DancerTvStudio.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const video = (id, status = 'submitted', reviewNotes = '') => ({ id, status, videoUrl: `/${id}.mp4`, reviewNotes });
const file = () => new File(['video fixture'], 'clip.mp4', { type: 'video/mp4' });

// Run real component handlers with in-memory API/storage fixtures. No browser or remote uploads.
function harness(initial = [], { maxVideos = 50 } = {}) {
  let rows = [...initial], cursor = 0, effects = [], dirty = true, tree, readError = false, uploadError = false, cropCancelled = false;
  const slots = [], calls = [], intervals = new Set(), revoked = [];
  const props = { embedded: true };
  const depsChanged = (a, b) => !a || b.some((dep, i) => !Object.is(dep, a[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      slots[i].set ||= next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }; return [slots[i].value, slots[i].set]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (depsChanged(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
    useCallback(fn, deps) { const i = cursor++; if (depsChanged(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, DOMException, crypto: globalThis.crypto,
    URL: { createObjectURL: () => `blob:${crypto.randomUUID()}`, revokeObjectURL: url => revoked.push(url) },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    window: { confirm: () => true, requestAnimationFrame: fn => fn(), setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn) },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === '@/src/lib/dancr/media-review-label') return mediaReview;
      if (name === '@/src/lib/dancr/media-limits') return { MAX_DANCER_PROFILE_VIDEOS: 50 };
      if (name === './profile-video-crop') return { cropProfileVideo: async () => cropCancelled ? null : { source: { durationSeconds: 10, width: 720, height: 1280 } } };
      if (name === './dancer-profile-media-sync') return { announceDancerProfileVideosChanged() {}, primeVideoPreviewFrame() {} };
      if (name === './resumable-video-upload') return { uploadResumableVideo: async (_file, options) => { if (uploadError) throw new Error('Connection lost.'); options.onProgress(100); } };
      if (name === './dashboard-session') return {
        readDashboardAccessToken: () => 'fixture',
        requestDancerTvVideosJson: async options => {
          calls.push(['workspace', options.method || 'GET']);
          if (options.method === 'POST') { const { uploadId } = JSON.parse(options.body); if (!rows.some(row => row.id === uploadId)) rows.push(video(uploadId, 'uploading')); return { upload: { videoId: uploadId, path: 'private', token: 'fixture' } }; }
          if (readError) throw new Error('Unable to refresh.');
          return { profile: {}, profileEligible: false, profileVisible: false, videos: [...rows], maxVideos, remainingVideoSlots: maxVideos - rows.length };
        },
        requestDancerTvVideoJson: async (id, options) => {
          calls.push([id, options.method]);
          rows = options.method === 'DELETE' ? rows.filter(row => row.id !== id) : rows.map(row => row.id === id ? { ...row, status: 'moderating' } : row);
          return { ok: true };
        },
      };
      return { default: name };
    },
  });
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  function render() { for (let i = 0; dirty && i < 25; i++) { dirty = false; cursor = 0; effects = []; tree = exports.default(props); effects.forEach(fn => fn()); } assert.equal(dirty, false, 'effects settle'); }
  const ui = {
    calls, revoked,
    async settle() { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } },
    get notices() { return nodes().filter(node => node.type === './DancerRejectedUploadNotice'); },
    get reviews() { return nodes().filter(node => node.type === './DancerRejectedUploadNotice' || /^tv-upload-queue-item/.test(node.props?.className || '')); },
    get statuses() { return this.reviews.map(card => card.type === './DancerRejectedUploadNotice' ? 'Not approved' : nodes(card).find(node => node.type === 'small').props.children); },
    get notes() { return this.reviews.flatMap(card => card.type === './DancerRejectedUploadNotice' ? [card.props.message] : nodes(card).filter(node => node.type === 'p').map(node => node.props.children)); },
    get library() { return nodes().find(node => node.type === './DancerVideoPreviews')?.props.videos || []; },
    get sourceButtons() { return nodes().filter(node => node.type === 'button' && node.props.className?.includes('tv-video-source-action')); },
    setPermission(index, checked) { nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox')[index].props.onChange({ target: { checked } }); render(); },
    openSource(index) {
      nodes().filter(node => node.type === 'input' && node.props.type === 'file').forEach((node, i) => { node.props.ref.current = { click: () => calls.push(['picker', i]) }; });
      nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox').forEach((node, i) => { node.props.ref.current = { focus: () => calls.push(['permission-focus', i]) }; });
      this.sourceButtons[index].props.onClick(); render();
    },
    click(label) { const button = nodes().find(node => node.type === 'button' && node.props.children === label); assert.ok(button, label); assert.ok(!button.props.disabled); button.props.onClick(); render(); },
    permissions() { nodes().filter(node => node.type === 'input' && node.props.type === 'checkbox').forEach(node => node.props.onChange({ target: { checked: true } })); render(); },
    select(files = [file()]) { nodes().find(node => node.type === 'input' && node.props.multiple).props.onChange({ target: { files, value: '' } }); render(); },
    rerender() { dirty = true; render(); },
    async refresh(next) { if (next) rows = next; for (const fn of [...intervals]) fn(); await this.settle(); },
    setReadError(value) { readError = value; }, setUploadError(value) { uploadError = value; }, cancelCrop(value) { cropCancelled = value; },
  };
  render(); return ui;
}

test('both video sources stay gated until both permissions are checked and re-lock when unchecked', async () => {
  const ui = harness(); await ui.settle();
  assert.match(ui.sourceButtons[0].props.className, /tv-video-source-library/);
  assert.doesNotMatch(ui.sourceButtons[1].props.className, /tv-video-source-library/);
  const locked = () => ui.sourceButtons.forEach(button => {
    assert.equal(button.props['aria-disabled'], true);
    assert.match(button.props.className, /is-awaiting-permissions/);
  });
  locked(); ui.openSource(0); ui.openSource(1);
  assert.equal(ui.calls.filter(call => call[0] === 'picker').length, 0);
  assert.ok(ui.calls.some(call => call[0] === 'permission-focus' && call[1] === 0));
  ui.setPermission(0, true); locked(); ui.openSource(0);
  assert.equal(ui.calls.filter(call => call[0] === 'picker').length, 0);
  assert.ok(ui.calls.some(call => call[0] === 'permission-focus' && call[1] === 1));
  ui.setPermission(1, true);
  ui.sourceButtons.forEach(button => {
    assert.equal(button.props['aria-disabled'], false);
    assert.doesNotMatch(button.props.className, /is-awaiting-permissions/);
  });
  ui.openSource(0); ui.openSource(1);
  assert.deepEqual(ui.calls.filter(call => call[0] === 'picker'), [['picker', 0], ['picker', 1]]);
  ui.setPermission(0, false); locked(); ui.openSource(0);
  assert.equal(ui.calls.filter(call => call[0] === 'picker').length, 2);
});

test('saved unresolved videos show reasons and actions while only approvals enter the library', async () => {
  const ui = harness([video('live', 'approved'), video('checking', 'moderating'), video('denied', 'rejected', 'Only you may appear in the video.')]); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading', 'Not approved']);
  assert.deepEqual(ui.notes, ['Only you may appear in the video.']);
  assert.deepEqual(Array.from(ui.library, item => item.id), ['live']);
  ui.rerender(); assert.deepEqual(ui.statuses, ['Uploading', 'Not approved']);
  await ui.refresh([video('live', 'approved'), video('checking', 'approved'), video('denied', 'rejected', 'Only you may appear in the video.')]);
  assert.deepEqual(ui.statuses, ['Not approved']);
});

test('saved video reasons explain waiting review and replace legacy generic notes', async () => {
  const ui = harness([
    { ...video('uncertain', 'submitted', 'Automated safety review requested human review.'), moderationReasonCodes: ['person_count_uncertain'] },
    { ...video('denied', 'rejected', 'This video did not meet MyDancr TV safety guidelines.'), moderationReasonCodes: ['policy_contact_or_payment_overlay'] },
    video('no-reason', 'submitted'),
  ]);
  await ui.settle();
  assert.match(ui.notes[0], /couldn't confirm that you are the only person/);
  assert.match(ui.notes[1], /Remove phone numbers/);
  assert.equal(ui.notes.length, 2);
  await ui.refresh([video('uncertain', 'approved'), video('denied', 'approved'), video('no-reason', 'approved')]);
  assert.deepEqual(ui.notes, []);
  assert.equal(ui.library.length, 3);
});

test('submitted video remains visible through refresh failure then moves into the approved library', async () => {
  const ui = harness(); await ui.settle(); ui.permissions(); ui.setReadError(true); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading']); assert.equal(ui.library.length, 0);
  assert.equal(ui.revoked.length, 0, 'do not discard the only preview after submission');
  ui.rerender(); assert.deepEqual(ui.statuses, ['Uploading']);
  ui.setReadError(false); await ui.refresh();
  const id = ui.calls.find(call => call[1] === 'PATCH')[0];
  assert.deepEqual(ui.statuses, ['Uploading']);
  await ui.refresh([video(id, 'submitted', 'AI checks passed. Pending club approval.')]);
  assert.deepEqual(ui.statuses, ['Waiting for Club approval']);
  assert.deepEqual(ui.notes, []);
  await ui.refresh([video(id, 'approved')]); ui.rerender();
  assert.equal(ui.reviews.length, 0); assert.equal(ui.library.length, 1); assert.equal(ui.revoked.length, 1);
});

test('asynchronous video rejection keeps the same upload with the rejection reason', async () => {
  const ui = harness(); await ui.settle(); ui.permissions(); ui.select(); await ui.settle();
  const id = ui.calls.find(call => call[1] === 'PATCH')[0];
  await ui.refresh([video(id, 'rejected', 'Remove the contact overlay.')]);
  assert.deepEqual(ui.statuses, ['Not approved']); assert.deepEqual(ui.notes, ['Remove the contact overlay.']);
  assert.equal(ui.library.length, 0); assert.equal(ui.reviews.length, 1);
  ui.notices[0].props.onDismiss(); await ui.settle();
  assert.equal(ui.reviews.length, 0); assert.equal(ui.revoked.length, 1);
  assert.equal(ui.library.length, 0);
});

test('replacement at the video limit preserves the original on picker and crop cancellation', async () => {
  const ui = harness([video('waiting', 'submitted')], { maxVideos: 1 }); await ui.settle();
  ui.click('Replace'); ui.permissions(); ui.select([]); await ui.settle();
  assert.ok(!ui.calls.some(call => call[1] === 'DELETE'));
  ui.cancelCrop(true); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Waiting for Club approval']); assert.ok(!ui.calls.some(call => call[1] === 'DELETE'));
});

test('failed replacement remains retryable and never puts an unapproved video in the library', async () => {
  const ui = harness([video('waiting', 'submitted')], { maxVideos: 1 }); await ui.settle();
  ui.click('Replace'); ui.permissions(); ui.setUploadError(true); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Upload failed']); assert.equal(ui.library.length, 0);
  assert.equal(ui.calls.filter(call => call[1] === 'DELETE').length, 1);
  ui.rerender(); assert.deepEqual(ui.statuses, ['Upload failed']); ui.rerender();
  ui.setUploadError(false); ui.click('Retry'); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading']);
  assert.equal(ui.calls.filter(call => call[1] === 'DELETE').length, 1);
});
