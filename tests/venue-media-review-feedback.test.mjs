import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { mediaReview } from './helpers/media-review-label.mjs';
import { primeVideoPreviewFrame } from '../app/dashboard/dancer-profile-media-sync.ts';

const code = ts.transpileModule(readFileSync('app/dashboard/VenueMediaReviewPanel.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

// Exercise the component's real handlers with in-memory requests; no browser journeys.
function harness(kind = 'photo') {
  let rows = ['first', 'second'].map(id => ({ id, kind, dancerId: 'dancer-one', stageName: 'Star', version: '2026-10-22T00:00:00Z',
    previewUrl: '/private-preview', label: kind, processing: false, canApprove: true, reasons: [], aiSummary: 'AI checks passed' }));
  let cursor = 0, dirty = true, effects = [], tree, failure = false, finish, getResponse;
  const pending = new Promise(resolve => { finish = resolve; });
  const slots = [], calls = [], focused = [], scrolled = [], counts = [];
  const reads = [];
  let avatar = { url: '/approved-avatar.jpg', status: 'approved' };
  function response(url) {
    const params = new URL(url, 'https://example.test').searchParams;
    const selected = params.get('dancerId'), offset = Number(params.get('offset'));
    const dancers = [...new Set(rows.map(row => row.dancerId))].map(id => {
      const media = rows.filter(row => row.dancerId === id);
      return { id, stageName: media[0].stageName, count: media.length, photoCount: media.filter(row => row.kind === 'photo').length,
        videoCount: media.filter(row => row.kind === 'video').length, previewUrl: media[0].previewUrl };
    });
    const media = rows.filter(row => row.dancerId === selected);
    return { venueId: 'venue', count: rows.length, dancerCount: dancers.length, uploadCount: media.length,
      dancer: dancers.find(dancer => dancer.id === selected) || null, dancerAvatar: selected ? avatar : null,
      dancers: selected ? [] : dancers.slice(offset, offset + 12), items: media.slice(offset, offset + 12) };
  }
  const changed = (a, b) => !a || b.some((value, i) => !Object.is(value, a[i]));
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { value: initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useRef(initial) { return slots[cursor++] ||= { current: initial }; },
    useEffect(effect, deps) { const i = cursor++, previous = slots[i]; if (changed(previous?.deps, deps)) effects.push(() => {
      previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; }); },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, Error, require(name) {
    if (name === '@/src/lib/dancr/media-review-label') return mediaReview;
    if (name === './dancer-profile-media-sync') return {primeVideoPreviewFrame};
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === './dashboard-session') return { requestDashboardJson: async (_url, options) => {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body); calls.push(body); await pending;
        if (failure) throw new Error('Unable to save rejection. Try again.');
        rows = rows.filter(row => row.id !== body.id); return { ok: true };
      }
      reads.push(_url);
      if (getResponse) return getResponse(_url, options);
      return response(_url);
    } };
    return { default: name };
  } });
  const props = { venueId: 'venue', active: true, onCountChange: count => counts.push(count) };
  const nodes = (node = tree) => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))];
  function render(next) {
    if (next) { Object.assign(props, next); dirty = true; }
    for (let i = 0; dirty && i < 25; i++) {
      dirty = false; cursor = 0; effects = []; tree = exports.default(props);
      nodes().filter(node => node.type === 'input').forEach(node => {
        const id = node.props['aria-describedby'].split(' ')[0].replace('review-note-hint-', '');
        node.props.ref({ focus: () => focused.push(id), scrollIntoView: options => scrolled.push([id, options.block]) });
      });
      effects.forEach(effect => effect());
    }
    assert.equal(dirty, false);
  }
  const ui = {
    calls, focused, scrolled, counts, finish, render, reads,
    setRows(next) { rows = next; },
    setAvatar(next) { avatar = next; },
    get avatar() { return nodes().find(node => node.props?.className === 'venue-media-review-avatar'); },
    get rows() { return rows; },
    get dancerCards() { return nodes().filter(node => node.props?.className === 'venue-media-dancer-card'); },
    open(index = 0) { this.dancerCards[index].props.onClick(); render(); },
    back() { nodes().find(node => node.props?.className === 'venue-media-back').props.onClick(); render(); },
    next() { nodes().find(node => node.type === 'button' && node.props.children === 'Next').props.onClick(); render(); },
    respondWith(callback) { getResponse = callback; },
    get cards() { return nodes().filter(node => node.type === 'article'); },
    field(index = 0) { return nodes(this.cards[index]).find(node => node.type === 'input'); },
    form(index = 0) { return nodes(this.cards[index]).find(node => node.type === 'form'); },
    alerts(index = 0) { return nodes(this.cards[index]).filter(node => node.props?.role === 'alert'); },
    buttons(index = 0) { return nodes(this.cards[index]).filter(node => node.type === 'button'); },
    note(value, index = 0) { this.field(index).props.onChange({ target: { value } }); render(); },
    click(label = 'Reject', index = 0) { const button = this.buttons(index).find(node => node.props.children === label); assert.ok(button); assert.equal(button.props.disabled, false);
      if (button.props.type === 'submit') this.form(index).props.onSubmit({ preventDefault() {} });
      else button.props.onClick();
      render(); },
    fail(value) { failure = value; },
    async settle() { for (let i = 0; i < 3; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } },
  };
  render(); return ui;
}

