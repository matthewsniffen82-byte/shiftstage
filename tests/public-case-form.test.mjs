import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import { SAFETY_REASONS } from '../src/lib/dancr/public-case-intake.ts';
function formFixture() {
  let selected='';const submissions=[];const exports={};
  const dependencies={react:{useState:()=>[selected,value=>{selected=value;}],useRef:()=>({current:null})},'react/jsx-runtime':jsx,'./public-case-form.css':{},'@/src/lib/dancr/public-case-intake':{SAFETY_REASONS}};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../app/components/SafetyReportForm.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,FormData:class{constructor(values){this.values=values;}get(key){return this.values[key]??null;}},require:name=>{assert.ok(name in dependencies,name);return dependencies[name];}});
  const render=saving=>exports.default({onSubmit:details=>submissions.push(details),saving,hasTarget:true});
  return {render,submissions};
}
function nodes(node) { if(!node||typeof node!=='object')return [];return [node,...[node.props?.children].flat(Infinity).flatMap(nodes)]; }
test('choosing a category never submits a report; only explicit submission sends the reviewed fields',()=>{
  const f=formFixture();const first=f.render(false);
  nodes(first).find(n=>n.type==='select').props.onChange({target:{value:SAFETY_REASONS[0]}});
  assert.equal(f.submissions.length,0);
  const reviewed=f.render(false);const fields=nodes(reviewed).filter(n=>n.props?.name);
  for(const name of ['contactEmail','authority','signature','requestedAction','goodFaith']) assert.equal(fields.find(n=>n.props.name===name).props.required,true,name);
  reviewed.props.onSubmit({preventDefault(){},currentTarget:{signature:'Synthetic name',authority:'Person depicted',requestedAction:'Remove',goodFaith:'on',contactEmail:'synthetic@example.invalid'}});
  assert.equal(f.submissions.length,1);assert.equal(f.submissions[0].signature,'Synthetic name');assert.equal(f.submissions[0].goodFaith,true);
  assert.equal(nodes(reviewed).filter(n=>n.type==='button'&&n.props.type==='submit').length,1);
});
test('a saving form cannot dispatch another request and never asks for file uploads',()=>{
  const f=formFixture();const busy=f.render(true);busy.props.onSubmit({preventDefault(){}});
  assert.equal(f.submissions.length,0);assert.equal(nodes(busy).find(n=>n.type==='fieldset').props.disabled,true);
  assert.equal(nodes(busy).some(n=>n.type==='input'&&n.props.type==='file'),false);
});
