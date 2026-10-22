import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { mediaReview } from './helpers/media-review-label.mjs';

const code = ts.transpileModule(readFileSync('app/dashboard/DancerTvStudio.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const video = (id, status = 'submitted', reviewNotes = '') => ({ id, status, moderationDecision: status === 'submitted' ? 'approved' : null, videoUrl: `/${id}.mp4`, reviewNotes });
const file = () => new File(['video fixture'], 'clip.mp4', { type: 'video/mp4' });

// Run real component handlers with in-memory API/storage fixtures. No browser or remote uploads.
function harness(initial = [], { maxVideos = 50, upload = async options => options.onProgress(100) } = {}) {
  let rows = [...initial], cursor = 0, effects = [], dirty = true, tree, readError = false, uploadError = false, metadataError = false;
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
  vm.runInNewContext(code, { exports, Error, AbortController, DOMException, crypto: globalThis.crypto,
    URL: { createObjectURL: () => `blob:${crypto.randomUUID()}`, revokeObjectURL: url => revoked.push(url) },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    window: { confirm: () => true, requestAnimationFrame: fn => fn(), setInterval: fn => { intervals.add(fn); return fn; }, clearInterval: fn => intervals.delete(fn) },
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === '@/src/lib/dancr/media-review-label') return mediaReview;
      if (name === '@/src/lib/dancr/media-limits') return { MAX_DANCER_PROFILE_VIDEOS: 50 };
      if (name === './read-video-metadata') return { readVideoMetadata: async file => { calls.push(['metadata', file]); if (metadataError) throw new Error(typeof metadataError === 'string' ? metadataError : 'Choose a video between 1 and 30 seconds.'); return { duration: 10, width: 720, height: 1280 }; } };
      if (name === './dancer-profile-media-sync') return { announceDancerProfileVideosChanged() {}, primeVideoPreviewFrame() {} };
      if (name === './resumable-video-upload') return { uploadResumableVideo: async (file, options) => { calls.push(['upload', file]); if (uploadError) throw new Error('Connection lost.'); await upload(options); } };
      if (name === './dashboard-session') return {
        readDashboardAccessToken: () => 'fixture',
        requestDancerTvVideosJson: async options => {
          calls.push(['workspace', options.method || 'GET']);
          if (options.method === 'POST') { const body = JSON.parse(options.body); calls.push(['prepare', body]); const { uploadId } = body; if (!rows.some(row => row.id === uploadId)) rows.push(video(uploadId, 'uploading')); return { upload: { videoId: uploadId, path: 'private', token: 'fixture' } }; }
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
    get reviewActions() { return this.reviews.flatMap(card => nodes(card).filter(node => node.type === 'button' || node.type === './DancerMediaRetryButton')); },
    get uploadMessages() { return nodes().filter(node => node.props?.className === 'tv-studio-status').map(node => node.props.children); },
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
    setReadError(value) { readError = value; }, setUploadError(value) { uploadError = value; }, setMetadataError(value) { metadataError = value; },
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

test('saved active video checks hide actions while only approvals enter the library', async () => {
  const ui = harness([video('live', 'approved'), video('checking', 'moderating'), video('denied', 'rejected', 'Multiple people')]); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading', 'Not approved']);
  assert.deepEqual(ui.notes, ['Multiple people']);
  assert.deepEqual(ui.reviewActions, []);
  assert.deepEqual(Array.from(ui.library, item => item.id), ['live']);
  ui.rerender(); assert.deepEqual(ui.statuses, ['Uploading', 'Not approved']);
  await ui.refresh([video('live', 'approved'), video('checking', 'approved'), video('denied', 'rejected', 'Multiple people')]);
  assert.deepEqual(ui.statuses, ['Not approved']);
});

test('video upload and checks stay compact with no actions or repeated uploading message', async () => {
  let finishUpload;
  const ui = harness([], { upload: options => new Promise(resolve => { options.onProgress(40); finishUpload = resolve; }) });
  await ui.settle(); ui.permissions(); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading']);
  assert.deepEqual(ui.reviewActions, []);
  assert.deepEqual(ui.uploadMessages, []);
  finishUpload(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading']);
  assert.deepEqual(ui.reviewActions, [], 'server checks keep actions hidden after transfer completes');
  const id = ui.calls.find(call => call[1] === 'PATCH')[0];
  await ui.refresh([video(id, 'submitted')]);
  assert.deepEqual(ui.statuses, ['Waiting for Club approval']);
  assert.deepEqual(ui.reviewActions.map(node => node.props.children), ['Remove']);
});

test('saved video reasons explain waiting review and replace legacy generic notes', async () => {
  const ui = harness([
    { ...video('uncertain', 'submitted', 'Automated safety review requested human review.'), moderationReasonCodes: ['person_count_uncertain'] },
    { ...video('denied', 'rejected', 'This video did not meet MyDancr TV safety guidelines.'), moderationReasonCodes: ['policy_contact_or_payment_overlay'] },
    video('no-reason', 'submitted'),
  ]);
  await ui.settle();
  assert.match(ui.notes[0], /couldn't confirm that you are the only person/);
  assert.match(ui.notes[1], /Contact information/);
  assert.equal(ui.notes.length, 2);
  await ui.refresh([video('uncertain', 'approved'), video('denied', 'approved'), video('no-reason', 'approved')]);
  assert.deepEqual(ui.notes, []);
  assert.equal(ui.library.length, 3);
});

test('submitted video remains visible through refresh failure then moves into the approved library', async () => {
  const ui = harness(); await ui.settle(); ui.permissions(); ui.setReadError(true); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading']); assert.equal(ui.library.length, 0);
  assert.deepEqual(ui.reviewActions, [], 'a submitted upload cannot be replaced or retried while refresh is unavailable');
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
  await ui.refresh([video(id, 'rejected', 'Contact information')]);
  assert.deepEqual(ui.statuses, ['Not approved']); assert.deepEqual(ui.notes, ['Contact information']);
  assert.equal(ui.library.length, 0); assert.equal(ui.reviews.length, 1);
  ui.notices[0].props.onDismiss(); await ui.settle();
  assert.equal(ui.reviews.length, 0); assert.equal(ui.revoked.length, 1);
  assert.equal(ui.library.length, 0);
});

test('club approval videos offer only Remove through refreshes and remove the saved upload', async () => {
  const ui = harness([video('waiting', 'submitted')]); await ui.settle();
  assert.deepEqual(ui.reviewActions.map(node => node.props.children), ['Remove']);
  assert.match(ui.reviews[0].props.className, /is-awaiting-club/);
  await ui.refresh([video('waiting', 'review')]);
  assert.deepEqual(ui.reviewActions.map(node => node.props.children), ['Remove']);
  ui.click('Remove'); await ui.settle();
  assert.ok(ui.calls.some(call => call[0] === 'waiting' && call[1] === 'DELETE'));
  assert.equal(ui.reviews.length, 0);
});

test('a failed automatic video check offers retry instead of claiming it is awaiting Club approval', async () => {
  const ui = harness([{ ...video('failed-check', 'submitted'), moderationDecision: 'review',
    moderationReasonCodes: ['video_moderation_timeout'], reviewNotes: 'Automated safety review was unavailable. Human review is required.' }]);
  await ui.settle();
  assert.deepEqual(ui.statuses, ['Review delayed']);
  assert.match(ui.notes[0], /timed out.*Retry/);
  assert.doesNotMatch(ui.notes[0], /human review|manual review/i);
  assert.ok(ui.reviewActions.some(node => node.type === './DancerMediaRetryButton' && node.props.moderationStatus === 'moderation_error'));
  assert.doesNotMatch(ui.reviews[0].props.className, /is-awaiting-club/);
});

test('delayed review replacement at the video limit preserves the original on picker cancellation and invalid replacement files', async () => {
  const ui = harness([video('waiting', 'error')], { maxVideos: 1 }); await ui.settle();
  ui.click('Replace'); ui.permissions(); ui.select([]); await ui.settle();
  assert.ok(!ui.calls.some(call => call[1] === 'DELETE'));
  ui.setMetadataError(true); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Upload failed', 'Review delayed']); assert.ok(!ui.calls.some(call => call[1] === 'DELETE'));
});

test('failed replacement remains retryable and never puts an unapproved video in the library', async () => {
  const ui = harness([video('waiting', 'error')], { maxVideos: 1 }); await ui.settle();
  ui.click('Replace'); ui.permissions(); ui.setUploadError(true); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Upload failed']); assert.equal(ui.library.length, 0);
  assert.deepEqual(ui.notes, ['Connection lost.'], 'show only the specific failure, not duplicate generic notes');
  assert.equal(ui.calls.filter(call => call[1] === 'DELETE').length, 1);
  ui.rerender(); assert.deepEqual(ui.statuses, ['Upload failed']); ui.rerender();
  ui.setUploadError(false); ui.click('Retry'); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading']);
  assert.equal(ui.calls.filter(call => call[1] === 'DELETE').length, 1);
});

test('chosen videos upload the original file directly without crop or trim metadata', async () => {
  const ui = harness(), original = file(); await ui.settle(); ui.permissions(); ui.select([original]); await ui.settle();
  assert.equal(ui.calls.find(call => call[0] === 'metadata')[1], original);
  assert.equal(ui.calls.find(call => call[0] === 'upload')[1], original);
  const body = ui.calls.find(call => call[0] === 'prepare')[1];
  assert.equal(body.edit, undefined); assert.equal(body.width, 720); assert.equal(body.height, 1280); assert.equal(body.durationSeconds, 10);
  assert.deepEqual(ui.statuses, ['Uploading']);
});

test('overlength videos show the photo-style rejection notice without creating an upload or offering Retry', async () => {
  const ui = harness(); await ui.settle(); ui.permissions(); ui.setMetadataError('Over 30 seconds'); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Not approved']); assert.deepEqual(ui.notes, ['Over 30 seconds']);
  assert.equal(ui.notices[0].props.localOnly, true);
  assert.deepEqual(ui.reviewActions, []); assert.deepEqual(ui.uploadMessages, []);
  assert.equal(ui.calls.some(call => call[0] === 'prepare' || call[0] === 'upload'), false);
  ui.notices[0].props.onDismiss(); await ui.settle();
  assert.equal(ui.reviews.length, 0); assert.equal(ui.revoked.length, 1);
  assert.equal(ui.calls.some(call => call[1] === 'DELETE' || call[1] === 'PATCH'), false);
});

test('overlength replacement preserves the existing video and frees its rejected local preview', async () => {
  const ui = harness([video('original', 'error')], { maxVideos: 1 }); await ui.settle();
  ui.click('Replace'); ui.permissions(); ui.setMetadataError('Over 30 seconds'); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Not approved', 'Review delayed']);
  ui.notices[0].props.onDismiss(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Review delayed']);
  assert.equal(ui.calls.some(call => call[1] === 'DELETE' || call[0] === 'prepare'), false);
});
