import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync("public/profile-photo-crop.js", "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ local = false, file, dimensions = [900, 1200] } = {}) {
  const nodes = new Map(), viewport = new EventTarget();
  viewport.height = 500;
  let decode, failDecode;
  const outputs = [], images = [], urls = [], revoked = [], timers = new Set();
  const originalFile = file || new File(['fixture'], 'photo.jpg', { type: 'image/jpeg' });
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, Object.assign(new EventTarget(), {
      hidden: true, disabled: true, focusCalls: 0, focus() { this.focusCalls++; }, setPointerCapture() {},
      attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, append() {},
      getBoundingClientRect: () => ({ width: 250, height: selector === "[data-crop-header]" ? 80 : 150 }),
      getContext: () => ({ drawImage() {} }),
    }));
    return nodes.get(selector);
  };
  const dialog = Object.assign(new EventTarget(), {
    open: false, openings: 0, removed: false, clientWidth: 334,
    style: { setProperty() {} }, setAttribute() {}, querySelector: node,
    showModal() { this.open = true; this.openings++; }, close() { this.open = false; }, remove() { this.removed = true; },
  });
  Object.defineProperty(dialog, 'innerHTML', { set(markup) {
    this.markup = markup;
    node('h2').textContent = markup.match(/<h2\b[^>]*>([^<]+)<\/h2>/)[1];
    for (const match of markup.matchAll(/<button([^>]+)>([^<]+)<\/button>/g)) {
      const control = node(`[${match[1].match(/data-crop-[\w-]+/)[0]}]`);
      Object.assign(control, { textContent: match[2], hidden: /\bhidden\b/.test(match[1]), disabled: /\bdisabled\b/.test(match[1]) });
    }
  } });
  const window = Object.assign(new EventTarget(), { innerHeight: 700, visualViewport: viewport });
  vm.runInNewContext(source, {
    window, AbortController, DOMException, Error, File,
    URL: local ? { createObjectURL: value => { urls.push(value); return 'blob:local-photo'; }, revokeObjectURL: url => revoked.push(url) } : undefined,
    setTimeout: fn => { timers.add(fn); return fn; }, clearTimeout: fn => timers.delete(fn),
    Image: class {
      naturalWidth = dimensions[0]; naturalHeight = dimensions[1];
      constructor() { images.push(this); }
      decode() { return new Promise((resolve, reject) => { decode = resolve; failDecode = reject; }); }
    },
    document: { activeElement: null, createElement: tag => tag === 'canvas' ? {
      getContext: () => ({ drawImage(...args) { outputs.push(args); } }),
      toBlob(callback) { callback(new Blob(['cropped'], { type: 'image/jpeg' })); },
    } : dialog, body: { append() {} } },
    getComputedStyle: () => ({ maxHeight: "676px", paddingTop: "18px", paddingBottom: "18px", paddingLeft: "18px", paddingRight: "18px", borderTopWidth: "1px", borderBottomWidth: "1px", marginBottom: "12px" }),
  });
  const controller = new AbortController();
  return { dialog, node, viewport, controller, outputs, originalFile, images, urls, revoked, timers,
    decode: () => decode(),
    failDecode: () => failDecode(new Error('Unsupported image format')),
    start: (prepare, options = {}) => window.DancrPhotoCrop.crop(originalFile, { aspectRatio: .75, prepare, signal: controller.signal, ...options }),
  };
}

