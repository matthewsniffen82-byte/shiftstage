import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';

const require = createRequire(import.meta.url);
const code = ts.transpileModule(readFileSync('app/dashboard/DancerUploadDisclosure.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function fixture(picker = null) {
  const exports = {}, refs = [], effects = [], dependencies = [];
  let cursor = 0;
  vm.runInNewContext(code, { exports, require: name => name === 'react' ? {
    ...React, useContext: () => picker,
    useRef: initial => refs[cursor++] ||= { current: initial },
    useEffect: (fn, deps) => {
      const i=cursor++, old=dependencies[i];
      if (!old || deps.some((d, j) => !Object.is(d, old[j]))) { dependencies[i]=deps; effects.push(fn); }
    },
  } : name === './DancerProfileUploadContext' ? { DancerProfileUploadContext: React.createContext(null) } : require(name) });
  return { draw(props) { cursor=0; const node=exports.default({label:'Add photos',kind:'photos',children:'Upload form',...props});
    if(node.props.ref) node.props.ref.current ||= {open:false};
    effects.splice(0).forEach(fn=>fn());return node;
  }, refs };
}

test('managed photo and video forms remain mounted when the chooser changes or closes', () => {
  const picker={active:'photos',open() {}}, photo=fixture(picker), video=fixture(picker);
  assert.equal(photo.draw().props.hidden,false);
  assert.equal(video.draw({kind:'videos'}).props.hidden,true);
  picker.active='videos';
  assert.equal(photo.draw().props.hidden,true);
  assert.equal(video.draw({kind:'videos'}).props.hidden,false);
  picker.active=null;
  for(const ui of [photo,video]) { const node=ui.draw();assert.equal(node.props.hidden,true);assert.equal(node.props.children,'Upload form'); }
});

test('replacing a video reopens the managed video chooser without repeated opens on every render', () => {
  const calls=[], picker={active:null,open:kind=>calls.push(kind)}, ui=fixture(picker);
  ui.draw({kind:'videos'});ui.draw({kind:'videos',openRequested:true});ui.draw({kind:'videos',openRequested:true});
  assert.deepEqual(calls,['videos']);
});

test('returning editors retain native upload disclosures and replacement requests open them', () => {
  const ui=fixture();const closed=ui.draw();assert.equal(closed.type,'details');assert.equal(closed.props.open,false);
  ui.draw({openRequested:true});assert.equal(closed.props.ref.current.open,true);
  assert.equal(fixture().draw({defaultOpen:true}).props.open,true);
});

test('a missing main photo opens the photo chooser once and still allows switching to videos', () => {
  const calls = [], picker = { active: null };
  picker.open = kind => { calls.push(kind); picker.active = kind; };
  const ui = fixture(picker);
  ui.draw({ openRequested: false });
  ui.draw({ openRequested: true });
  assert.equal(ui.draw({ openRequested: true }).props.hidden, false);
  picker.active = 'videos';
  assert.equal(ui.draw({ openRequested: true }).props.hidden, true);
  assert.deepEqual(calls, ['photos']);
});

const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
function sheetFixture(overrides = {}) {
  const exports = {}, refs = [], effects = [], deps = [], frames = new Map(), calls = [];
  let cursor = 0, frameId = 0;
  class Input { constructor(type, count = 0) { this.type = type; this.files = { length: count }; } }
  const props = { kind: 'photos', active: 'photos', busy: false, requested: false, children: React.createElement('input', { type: 'file' }), ...overrides };
  vm.runInNewContext(code, { exports, HTMLInputElement: Input, window: {
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame(id) { frames.delete(id); },
  }, require: name => name === 'react' ? { ...React,
    useRef: initial => refs[cursor++] ||= { current: initial },
    useEffect(fn, next) { const i=cursor++, old=deps[i]; if (!old || next.some((d,j)=>!Object.is(d,old.values[j]))) effects.push(()=>{old?.cleanup?.();deps[i]={values:next,cleanup:fn()};}); },
  } : name === './DancerProfileUploadContext' ? {} : require(name) });
  const element = { open: false, querySelector: () => ({focus: () => calls.push('focus-heading')}), showModal() { this.open = true; calls.push('show'); }, close() { this.open = false; calls.push('close'); } };
  function draw() {
    cursor = 0;
    const nodes = walk(exports.DancerMediaSourceSheet(props));
    nodes.find(n => n.type === 'dialog').props.ref.current = element;
    effects.splice(0).forEach(fn => fn());
    return nodes;
  }
  return { props, calls, element, Input, draw, flush: () => { const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn()); } };
}

test('library uploaders use a bottom sheet while their file inputs remain mounted', () => {
  for (const kind of ['photos', 'videos']) {
    const picker={active:kind,libraryEditor:true,open() {},busy:true};
    const node=fixture(picker).draw({kind});
    assert.equal(node.type.name,'DancerMediaSourceSheet');
    assert.equal(node.props.children,'Upload form');
    const f=sheetFixture({kind,active:kind});
    const first=f.draw();
    assert.equal(first.find(n=>n.props.className==='dancer-media-source-trigger').props.hidden,true);
    first.find(n=>n.props.className==='dancer-media-source-trigger').props.onClick();
    assert.equal(f.element.open,true);
    first.find(n=>n.props.className==='dancer-media-source-close').props.onClick();
    assert.equal(f.element.open,false);
    assert.equal(f.draw().filter(n=>n.type==='input').length,1);
    f.props.busy=true;
    assert.equal(f.draw().find(n=>n.props.className==='dancer-media-source-trigger').props.disabled,true);
  }
});

test('file selection dismisses the sheet before crop review, but cancellation and consent changes do not', () => {
  const f=sheetFixture(), nodes=f.draw(), sheet=nodes.find(n=>n.type==='dialog');
  nodes.find(n=>n.props.className==='dancer-media-source-trigger').props.onClick();
  for (const input of [new f.Input('file'),new f.Input('checkbox',1)]) {
    sheet.props.onChangeCapture({target:input});assert.equal(f.element.open,true);
  }
  sheet.props.onChangeCapture({target:new f.Input('file',2)});
  assert.equal(f.element.open,false);
  let stopped=false;
  sheet.props.onCancel({stopPropagation(){stopped=true;}});assert.equal(stopped,true);
});

test('replacement sheets open after the editor, only once, and close when leaving the editor', () => {
  const f=sheetFixture({kind:'videos',active:null,requested:true});f.draw();
  assert.equal(f.element.open,false);
  f.props.active='videos';f.draw();assert.equal(f.element.open,false);
  f.flush();assert.equal(f.element.open,true);
  f.element.close();f.draw();f.flush();assert.equal(f.element.open,false);
  assert.equal(f.calls.filter(c=>c==='show').length,1);
  f.element.showModal();f.props.active=null;f.draw();assert.equal(f.element.open,false);
});