async function ready(kind) {
  const ui = harness(kind); await ui.settle(); ui.open(); await ui.settle(); return ui;
}

test('photo: Reject hides the upload immediately, sends no reason and cannot be repeated while saving', async () => {
  const ui = await ready('photo');
  const reject = ui.buttons().find(button => button.props.children === 'Reject');
  assert.equal(ui.field(), undefined); assert.equal(ui.form(), undefined);
  ui.click('Reject'); reject.props.onClick();
  assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].notes, '');
  assert.equal(ui.calls[0].kind, 'photo'); assert.equal(ui.calls[0].decision, 'rejected');
  assert.equal(ui.cards.length, 1); assert.equal(ui.field(), undefined); assert.equal(ui.form(), undefined);
  assert.ok(ui.buttons().every(button => button.props.disabled));
  ui.render({ refreshKey: 'while-saving' }); await ui.settle();
  assert.equal(ui.cards.length, 1, 'a refresh cannot restore a rejection still being saved');
  ui.finish(); await ui.settle();
  assert.equal(ui.cards.length, 1); assert.equal(ui.counts.at(-1), 1);
  ui.click('Reject'); assert.equal(ui.cards.length, 0); await ui.settle();
  assert.equal(ui.dancerCards.length, 0); assert.equal(ui.counts.at(-1), 0);
});

test('photo: a failed rejection restores the card with an error and a one-tap retry', async () => {
  const ui = await ready('photo'); ui.fail(true); ui.click('Reject');
  assert.equal(ui.cards.length, 1);
  ui.finish(); await ui.settle();
  assert.equal(ui.cards.length, 2); assert.match(ui.alerts()[0].props.children, /Unable to save rejection/);
  assert.equal(ui.field(), undefined); assert.equal(ui.form(), undefined); assert.equal(ui.alerts(1).length, 0);
  ui.fail(false); ui.click('Reject'); assert.equal(ui.cards.length, 1); await ui.settle();
  assert.equal(ui.cards.length, 1); assert.equal(ui.calls.length, 2);
});

