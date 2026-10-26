import { refreshButtonModule } from './helpers/refresh-button.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { adminReviewQueue } from '../app/admin/admin-review-queue.ts';
import { loadTableQrPrintImages, renderTableQrPrintDocument } from '../app/admin/admin-table-qr-print.ts';
import { ADMIN_DATA_CHANGED, notifyAdminDataChanged } from '../app/admin/admin-data-events.ts';

const source = readFileSync('app/admin/AdminClient.tsx', 'utf8');
function extract(path, name, globals) {
  const text = readFileSync(path, 'utf8'), ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fn.getText(ast) + `\nexport { ${name} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, Error, AbortController, RefreshButton: refreshButtonModule.default, ...globals, require: () => ({ jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }) });
  return exports[name];
}
const profile = { id: 'dancer', userId: 'user', stageName: 'Dancer', status: 'pending_review', createdAt: '2026-10-01',
  photos: [{ id: 'photo', reviewStatus: 'pending' }, { id: 'ready', reviewStatus: 'approved' }],
  socialLinks: [{ id: 'social', platform: 'instagram', reviewStatus: 'pending' }, { id: 'inactive', reviewStatus: 'pending', isActive: false }] };

test('one queue includes pending applications, photos, social links and videos without duplicating a moderated photo', () => {
  const queue = adminReviewQueue([profile, { ...profile, id: 'disabled', status: 'disabled' }],
    [{ id: 'moderation', image_id: 'photo', user_id: 'user', decision: 'review', created_at: '2026-10-01' }],
    [{ id: 'video', status: 'submitted', submittedAt: '2026-10-02', dancer: { id: 'dancer' } }, { id: 'approved-video', status: 'approved' }]);
  assert.deepEqual(queue.map(item => item.kind).sort(), ['application', 'photo', 'social', 'video']);
  assert.equal(queue.find(item => item.kind === 'photo').source, 'moderation');
  assert.equal(queue.find(item => item.kind === 'photo').dancerId, 'dancer');
  assert.equal(queue.at(-1).id, 'video');
});

test('a confirmed review advances to the next item, while busy controls cannot skip and failed refresh retains the item', async () => {
  const slots = []; let cursor = 0;
  const noop = () => {};
  const Component = extract('app/admin/AdminClient.tsx', 'UnifiedReviewQueue', {
    useState(value) { const i = cursor++; slots[i] ??= { value }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(value) { return slots[cursor++] ??= { current: value }; }, useEffect: noop,
    adminReviewQueue, asText: String, asRecordArray: value => Array.isArray(value) ? value : [],
    ApprovalQueue: 'ApprovalQueue', ImageModerationQueue: 'ImageModerationQueue', AdminTvPanel: 'AdminTvPanel',
  });
  let props = { profiles: [profile], images: [], videos: [], warnings: [], onActionConfirmed: noop, onManageDancer: noop,
    onProfilesChange: rows => { props.profiles = rows; }, onImagesChange: noop, onVideosChange: noop, onRefresh: async () => { throw new Error('Unavailable'); } };
  const nodes = node => node?.type === refreshButtonModule.default ? nodes(node.type(node.props)) : node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
  const render = () => { cursor = 0; return nodes(Component(props)); };
  let tree = render(), review = tree.find(node => node.type === 'ApprovalQueue');
  assert.equal(review.props.reviewTarget.id, 'photo');
  review.props.onBusyChange(true); tree = render();
  assert.equal(tree.find(node => node.props?.children === 'Skip for now').props.disabled, true);
  review.props.onBusyChange(false); tree = render();
  await tree.find(node => node.props?.['aria-label'] === 'Refresh approval queue').props.onClick();
  await new Promise(resolve => setImmediate(resolve)); tree = render();
  assert.ok(tree.some(node => node.props?.role === 'alert' && node.props.children === 'Unavailable'));
  review = tree.find(node => node.type === 'ApprovalQueue'); assert.equal(review.props.reviewTarget.id, 'photo');
  review.props.onContentReviewed('dancer', 'photo', 'photo', 'approved', '', { checked: true });
  tree = render(); assert.equal(tree.find(node => node.type === 'ApprovalQueue').props.reviewTarget.id, 'social');
  assert.equal(props.profiles[0].photos[0].reviewStatus, 'approved');
});

test('club setup has three stages based on saved access, preparation and approval', () => {
  const steps = extract('app/admin/AdminClubSetupChecklist.tsx', 'clubSetupSteps', {});
  const venue = { id: 'club', is_active: false, page_review_status: 'venue_review', logo_image_url: 'logo', owner_user_id: 'manager' };
  const incomplete = steps(venue, true, true);
  assert.deepEqual(Array.from(incomplete, step => step.label), ['Access', 'Prepare', 'Club approval']);
  assert.equal(incomplete.find(step => step.id === 'publish').detail, 'Waiting for the club’s approval');
  assert.ok(steps({ ...venue, is_active: true }, true, true).every(step => step.complete));
  assert.equal(steps(venue, false, true).find(step => !step.complete).id, 'page');
  assert.equal(steps({ ...venue, owner_user_id: null }, true, true).find(step => !step.complete).id, 'access');
});

test('hiding an approved club keeps setup complete, and incomplete drafts still need a logo and deal', () => {
  const steps = extract('app/admin/AdminClubSetupChecklist.tsx', 'clubSetupSteps', {});
  assert.equal(steps({ is_active: false, published_at: '2026-10-26' }, false, false).find(step => step.id === 'publish').complete, true);
  const prepare = steps({}, true, false).find(step => step.id === 'page');
  assert.equal(prepare.complete, false);
  assert.match(prepare.detail, /logo, Club Deal/);
});

test('print all fetches each active saved code in numeric order and rejects mismatched clubs or unsafe images', async () => {
  const codes = [{ id: '20', label: 'Table 20', active: true }, { id: '2', label: 'Table 2', active: true }, { id: '1', label: 'Table 1', active: false }];
  const calls = [], imageDataUrl = 'data:image/png;base64,aGVsbG8=';
  const images = await loadTableQrPrintImages('club', codes, async path => { const id = new URL(path, 'https://example.test').searchParams.get('download'); calls.push(id); return { venueId: 'club', id, imageDataUrl }; });
  assert.deepEqual(calls, ['2', '20']); assert.deepEqual(images.map(image => image.label), ['Table 2', 'Table 20']);
  for (const bad of [{ venueId: 'other', id: '2', imageDataUrl }, { venueId: 'club', id: '2', imageDataUrl: 'javascript:alert(1)' }]) {
    await assert.rejects(loadTableQrPrintImages('club', [codes[1]], async () => bad), /could not be confirmed/);
  }
});

test('print labels are inserted as text and printing waits for every QR image', async () => {
  const created = [], make = tag => { const node = { tag, children: [], append(...nodes) { this.children.push(...nodes); }, replaceChildren() { this.children = []; } }; created.push(node); return node; };
  const doc = { createElement: make, body: make('body'), head: make('head') };
  let ready = false;
  const promise = renderTableQrPrintDocument(doc, '<script>club</script>', [{ label: '<img>Table 1', imageDataUrl: 'data:image/png;base64,aA==' }]).then(() => { ready = true; });
  await Promise.resolve(); assert.equal(ready, false);
  assert.equal(created.find(node => node.tag === 'h1').textContent, '<script>club</script>');
  assert.equal(created.find(node => node.tag === 'h2').textContent, '<img>Table 1');
  created.find(node => node.tag === 'img').onload(); await promise; assert.equal(ready, true);
  assert.ok(created.every(node => !('innerHTML' in node)));
});

test('read requests do not trigger counts; successful mutation notifications do', () => {
  const old = globalThis.window, events = [];
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  try { notifyAdminDataChanged(); notifyAdminDataChanged('GET'); notifyAdminDataChanged('POST'); notifyAdminDataChanged('PATCH');
    assert.deepEqual(events, [ADMIN_DATA_CHANGED, ADMIN_DATA_CHANGED]); }
  finally { globalThis.window = old; }
});

function reviewComponent(path, name, props, request) {
  const slots = []; let cursor = 0, effects = [], tree;
  const Component = extract(path, name, {
    useState(initial) { const i = cursor++; slots[i] ??= { value: initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useEffect(effect, deps) { const i = cursor++; if (!slots[i] || deps.some((value, j) => value !== slots[i].deps[j])) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = effect(); }); } },
    window: { confirm: () => true }, requestAdminJson: request, AdminTvPanelStyles: 'styles', Link: 'a', canRetryAutomatedReview: () => false, readableReason: value => value,
  });
  const nodes = node => node?.type === refreshButtonModule.default ? nodes(node.type(node.props)) : node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
  function render() { cursor = 0; tree = Component(props); while (effects.length) effects.shift()(); return nodes(tree); }
  return { render, close() { slots.forEach(slot => slot?.cleanup?.()); } };
}

test('photo and video cards advance only for a confirmed matching decision', async () => {
  for (const kind of ['photo', 'video']) for (const valid of [false, true]) {
    const decisions = [];
    const props = kind === 'photo'
      ? { records: [{ id: 'item', decision: 'review', thumbnailUrl: 'photo', club_reviewed_at: '2026-10-01' }], focused: true, onRecordsChange: rows => decisions.push(rows), onActionConfirmed() {} }
      : { selectedVideo: { id: 'item', status: 'submitted', videoUrl: 'video' }, onReviewed: (...args) => decisions.push(args) };
    const data = kind === 'photo' ? { record: { id: valid ? 'item' : 'other', decision: 'approved' } } : { video: { id: valid ? 'item' : 'other', status: 'approved' } };
    const fixture = reviewComponent(kind === 'photo' ? 'app/admin/AdminClient.tsx' : 'app/admin/AdminTvPanel.tsx', kind === 'photo' ? 'ImageModerationQueue' : 'AdminTvPanel', props, async () => data);
    const button = fixture.render().find(node => node.type === 'button' && node.props.children === 'Approve and publish');
    await button.props.onClick(); fixture.render();
    assert.equal(decisions.length, valid ? 1 : 0, `${kind}: ${valid ? 'matching' : 'mismatched'} receipt`);
    fixture.close();
  }
});
