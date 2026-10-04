import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

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
    react: React,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    './DashboardShared': { AvatarUploadBusyContext: { Provider: 'AvatarProvider' }, persistedDancerStageName: p => p?.stageName || '', saveDancerProfileEditor: async () => { saves++; return save(); } },
    './DancerPhotoPanel': { dancerPhotoItemsFromProfile: p => p?.photos || [], relabelPhotoItems: p => p },
    './useDancerProfileVideos': { useDancerProfileVideos: () => ({ uploadedVideos: [], setUploadedVideos() {}, isMediaLoading: false, mediaError: '' }) },
    './DancerDashboardIdentity': { DancerDashboardIcon: 'Icon' },
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
const profile = { id: 'fixture', stageName: 'Star', city: 'Las Vegas', photos: [{ id: 'approved', status: 'approved', isPrimary: true, imageUrl: 'approved.jpg' }, { id: 'pending', status: 'pending', imageUrl: 'pending.jpg' }] };
const props = { profile, draftIdentity: { stageName: 'Star', city: 'Las Vegas' }, identityContent: { type: 'IdentityForm' } };

test('onboarding and live editing share the same explicit save; only onboarding continues', async () => {
  for (const onboarding of [true, false]) {
    const ui = harness(editorFile, { ...props, onboarding, profileReady: true });
    await ui.click(onboarding ? 'Continue' : 'Save changes');
    assert.equal(ui.saves, 1);
    assert.equal(ui.continuing, onboarding ? 1 : 0);
  }
});

test('invalid identity, failed saves, and thrown save errors never advance onboarding', async () => {
  for (const options of [{ valid: false }, { save: async () => false }, { save: async () => { throw Error('offline'); } }]) {
    const ui = harness(editorFile, { ...props, onboarding: true }, options);
    await ui.click('Save & continue');
    assert.equal(ui.continuing, 0);
    assert.equal(ui.saves, options.valid === false ? 0 : 1);
    assert.equal(ui.button('Save & continue').props.disabled, false);
  }
});

test('duplicate save events are ignored until the first save settles', async () => {
  let resolve;
  const ui = harness(editorFile, props, { save: () => new Promise(done => { resolve = done; }) });
  const save = ui.button('Save changes');
  save.props.onClick(); save.props.onClick(); ui.render();
  assert.equal(ui.saves, 1);
  assert.equal(ui.button('Saving…').props.disabled, true);
  resolve(true); await new Promise(done => setImmediate(done)); ui.render();
  assert.equal(ui.button('Save changes').props.disabled, false);
});

test('uploads lock save and view controls and retain a navigation warning', () => {
  const ui = harness(editorFile, { ...props, uploadBusy: true });
  assert.equal(ui.button('Save changes').props.disabled, true);
  assert.equal(ui.button('Preview').props.disabled, true);
  assert.ok(ui.listeners.has('beforeunload'));
  ui.button('Save changes').props.onClick(); assert.equal(ui.saves, 0);
  ui.update({ uploadBusy: false }); assert.equal(ui.listeners.has('beforeunload'), false);
});

test('preview keeps the identity editor mounted and excludes media awaiting review', async () => {
  const ui = harness(editorFile, { ...props, draftIdentity: { stageName: 'New name', city: 'Las Vegas' } });
  await ui.click('Preview');
  const formArea = ui.nodes().find(node => node.type === 'fieldset');
  assert.equal(formArea.props.hidden, true);
  assert.ok(ui.nodes().some(node => node.type === 'IdentityForm'));
  const carousel = ui.nodes().find(node => node.type === 'Carousel');
  assert.deepEqual(Array.from(carousel.props.photos, p => p.id), ['approved']);
  assert.equal(carousel.props.stageName, 'New name');
  assert.equal(ui.saves, 0);
  await ui.click('Back to editing');
  assert.equal(ui.nodes().find(node => node.type === 'fieldset').props.hidden, false);
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


test('editing details clears a previous saved confirmation', async () => {
  const ui = harness(editorFile, props);
  await ui.click('Save changes');
  assert.ok(ui.nodes().some(n => n.props?.role === 'status' && n.props.children === 'Changes saved.'));
  ui.update({ draftIdentity: { stageName: 'A new name', city: 'Las Vegas' } });
  assert.ok(!ui.nodes().some(n => n.props?.role === 'status' && n.props.children === 'Changes saved.'));
  assert.ok(ui.listeners.has('beforeunload'));
});
