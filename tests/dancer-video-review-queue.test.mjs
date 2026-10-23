import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { mediaReview } from './helpers/media-review-label.mjs';
import { createMediaUploadCancellation } from '../app/dashboard/media-upload-cancellation.ts';
import { MEDIA_UPLOAD_CONCURRENCY, runMediaUploadBatch } from '../app/dashboard/media-upload-batch.ts';
import * as processingState from '../src/lib/dancr/video-processing-state.ts';

const code = ts.transpileModule(readFileSync('app/dashboard/DancerTvStudio.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const video = (id, status = 'submitted', reviewNotes = '') => ({ id, status, moderationDecision: status === 'submitted' ? 'review' : null, moderationDetails: { fileChecksPassed: status === 'submitted' }, videoUrl: `/${id}.mp4`, reviewNotes });
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
      if (name === '@/src/lib/dancr/video-processing-state') return processingState;
      if (name === './media-upload-cancellation') return { createMediaUploadCancellation };
      if (name === './media-upload-batch') return { MEDIA_UPLOAD_CONCURRENCY, runMediaUploadBatch };
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
    get uploadHint() { return Array.from(nodes().find(node => node.props?.className === 'tv-upload-requirements').props.children).join(''); },
    get progress() { return nodes().filter(node => node.props?.role === 'progressbar'); },
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

test('saved active video checks offer Cancel while only approvals enter the library', async () => {
  const ui = harness([video('live', 'approved'), video('checking', 'moderating'), video('denied', 'rejected', 'Multiple people')]); await ui.settle();
  assert.deepEqual(ui.statuses, ['Completed', 'Not approved']);
  assert.deepEqual(ui.notes, ['Multiple people']);
  assert.deepEqual(ui.reviewActions.map(node => node.props.children), ['Cancel']);
  assert.deepEqual(Array.from(ui.library, item => item.id), ['live']);
  ui.rerender(); assert.deepEqual(ui.statuses, ['Completed', 'Not approved']);
  await ui.refresh([video('live', 'approved'), video('checking', 'approved'), video('denied', 'rejected', 'Multiple people')]);
  assert.deepEqual(ui.statuses, ['Not approved']);
});

test('video upload and checks stay compact with Cancel and no repeated uploading message', async () => {
  let finishUpload;
  const ui = harness([], { upload: options => new Promise(resolve => { options.onProgress(40); finishUpload = resolve; }) });
  await ui.settle(); ui.permissions(); ui.select(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Uploading · 40%']);
  assert.equal(ui.progress[0].props['aria-valuenow'], 40);
  assert.equal(ui.progress[0].props.children.props.style.width, '40%');
  assert.deepEqual(ui.reviewActions.map(node => node.props.children), ['Cancel']);
  assert.deepEqual(ui.uploadMessages, []);
  finishUpload(); await ui.settle();
  assert.deepEqual(ui.statuses, ['Completed']);
  assert.equal(ui.progress.length, 0, 'the bar disappears as soon as the file finishes uploading');
  assert.deepEqual(ui.reviewActions.map(node => node.props.children), ['Cancel'], 'server checks retain Cancel after transfer completes');
  const id = ui.calls.find(call => call[1] === 'PATCH')[0];
  await ui.refresh([video(id, 'submitted')]);
  assert.deepEqual(ui.statuses, ['Waiting for final approval']);
  assert.equal(ui.progress.length, 0, 'completed checks stop the progress bar while awaiting a person');
  assert.deepEqual(ui.reviewActions.map(node => node.props.children), ['Remove']);
});

test('Cancel uploads stops the active video, skips queued videos and keeps earlier checks with retry available', async () => {
  const transfers = [];
  const ui = harness([], { upload: options => {
    transfers.push(options);
    if (transfers.length === 1 || transfers.length > 6) { options.onProgress(100); return Promise.resolve(); }
    return new Promise((_, reject) => {
      options.onProgress(40);
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  } });
  await ui.settle(); ui.permissions(); ui.select(Array.from({ length: 7 }, file)); await ui.settle();
  assert.deepEqual(ui.statuses, ['Completed', ...Array(5).fill('Uploading · 40%'), 'Uploading · 0%']);
  const firstId = ui.calls.find(call => call[1] === 'PATCH')[0];
  ui.click('Cancel uploads'); await ui.settle();
  assert.equal(transfers[1].signal.aborted, true);
  assert.equal(transfers.length, 6);
  assert.ok(transfers.slice(1).every(transfer=>transfer.signal.aborted));
  assert.deepEqual(ui.statuses, ['Completed', ...Array(6).fill('Upload canceled')]);
  transfers[1].onProgress(95); ui.rerender();
  assert.deepEqual(ui.statuses, ['Completed', ...Array(6).fill('Upload canceled')], 'late progress cannot revive a canceled upload');
  assert.equal(ui.calls.filter(call => call[1] === 'PATCH').length, 1);
  ui.click('Retry'); await ui.settle();
  assert.equal(transfers.length, 7); assert.equal(transfers[6].signal.aborted, false);
  const prepared = ui.calls.filter(call => call[0] === 'prepare').map(call => call[1].uploadId);
  assert.equal(prepared[6], prepared[1], 'retry keeps its existing upload identity');
  assert.equal(ui.calls.filter(call => call[0] === firstId && call[1] === 'PATCH').length, 1);
  assert.deepEqual(ui.statuses, ['Completed', 'Completed', ...Array(5).fill('Upload canceled')]);
});

test('bulk videos use five workers and a stalled file does not block queued files',async()=>{
  const transfers=[];
  const ui=harness([],{upload:options=>new Promise((resolve,reject)=>{
    options.onProgress(20);transfers.push({resolve,reject});
  })});
  await ui.settle();
  assert.match(ui.uploadHint, /Up to 5 videos upload at once; extras wait in line\./);
  ui.permissions();ui.select(Array.from({length:7},file));await ui.settle();
  assert.equal(transfers.length,5);
  assert.deepEqual(ui.statuses,[...Array(5).fill('Uploading · 20%'),'Uploading · 0%','Uploading · 0%']);
  transfers[1].reject(Error('Video upload stalled. Tap Retry to continue your upload.'));await ui.settle();
  assert.equal(transfers.length,6);assert.equal(ui.statuses[1],'Upload failed','failure is visible before the batch finishes');
  transfers[2].resolve();await ui.settle();assert.equal(transfers.length,7);
  assert.equal(ui.statuses[0],'Uploading · 20%','other transfers progressed while the first was still active');
  transfers.forEach(transfer=>transfer.resolve());await ui.settle();
  assert.equal(ui.calls.filter(call=>call[1]==='PATCH').length,6);
  assert.equal(ui.reviewActions.find(node=>node.props.children==='Retry').props.disabled,false);
  assert.equal(ui.library.length,0,'upload concurrency does not bypass checks or club approval');
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
  assert.deepEqual(ui.statuses, ['Completed']); assert.equal(ui.library.length, 0);
  assert.deepEqual(ui.reviewActions.map(node => node.props.children), ['Cancel'], 'a submitted upload cannot be replaced or retried while refresh is unavailable');
  assert.equal(ui.revoked.length, 0, 'do not discard the only preview after submission');
  ui.rerender(); assert.deepEqual(ui.statuses, ['Completed']);
  ui.setReadError(false); await ui.refresh();
  const id = ui.calls.find(call => call[1] === 'PATCH')[0];
  assert.deepEqual(ui.statuses, ['Completed']);
  await ui.refresh([video(id, 'submitted', 'AI checks passed. Pending club approval.')]);
  assert.deepEqual(ui.statuses, ['Waiting for final approval']);
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
    moderationDetails: { fileChecksPassed: false },
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
  assert.deepEqual(ui.statuses, ['Completed']);
  assert.equal(ui.calls.filter(call => call[1] === 'DELETE').length, 1);
});

test('chosen videos upload the original file directly without crop or trim metadata', async () => {
  const ui = harness(), original = file(); await ui.settle(); ui.permissions(); ui.select([original]); await ui.settle();
  assert.equal(ui.calls.find(call => call[0] === 'metadata')[1], original);
  assert.equal(ui.calls.find(call => call[0] === 'upload')[1], original);
  const body = ui.calls.find(call => call[0] === 'prepare')[1];
  assert.equal(body.edit, undefined); assert.equal(body.width, 720); assert.equal(body.height, 1280); assert.equal(body.durationSeconds, 10);
  assert.deepEqual(ui.statuses, ['Completed']);
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

test('a stale saved check shows recovery actions and can be canceled after a hard refresh', async () => {
  const ui=harness([{...video('stuck','moderating'),moderationStartedAt:new Date(Date.now()-600000).toISOString()}]);
  await ui.settle();assert.deepEqual(ui.statuses,['Upload delayed']);assert.equal(ui.progress.length,0);
  assert.ok(ui.reviewActions.some(node=>node.type==='./DancerMediaRetryButton'));
  ui.click('Cancel');await ui.settle();
  assert.ok(ui.calls.some(call=>call[0]==='stuck'&&call[1]==='DELETE'));
  assert.equal(ui.reviews.length,0);await ui.refresh();assert.equal(ui.reviews.length,0);
});

test('Cancel aborts a selected transfer, removes its saved reservation, and ignores late progress', async () => {
  let progress;
  const ui=harness([], {upload:options=>new Promise((_resolve,reject)=>{
    progress=options.onProgress;options.onProgress(20);
    options.signal.addEventListener('abort',()=>reject(new DOMException('Canceled','AbortError')),{once:true});
  })});
  await ui.settle();ui.permissions();ui.select();await ui.settle();ui.click('Cancel');await ui.settle();
  assert.equal(ui.reviews.length,0);assert.ok(ui.calls.some(call=>call[1]==='DELETE'));
  progress(90);await ui.settle();assert.equal(ui.reviews.length,0);
  await ui.refresh();assert.equal(ui.reviews.length,0);
});

test('Cancel is available for saved processing videos while another file is uploading', async () => {
  const ui=harness([video('saved','moderating')], {upload:()=>new Promise(()=>{})});
  await ui.settle();ui.permissions();ui.select();await ui.settle();
  const cancel=ui.reviewActions.filter(node=>node.props.children==='Cancel');
  assert.equal(cancel.length,2);assert.equal(cancel[1].props.disabled,false);
  cancel[1].props.onClick();await ui.settle();
  assert.ok(ui.calls.some(call=>call[0]==='saved'&&call[1]==='DELETE'));
  assert.equal(ui.reviews.length,1);
});

test('Cancel immediately removes a queued video while all transfer slots are occupied', async () => {
  const transfers=[];
  const ui=harness([], {upload:()=>new Promise(resolve=>transfers.push(resolve))});
  await ui.settle();ui.permissions();ui.select(Array.from({length:6},file));await ui.settle();
  const cancel=ui.reviewActions.filter(node=>node.props.children==='Cancel');
  cancel[5].props.onClick();await ui.settle();
  assert.equal(ui.reviews.length,5);assert.equal(transfers.length,5);
  transfers.forEach(resolve=>resolve());await ui.settle();
  assert.equal(transfers.length,5);assert.equal(ui.calls.filter(call=>call[0]==='prepare').length,5);
});