for (const type of ['image/jpeg', 'image/heic', 'image/heif', 'image/heic-sequence']) {
  test(`large new ${type} photos open locally without sending the original to the preview API`, async () => {
    const file = new File([new Uint8Array(6 * 1024 * 1024)], 'phone-photo.heic', { type });
    const f = fixture({ local: true, file });
    let requests = 0;
    const result = f.start(async () => { requests++; throw new Error('Original exceeds function limit'); });
    await tick();
    assert.equal(f.images[0].src, 'blob:local-photo');
    f.decode(); await tick();
    assert.equal(requests, 0);
    assert.equal(f.dialog.open, true);
    assert.equal(f.node('[data-crop-frame]').hidden, false);
    assert.deepEqual(f.revoked, ['blob:local-photo']);
    assert.equal(f.outputs.length, 0, 'nothing is encoded or confirmed before Use photo');
    f.node('[data-crop-confirm]').dispatchEvent(new Event('click'));
    const cropped = await result;
    assert.equal(cropped.type, 'image/jpeg');
    assert.equal(f.images[0].src, '');
    assert.equal(f.timers.size, 0);
  });
}

test('an unreadable local format retains server conversion when the request fits', async () => {
  const f = fixture({ local: true });
  let requests = 0;
  const result = f.start(async () => { requests++; return 'data:image/jpeg;base64,converted'; });
  await tick(); f.failDecode(); await tick();
  assert.equal(requests, 1);
  assert.equal(f.images[0].src, '');
  assert.equal(f.images[1].src, 'data:image/jpeg;base64,converted');
  assert.deepEqual(f.revoked, ['blob:local-photo']);
  f.decode(); await tick();
  assert.equal(f.dialog.open, true);
  f.node('[data-crop-cancel]').dispatchEvent(new Event('click')); await result;
  assert.equal(f.timers.size, 0);
});

test('saved photos still use their authorized prepared source', async () => {
  const f = fixture({ local: true });
  let requests = 0;
  const result = f.start(async () => { requests++; return 'data:image/jpeg;base64,saved'; }, { editingSavedPhoto: true });
  await tick(); f.decode(); await tick();
  assert.equal(requests, 1);
  assert.equal(f.urls.length, 0);
  assert.equal(f.images[0].src, 'data:image/jpeg;base64,saved');
  f.node('[data-crop-cancel]').dispatchEvent(new Event('click')); await result;
});

test('canceling native decode releases its object URL without a late preview or fallback upload', async () => {
  const f = fixture({ local: true });
  let requests = 0;
  const result = f.start(async () => { requests++; return 'data:image/jpeg;base64,fallback'; });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await tick(); f.controller.abort(); await rejected; await tick();
  assert.equal(requests, 0);
  assert.equal(f.images[0].src, '');
  assert.deepEqual(f.revoked, ['blob:local-photo']);
  assert.equal(f.timers.size, 0);
  f.decode(); await tick();
  assert.equal(f.dialog.openings, 0);
});

test('a stalled large image offers an actionable retry without repeating an oversized server request', async () => {
  const f = fixture({ local: true, file: new File([new Uint8Array(6 * 1024 * 1024)], 'phone.heic', { type: 'image/heic' }) });
  let requests = 0;
  const result = f.start(async () => { requests++; throw new Error('Must not send oversized originals'); });
  await tick(); [...f.timers][0](); await tick();
  assert.equal(requests, 0);
  assert.match(f.node('[data-crop-status]').textContent, /Save it as a JPEG or choose another photo/);
  assert.equal(f.node('[data-crop-confirm]').hidden, true);
  assert.deepEqual(f.revoked, ['blob:local-photo']);
  f.node('[data-crop-retry]').dispatchEvent(new Event('click'));
  await tick(); f.decode(); await tick();
  assert.equal(f.node('[data-crop-confirm]').disabled, false);
  f.node('[data-crop-cancel]').dispatchEvent(new Event('click')); await result;
  assert.equal(requests, 0);
  assert.equal(f.timers.size, 0);
});

test('local previews retain the input dimension limits and never confirm an oversized image', async () => {
  const f = fixture({ local: true, dimensions: [12000, 10000] });
  const result = f.start(async () => { throw new Error('Must not upload'); });
  await tick(); f.decode(); await tick();
  assert.match(f.node('[data-crop-status]').textContent, /64 megapixels/);
  assert.equal(f.images[0].src, '');
  assert.equal(f.node('[data-crop-confirm]').hidden, true);
  f.node('[data-crop-cancel]').dispatchEvent(new Event('click')); await result;
});

