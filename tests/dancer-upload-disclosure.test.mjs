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