for (const kind of ['video']) {
  test(`${kind}: cards omit AI details and only open a reason field after Reject; Cancel makes no request`, async () => {
    const ui = await ready(kind);
    assert.equal(ui.field(), undefined); assert.equal(ui.form(), undefined);
    assert.doesNotMatch(JSON.stringify(ui.cards), /AI checks passed|AI findings|Review note|after their NFC tap/);
    ui.click(); assert.ok(ui.field()); assert.equal(ui.focused.at(-1), 'first');
    assert.equal(ui.field(1), undefined); assert.equal(ui.calls.length, 0);
    ui.note('Logo visible'); ui.click('Cancel');
    assert.equal(ui.field(), undefined); assert.equal(ui.calls.length, 0);
  });
  test(`${kind}: Reject with a missing or overly long reason focuses that card and shows an inline alert`, async () => {
    const ui = await ready(kind);
    ui.click('Reject', 1);
    for (const note of ['', '  ', 'This reason is lengthy']) {
      ui.note(note, 1); ui.click('Confirm rejection', 1);
      assert.match(ui.alerts(1)[0].props.children, /rejection reason.*1–3 words/);
      assert.equal(ui.field(1).props['aria-invalid'], true);
      assert.ok(ui.field(1).props['aria-describedby'].includes(ui.alerts(1)[0].props.id));
      assert.equal(ui.alerts(0).length, 0); assert.equal(ui.calls.length, 0);
      assert.equal(ui.focused.at(-1), 'second'); assert.deepEqual(ui.scrolled.at(-1), ['second', 'center']);
    }
  });
  test(`${kind}: a valid reason rejects once, removes only that upload and updates the count`, async () => {
    const ui = await ready(kind); ui.click(); ui.note('Logo visible');
    assert.equal(ui.alerts().length, 0); assert.equal(ui.field().props['aria-invalid'], undefined);
    const savedForm = ui.form();
    ui.click('Confirm rejection'); savedForm.props.onSubmit({ preventDefault() {} });
    assert.equal(ui.calls.length, 1); assert.equal(ui.calls[0].notes, 'Logo visible');
    assert.equal(ui.calls[0].kind, kind); assert.equal(ui.calls[0].decision, 'rejected');
    assert.ok(ui.buttons().some(node => node.props.children === 'Rejecting…' && node.props.disabled));
    ui.finish(); await ui.settle();
    assert.equal(ui.cards.length, 1); assert.equal(ui.counts.at(-1), 1);
  });
}

test('a failed save keeps the reason and displays the server error on the affected card, allowing retry', async () => {
  const ui = await ready('video'); ui.click(); ui.note('Unclear video'); ui.fail(true); ui.click('Confirm rejection');
  ui.finish(); await ui.settle();
  assert.match(ui.alerts()[0].props.children, /Unable to save rejection/);
  assert.equal(ui.field().props.value, 'Unclear video'); assert.equal(ui.cards.length, 2);
  assert.equal(ui.alerts(1).length, 0);
  ui.fail(false); ui.click('Confirm rejection'); await ui.settle();
  assert.equal(ui.cards.length, 1); assert.equal(ui.calls.length, 2);
});

test('approval does not require a rejection reason or send a cancelled rejection draft', async () => {
  const ui = await ready('video'); ui.click(); ui.note('Logo visible'); ui.click('Cancel'); ui.click('Approve');
  assert.equal(ui.field(), undefined);
  assert.equal(ui.calls[0].decision, 'approved'); assert.equal(ui.calls[0].notes, '');
  ui.finish(); await ui.settle(); assert.equal(ui.cards.length, 1);
});

test('automatic media review refresh retains cards and notes while waiting or offline, then publishes a completed result', async () => {
  const ui = await ready('video'); ui.click(); ui.note('Logo visible');
  let finish;
  ui.respondWith(() => new Promise(resolve => { finish = resolve; }));
  ui.render({ refreshKey: 'timer-1' });
  assert.equal(ui.cards.length, 2); assert.equal(ui.field().props.value, 'Logo visible');
  finish({ venueId: 'venue', items: [{ id: 'first', kind: 'video', stageName: 'Updated', label: 'Video', previewUrl: '/preview', reasons: [], canApprove: true }], count: 1, uploadCount: 1, dancerCount: 1 });
  await ui.settle(); assert.equal(ui.cards.length, 1); assert.equal(ui.field().props.value, 'Logo visible');
  ui.respondWith(async () => { throw new Error('Temporarily offline'); });
  ui.render({ refreshKey: 'timer-2' }); await ui.settle();
  assert.equal(ui.cards.length, 1); assert.equal(ui.field().props.value, 'Logo visible');
  ui.respondWith(async () => ({ venueId: 'venue', items: [], count: 0 }));
  ui.render({ refreshKey: 'timer-3' }); await ui.settle();
  assert.equal(ui.cards.length, 0); assert.equal(ui.counts.at(-1), 0);
});