test('avatar crop returns normalized square coordinates without uploading or encoding new image bytes', async () => {
  const f = fixture(); let selected;
  const result = f.start(async () => 'data:image/jpeg;base64,fixture', { aspectRatio: 1, onCrop: value => { selected = value; } });
  await tick(); f.decode(); await tick();
  f.node('[data-crop-confirm]').dispatchEvent(new Event('click'));
  await result;
  assert.deepEqual({ ...selected }, { x: 0, y: .125, width: 1, height: .75 });
  assert.equal(f.dialog.removed, true);
});

test("the editor first opens with a decoded photo and sizes it around the controls in the visible viewport", async () => {
  const f = fixture();
  let prepared;
  const result = f.start(() => new Promise(resolve => { prepared = resolve; }));
  assert.equal(f.dialog.openings, 0);
  prepared("data:image/jpeg;base64,fixture");
  await tick();
  assert.equal(f.dialog.openings, 0, "decoding must also finish before opening");
  f.decode(); await tick();
  assert.equal(f.dialog.openings, 1);
  assert.equal(f.node("[data-crop-confirm]").disabled, false);
  assert.equal(f.node("[data-crop-frame]").hidden, false);
  const canvas = f.node("canvas");
  assert.ok(canvas.height / 2 + 80 + 150 + 38 + 12 <= 476, "photo plus real controls must fit the viewport");
  f.viewport.height = 400;
  f.viewport.dispatchEvent(new Event("resize"));
  assert.ok(canvas.height / 2 + 80 + 150 + 38 + 12 <= 376, "browser chrome changes must resize the photo");
  f.node("[data-crop-cancel]").dispatchEvent(new Event("click"));
  assert.equal(await result, null);
  assert.equal(f.dialog.removed, true);
});

test("failed preparation opens retry feedback without showing unusable crop actions", async () => {
  const f = fixture();
  const result = f.start(async () => { throw new Error("Unable to prepare this photo."); });
  await tick();
  assert.equal(f.dialog.openings, 1);
  assert.equal(f.node("[data-crop-retry]").hidden, false);
  assert.equal(f.node("[data-crop-confirm]").hidden, true);
  assert.match(f.node("[data-crop-status]").textContent, /Unable to prepare/);
  f.node("[data-crop-cancel]").dispatchEvent(new Event("click"));
  assert.equal(await result, null);
});

test("canceling while the photo decodes never opens a late dialog", async () => {
  const f = fixture();
  const result = f.start(async () => "data:image/jpeg;base64,fixture");
  const rejected = assert.rejects(result, { name: "AbortError" });
  await tick();
  f.controller.abort();
  f.decode(); await rejected; await tick();
  assert.equal(f.dialog.openings, 0);
  assert.equal(f.dialog.removed, true);
});

