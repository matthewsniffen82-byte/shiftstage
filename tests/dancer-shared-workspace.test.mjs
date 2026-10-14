import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { mediaReview } from './helpers/media-review-label.mjs';
import * as mediaLimits from '../src/lib/dancr/media-limits.ts';

// Component event/effect tests; no browser, server, network, or production data.
function harness(file, props, { valid = true, save = async () => true, hash = '' } = {}) {
  const slots = [], listeners = new Map(), writes = [];
  let cursor = 0, dirty = true, effects = [], tree, saves = 0, continuing = 0;
  const jsx = (type, props) => ({ type, props });
  const React = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      const slot = slots[index];
      slot.set ||= value => { const next = typeof value === 'function' ? value(slot.value) : value; if (!Object.is(next, slot.value)) { slot.value = next; dirty = true; } };
      return [slot.value, slot.set];
    },
    useRef(initial) {
      const index = cursor++;
      return slots[index] ||= { current: initial === null ? { querySelector: selector => selector === '.dancer-profile-identity-form' ? { reportValidity: () => valid } : null } : initial };
    },
    useEffect(effect, deps) {
      const index = cursor++, previous = slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; });
    },
    useCallback: fn => fn,
  };
  const modules = {
    '@/src/lib/dancr/media-limits': mediaLimits,
    '@/src/lib/dancr/media-review-label': mediaReview,
    react: React,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './DashboardShared': { AvatarUploadBusyContext: { Provider: 'AvatarProvider' }, persistedDancerStageName: p => p?.stageName || '', saveDancerProfileEditor: async () => { saves++; return save(); } },
    './DancerPhotoPanel': { dancerPhotoItemsFromProfile: p => p?.photos || [], relabelPhotoItems: p => p },
    './useDancerProfileVideos': { useDancerProfileVideos: () => ({ uploadedVideos: [], setUploadedVideos() {}, isMediaLoading: false, mediaError: '' }) },
    './DancerDashboardIdentity': { DancerDashboardIcon: 'Icon' },
    './DancerProfileUploadContext': { DancerProfileUploadContext: { Provider: 'UploadProvider' } },
    '@/app/dancers/[slug]/DancerPhotoCarousel': { DancerPhotoCarousel: 'Carousel' },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, {
    exports, require: name => modules[name] || { __esModule: true, default: name },
    window: { location: { hash }, history: { replaceState: (_, __, value) => writes.push(value) }, requestAnimationFrame: fn => { fn(); return 1; }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    document: { getElementById: () => null }, HTMLDetailsElement: class {},
  });
  props = { onContinue: () => { continuing++; }, ...props };
  function render() {
    for (let count = 0; dirty && count < 30; count++) {
      dirty = false; cursor = 0; effects = [];
      tree = exports.default(props); effects.forEach(effect => effect());
    }
    assert.equal(dirty, false, 'effects should settle');
    return tree;
  }
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  const button = label => nodes().find(node => node.type === 'button' && node.props.children === label);
  render();
  return { exports, nodes, button, listeners, writes,
    get saves() { return saves; }, get continuing() { return continuing; },
    render: () => { dirty = true; return render(); },
    update(next) { props = { ...props, ...next }; dirty = true; render(); },
    async click(label) { const element = button(label); assert.ok(element, label); element.props.onClick(); dirty = true; render(); await new Promise(resolve => setImmediate(resolve)); dirty = true; render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const editorFile = 'app/dashboard/DancerProfileWorkspace.tsx';
const profile = { id: 'fixture', stageName: 'Star', city: 'Las Vegas', avatarPhotoUrl: 'face.jpg', photos: [{ id: 'approved', status: 'approved', isPrimary: true, imageUrl: 'approved.jpg' }, { id: 'pending', status: 'pending', imageUrl: 'pending.jpg' }] };
const props = { profile, draftIdentity: { stageName: 'Star', city: 'Las Vegas' }, identityContent: { type: 'IdentityForm' } };
const editingProps = { ...props, draftIdentity: { stageName: 'Draft', city: 'Las Vegas' } };
const readyProfile = { ...profile, photos: [...profile.photos, { id: 'extra-one', status: 'approved' }, { id: 'extra-two', status: 'approved' }] };

test('onboarding saves before the agreement; returning editors save without advancing onboarding', async () => {
  for (const onboarding of [true, false]) {
    const ui = harness(editorFile, { ...editingProps, profile: readyProfile, onboarding });
    await ui.click(onboarding ? 'Continue to agreement' : 'Save changes');
    assert.equal(ui.saves, 1);
    assert.equal(ui.continuing, onboarding ? 1 : 0);
  }
});

test('invalid identity, failed saves, and thrown save errors never advance onboarding', async () => {
  for (const options of [{ valid: false }, { save: async () => false }, { save: async () => { throw Error('offline'); } }]) {
    const ui = harness(editorFile, { ...editingProps, profile: readyProfile, onboarding: true }, options);
    await ui.click('Continue to agreement');
    assert.equal(ui.continuing, 0);
    assert.equal(ui.saves, options.valid === false ? 0 : 1);
    assert.ok(ui.button('Continue') || ui.button('Continue to agreement'));
    assert.equal((ui.button('Continue') || ui.button('Continue to agreement')).props.disabled, false);
  }
});

test('duplicate save events are ignored until the first save settles', async () => {
  let resolve;
  const ui = harness(editorFile, editingProps, { save: () => new Promise(done => { resolve = done; }) });
  const save = ui.button('Save changes');
  save.props.onClick(); save.props.onClick(); ui.render();
  assert.equal(ui.saves, 1);
  assert.equal(ui.button('Saving…').props.disabled, true);
  resolve(true); await new Promise(done => setImmediate(done)); ui.render();
  assert.equal(ui.button('Save changes').props.disabled, false);
});

test('uploads lock save and section controls and retain a navigation warning', () => {
  const ui = harness(editorFile, { ...editingProps, uploadBusy: true });
  assert.equal(ui.button('Save changes').props.disabled, true);
  assert.equal(ui.button('Details').props.disabled, true);
  assert.ok(ui.listeners.has('beforeunload'));
  ui.button('Save changes').props.onClick(); assert.equal(ui.saves, 0);
  ui.update({ uploadBusy: false, draftIdentity: props.draftIdentity }); assert.equal(ui.listeners.has('beforeunload'), false);
});

test('profile editing remains visible with no preview toggle', () => {
  const ui = harness(editorFile, { ...props, draftIdentity: { stageName: 'New name', city: 'Las Vegas' } });
  const formArea = ui.nodes().find(node => node.type === 'fieldset');
  assert.ok(!formArea.props.hidden);
  assert.ok(ui.nodes().some(node => node.type === 'IdentityForm'));
  assert.equal(ui.button('Preview'), undefined);
  assert.equal(ui.saves, 0);
});

test('legacy deep links select their destination and profile contents remain mounted after leaving', () => {
  const ui = harness('app/dashboard/DancerDashboardWorkspace.tsx', { overview: 'Overview content', profile: 'Profile editor', results: 'Results content', account: 'Account content' }, { hash: '#dancer-profile-media' });
  assert.equal(ui.nodes().find(n => n.props?.id === 'dancer-destination-profile').props.hidden, false);
  const results = ui.nodes().find(n => n.type === 'button' && n.props['aria-controls'] === 'dancer-destination-results');
  results.props.onClick(); ui.render();
  const profilePanel = ui.nodes().find(n => n.props?.id === 'dancer-destination-profile');
  assert.equal(profilePanel.props.hidden, true); assert.equal(profilePanel.props.children, 'Profile editor');
  ui.update({ busy: true }); assert.ok(ui.nodes().filter(n => n.type === 'button').every(n => n.props.disabled));
  for (const [hash, destination] of [['#dancer-schedule','overview'],['#dancer-performance','results'],['#dancer-support','account'],['#dancer-visibility','profile']]) assert.equal(ui.exports.dancerDashboardDestination(hash), destination);
});

test('Edit profile still opens the editor from the overview', () => {
  const ui = harness('app/dashboard/DancerDashboardWorkspace.tsx', { overview: 'Overview content', profile: 'Profile editor', editorRequested: 0 });
  assert.equal(ui.nodes().find(n => n.props?.id === 'dancer-destination-profile').props.hidden, true);
  ui.update({ editorRequested: 1 });
  const panel = ui.nodes().find(n => n.props?.id === 'dancer-destination-profile');
  assert.equal(panel.props.hidden, false);
  assert.equal(panel.props.children, 'Profile editor');
  assert.equal(ui.writes.at(-1), '#dancer-profile');
});


test('editing details clears a previous saved confirmation', async () => {
  const ui = harness(editorFile, editingProps);
  await ui.click('Save changes');
  assert.ok(ui.nodes().some(n => n.props?.role === 'status' && n.props.children === 'Changes saved.'));
  ui.update({ draftIdentity: { stageName: 'A new name', city: 'Las Vegas' } });
  assert.ok(!ui.nodes().some(n => n.props?.role === 'status' && n.props.children === 'Changes saved.'));
  assert.ok(ui.listeners.has('beforeunload'));
});

test('the library contains approved extra photos only', () => {
  const ui = harness(editorFile, { ...props, profile: { ...profile, photos: [...profile.photos, { id: 'pending-main', isPrimary: true, status: 'pending' }, { id: 'extra', status: 'approved' }] } });
  const library = ui.nodes().find(node => node.type === './DancerProfileMediaUploads');
  assert.deepEqual(Array.from(library.props.photos, photo => photo.id), ['extra']);
  const emptyMain = harness(editorFile, { ...props, profile: { ...profile, photos: [{ id: 'gallery', status: 'approved' }] } });
  assert.equal(emptyMain.nodes().find(node => node.type === './DancerProfileMediaUploads').props.photos.length, 1);
});

test('pending face reviews prevent continuing, and only approved photos count toward setup', async () => {
  const ui = harness(editorFile, { ...props, onboarding: true, profile: { ...profile, avatarPhotoUrl: '', pending_avatar_review: { status: 'pending_review' } } });
  await ui.click('Continue to agreement');
  assert.equal(ui.continuing, 0);
  assert.ok(ui.nodes().some(node => node.props?.role === 'status' && /Face photo: awaiting review/.test(node.props.children)));
  ui.update({ profile: readyProfile });
  await ui.click('Continue to agreement'); assert.equal(ui.continuing, 1);
});

test('saving details never advances past a pending main photo', async () => {
  const ui = harness(editorFile, { ...props, onboarding: true, profile: { ...profile, photos: [{ id: 'main-review', isPrimary: true, status: 'pending', moderationStatus: 'pending_review' }] } });
  await ui.click('Continue to agreement');
  assert.equal(ui.saves, 0); assert.equal(ui.continuing, 0);
  assert.ok(ui.nodes().some(node => node.props?.role === 'status' && /Main photo: awaiting review/.test(node.props.children)));
});