test('count-only updates keep loaded media cards ready when reopening the tab', async () => {
  const ui = await ready();
  ui.respondWith(async () => ({ venueId: 'venue', count: 2, items: [] }));
  ui.render({ active: false }); await ui.settle();
  ui.respondWith(() => new Promise(() => {})); ui.render({ active: true });
  assert.equal(ui.cards.length, 2);
});

for (const status of [401, 403, 'changed club']) {
  test(`media reviews clear protected cards on ${status}`, async () => {
    const ui = await ready();
    assert.ok(ui.avatar);
    ui.respondWith(async () => {
      if (typeof status === 'number') throw Object.assign(new Error('Access removed'), { status });
      return { venueId: 'different', items: [], count: 0 };
    });
    ui.render({ refreshKey: 'revoked' }); await ui.settle(); assert.equal(ui.cards.length, 0); assert.equal(ui.avatar, undefined);
  });
}

test('avatar appears only inside the selected dancer approval view and refreshes from pending to approved', async () => {
  const ui=harness();await ui.settle();assert.equal(ui.avatar,undefined);
  ui.setAvatar({url:'/pending-face-crop.jpg',status:'pending'});ui.open();await ui.settle();
  assert.equal(ui.avatar.props.children[0].props.src,'/pending-face-crop.jpg');
  assert.equal(ui.avatar.props.children[0].props.alt,'Star avatar');
  assert.match(JSON.stringify(ui.avatar),/Pending approval/);assert.doesNotMatch(JSON.stringify(ui.avatar),/button/);
  assert.equal(ui.cards.length,2);assert.equal(ui.counts.at(-1),2,'avatar does not add a review or count');
  ui.setAvatar({url:'/new-approved-face.jpg',status:'approved'});ui.render({refreshKey:'approved'});await ui.settle();
  assert.equal(ui.avatar.props.children[0].props.src,'/new-approved-face.jpg');assert.match(JSON.stringify(ui.avatar),/Approved/);
  ui.setAvatar(null);ui.render({refreshKey:'no-avatar'});await ui.settle();assert.equal(ui.avatar,undefined);
});

test('switching dancers or clubs never carries the previous avatar into the new view',async()=>{
  const ui=await ready();ui.setRows([...ui.rows,{...ui.rows[0],id:'other',dancerId:'dancer-two'}]);
  ui.back();assert.equal(ui.avatar,undefined);await ui.settle();
  let finish;ui.respondWith(()=>new Promise(resolve=>{finish=resolve;}));
  ui.open(1);assert.equal(ui.avatar,undefined);
  const resolveDancer=finish;ui.back();resolveDancer({venueId:'venue',dancer:{id:'dancer-two'},dancerAvatar:{url:'/other.jpg',status:'pending'},uploadCount:1,count:3});
  await ui.settle();assert.equal(ui.avatar,undefined,'a stale request must not restore the other avatar');
  const fresh=await ready();fresh.respondWith(()=>new Promise(()=>{}));fresh.render({venueId:'changed'});
  assert.equal(fresh.avatar,undefined,'hide the old club avatar before the next request finishes');
});