test('picture uploads use the main-photo dialog and confirm the displayed crop without requiring an adjustment',async()=>{
  const f=fixture();
  const result=f.start(async()=> 'data:image/jpeg;base64,fixture',{
    batch:{position:2,total:5,onCancelBatch(){}},aspectRatio:9/16,
  });
  await tick();f.decode();await tick();
  assert.equal(f.node('h2').textContent,'Fit your photo to the card');
  assert.match(f.dialog.markup,/<h2 tabindex="-1" autofocus>/);
  assert.equal(f.node('h2').focusCalls,1,'opening the editor focuses its heading');
  assert.equal(f.node('canvas').focusCalls,0,'the crop preview is not automatically highlighted');
  assert.equal(f.node('[data-crop-confirm]').textContent,'Use photo');
  assert.equal(f.node('[data-crop-confirm]').disabled,false);
  assert.equal(f.node('[data-crop-cancel]').textContent,'Cancel');
  assert.equal(f.node('[data-crop-cancel]').attributes['aria-label'],'Cancel uploads');
  assert.doesNotMatch(f.dialog.markup,/data-crop-original/);
  assert.equal(f.node('[data-crop-status]').textContent,'Your photo is added to your profile only after you choose Use photo.');
  assert.equal(f.outputs.length,0,'opening the crop does not encode or confirm a photo');
  f.viewport.height=800;f.viewport.dispatchEvent(new Event('resize'));
  assert.ok(f.node('canvas').height/2>280,'the preview uses available space like the main-photo editor');
  f.node('[data-crop-confirm]').dispatchEvent(new Event('click'));
  const cropped=await result;
  assert.notEqual(cropped,f.originalFile);assert.equal(cropped.name,'photo-card.jpg');
  assert.equal(cropped.type,'image/jpeg');assert.equal(f.outputs.length,1);
  assert.deepEqual(f.outputs[0].slice(1,5),[112.5,0,675,1200]);
  assert.equal(f.dialog.removed,true);
});

test('closing the crop cancels the upload batch instead of skipping to the next photo',async()=>{
  const f=fixture();let canceled=0;
  const result=f.start(async()=> 'data:image/jpeg;base64,fixture',{batch:{position:1,total:2,onCancelBatch(){canceled++;}}});
  await tick();f.decode();await tick();
  f.node('[data-crop-cancel]').dispatchEvent(new Event('click'));
  assert.equal(await result,null);assert.equal(canceled,1);
});

test('Escape invokes batch cancellation and closes an active crop',async()=>{
  const f=fixture();let canceled=0;
  const result=f.start(async()=> 'data:image/jpeg;base64,fixture',{batch:{position:1,total:2,onCancelBatch(){canceled++;f.controller.abort();}}});
  const rejected=assert.rejects(result,{name:'AbortError'});
  await tick();f.decode();await tick();
  f.dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
  await rejected;assert.equal(canceled,1);assert.equal(f.dialog.removed,true);
});

test('Reset restores the crop and leaves Use photo available for the default framing',async()=>{
  const f=fixture();
  const result=f.start(async()=> 'data:image/jpeg;base64,fixture',{aspectRatio:1,batch:{position:1,total:1,onCancelBatch(){}}});
  await tick();f.decode();await tick();
  const reset=f.node('[data-crop-reset]'),range=f.node('input'),confirm=f.node('[data-crop-confirm]');
  assert.equal(reset.hidden,true);assert.equal(confirm.disabled,false);
  range.value='1.5';range.dispatchEvent(new Event('input'));
  assert.equal(reset.hidden,false);assert.equal(confirm.disabled,false);
  reset.dispatchEvent(new Event('click'));
  assert.equal(reset.hidden,true);assert.equal(range.value,'1');assert.equal(confirm.disabled,false);
  const pan=new Event('keydown',{cancelable:true});Object.defineProperty(pan,'key',{value:'ArrowLeft'});
  f.node('canvas').dispatchEvent(pan);
  assert.equal(reset.hidden,true,'horizontal input without source overflow does not change the crop');
  const up=new Event('keydown',{cancelable:true});Object.defineProperty(up,'key',{value:'ArrowUp'});
  f.node('canvas').dispatchEvent(up);
  assert.equal(reset.hidden,false);assert.equal(confirm.disabled,false);
  reset.dispatchEvent(new Event('click'));assert.equal(confirm.disabled,false);
  const down=new Event('pointerdown');Object.assign(down,{pointerId:1,clientX:100,clientY:100});
  const move=new Event('pointermove');Object.assign(move,{pointerId:1,clientX:100,clientY:120});
  f.node('canvas').dispatchEvent(down);f.node('canvas').dispatchEvent(move);
  assert.equal(reset.hidden,false,'dragging a photo with vertical overflow changes its crop');
  f.node('[data-crop-cancel]').dispatchEvent(new Event('click'));await result;
});