test('dancer cards open only that dancer’s new media, put labels above previews and disappear after the last decision', async () => {
  const ui=harness();await ui.settle();
  ui.setRows([
    { ...ui.rows[0], label:'Main photo/avatar' },
    { ...ui.rows[1], kind:'video',label:'Video',caption:'New clip' },
    { ...ui.rows[0], id:'other', dancerId:'dancer-two' },
  ]);
  ui.render({refreshKey:'mixed'});await ui.settle();
  assert.equal(ui.dancerCards.length,2);assert.equal(ui.cards.length,0);
  assert.equal(ui.dancerCards[0].props['aria-label'],'Review 2 new uploads from Star');
  ui.open();await ui.settle();assert.equal(ui.cards.length,2);
  for (const [index, label] of ['Main photo/avatar', 'Video'].entries()) {
    const [heading, preview] = ui.cards[index].props.children;
    assert.equal(heading.type, 'h3');assert.equal(heading.props.children, label);
    assert.equal(preview.props.className, 'venue-media-review-preview');
    assert.doesNotMatch(JSON.stringify(preview), /venue-media-type/);
  }
  assert.equal(ui.cards[0].props.children[1].props.children.props.href, '/private-preview');
  assert.match(JSON.stringify(ui.cards[1]), /video.*controls.*New clip/);
  ui.click('Approve');ui.finish();await ui.settle();
  assert.equal(ui.cards.length,1);assert.equal(ui.dancerCards.length,0);
  ui.click('Reject');ui.note('Logo visible');ui.click('Confirm rejection');await ui.settle();
  assert.equal(ui.cards.length,0);assert.equal(ui.dancerCards.length,1);
  assert.equal(ui.calls.length,2);assert.equal(ui.counts.at(-1),1);
  ui.open();await ui.settle();assert.match(ui.reads.at(-1),/dancerId=dancer-two/);
  ui.back();await ui.settle();assert.equal(ui.dancerCards.length,1);
});

test('video review tiles show posters, prime a first frame when missing, and keep native playback controls',async()=>{
  const ui=await ready('video');
  ui.setRows(ui.rows.map((row,index)=>({...row,posterUrl:index===0?'/private-poster.webp':'',caption:index===0?null:'New performance'})));
  ui.render({refreshKey:'posters'});await ui.settle();
  const withPoster=ui.cards[0].props.children[1].props.children;
  assert.equal(withPoster.type,'video');assert.equal(withPoster.props.poster,'/private-poster.webp');
  assert.equal(withPoster.props.controls,true);assert.equal(withPoster.props.playsInline,true);
  assert.equal(withPoster.props.autoPlay,undefined);assert.equal(withPoster.props.muted,undefined);
  assert.doesNotMatch(JSON.stringify(ui.cards[0]),/Caption:/);
  const first={duration:10,currentTime:0};withPoster.props.onLoadedMetadata({currentTarget:first});
  assert.equal(first.currentTime,0);
  const withoutPoster=ui.cards[1].props.children[1].props.children;
  assert.equal(withoutPoster.props.poster,undefined);
  withoutPoster.props.onLoadedMetadata({currentTarget:first});assert.ok(first.currentTime>0);
  first.currentTime=4;withoutPoster.props.onLoadedMetadata({currentTarget:first});assert.equal(first.currentTime,4);
  assert.match(JSON.stringify(ui.cards[1]),/New performance/);
});

test('reviewing the last item on a later media page loads the previous page instead of dropping remaining uploads',async()=>{
  const ui=harness();await ui.settle();
  const sample=ui.rows[0];ui.setRows(Array.from({length:13},(_,i)=>({...sample,id:`upload-${i}`})));
  ui.render({refreshKey:'many'});await ui.settle();ui.open();await ui.settle();
  assert.equal(ui.cards.length,12);ui.next();await ui.settle();assert.equal(ui.cards.length,1);
  ui.click('Approve');ui.finish();await ui.settle();
  assert.equal(ui.cards.length,12);assert.equal(ui.dancerCards.length,0);
  assert.match(ui.reads.at(-1),/offset=0&dancerId=dancer-one/);
});

test('a late response after backing out cannot replace the dancer grid',async()=>{
  const ui=harness();await ui.settle();let finish;
  ui.respondWith(url=>url.includes('dancerId=')?new Promise(resolve=>{finish=resolve;}):Promise.resolve({venueId:'venue',count:0,dancerCount:0,dancers:[]}));
  ui.open();ui.back();await ui.settle();
  finish({venueId:'venue',count:1,uploadCount:1,items:ui.rows.slice(0,1)});await ui.settle();
  assert.equal(ui.cards.length,0);assert.equal(ui.dancerCards.length,0);assert.equal(ui.counts.at(-1),0);
});
