import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {VISIBILITY_OPTIONS} from '../src/lib/dancr/visibility-mode.ts';

const require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../app/nfc/[token]/NfcTapClient.tsx',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
}).outputText;
const tag={ok:true,tag:{id:'tag',type:'dressing_room',label:'Dancer check-in'},venue:{id:'club',name:'Synthetic club',slug:'synthetic',city:'Vegas',state:'NV'},deals:[]};
function elements(tree,type){
  if(!tree||typeof tree!=='object')return [];
  if(Array.isArray(tree))return tree.flatMap(x=>elements(x,type));
  return [...(tree.type===type?[tree]:[]),...elements(tree.props?.children,type)];
}
function harness(response){
  const slots=[],effects=[],cleanups=[],calls=[],redirects=[],exports={};
  let cursor=0,dirty=true,tree,token='synthetic-tag';
  const memo=(factory,deps)=>{
    const i=cursor++,prior=slots[i];
    if(!prior||deps.some((v,j)=>v!==prior.deps[j]))slots[i]={deps,value:factory()};
    return slots[i].value;
  };
  const hooks={...React,
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;dirty=true;}];},
    useRef(initial){return slots[cursor++]||=({current:initial});},
    useMemo:memo,useCallback:(fn,deps)=>memo(()=>fn,deps),
    useEffect(effect,deps){const i=cursor++,prior=slots[i];if(!prior||deps.some((v,j)=>v!==prior[j])){slots[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=effect();});}},
  };
  vm.runInNewContext(code,{
    exports,Error,AbortController,crypto:{randomUUID:()=> 'synthetic-session'},
    window:{localStorage:{getItem:()=>null},location:{replace:path=>redirects.push(path)},setTimeout:fn=>{redirects.push(fn);return 1;},clearTimeout(){}},
    async fetch(path,options){calls.push({path,options});return options.method==='POST'?response:{ok:true,json:async()=>tag};},
    require(name){
      if(name==='react')return hooks;
      if(name==='react/jsx-runtime')return require(name);
      if(name==='next/link')return {default:props=>React.createElement('a',props)};
      if(name.endsWith('/NfcIcon'))return {default:()=>null};
      if(name.endsWith('/visibility-mode'))return {VISIBILITY_OPTIONS};
      if(name.endsWith('/browser-session'))return {readBrowserAuthSession:()=>({account:{role:'dancer'},accessToken:'synthetic'}),persistRefreshedBrowserAuthSession(){}};
      if(name.endsWith('/deal-copy'))return {customerFacingDealDescription:()=>'',customerFacingDealTerms:()=>''};
      if(name.endsWith('/external-ranking-progress'))return {externalTapRankingMessage:()=>''};
      if(name.endsWith('/club-deal-transportation')||name.endsWith('.css'))return {};
      throw Error(name);
    },
  });
  function render(){if(!dirty)return;dirty=false;cursor=0;tree=exports.NfcTapClient({token});effects.splice(0).forEach(f=>f());}
  render();
  return {
    calls,redirects,
    async settle(){for(let i=0;i<4;i++){await new Promise(r=>setImmediate(r));render();}},
    async submit(){render();elements(tree,'input').find(x=>x.props.value==='both').props.onChange();render();await elements(tree,'button').find(x=>x.props.className==='nfc-primary').props.onClick();render();},
    get html(){render();return renderToStaticMarkup(tree);},
    changeToken(){token='second-tag';dirty=true;render();},
    unmount(){cleanups.forEach(f=>f?.());},
  };
}

for(const [code,label,anchor] of [
  ['DANCER_PROFILE_SETUP_REQUIRED','Complete profile','dancer-profile-media'],
  ['DANCER_AGE_VERIFICATION_REQUIRED','Verify 18+','dancer-onboarding-age'],
])test(`${code} offers the correct dashboard action without a misleading retry`,async()=>{
  const h=harness({ok:false,json:async()=>({ok:false,code,error:'Complete the required setup step.'})});
  await h.settle();await h.submit();
  assert.match(h.html,new RegExp(`href="/dashboard/dancer#${anchor}"`));assert.ok(h.html.includes(label));
  assert.doesNotMatch(h.html,/Try again|stay at this sticker|Profile activation was not completed|class="nfc-status"/);
  assert.match(h.html,/role="alert">Complete the required setup step/);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);
  h.changeToken();await h.settle();assert.doesNotMatch(h.html,/Complete the required setup step|Complete profile|Verify 18\+/);
  assert.match(h.html,/Confirm my choice/);h.unmount();
});

test('temporary failures retain retry and a dashboard exit without claiming failed activation',async()=>{
  const h=harness({ok:false,json:async()=>({ok:false,code:'UNAVAILABLE',error:'Unable to confirm this tap.'})});
  await h.settle();await h.submit();assert.match(h.html,/Try again/);assert.match(h.html,/Back to dancer dashboard/);
  assert.match(h.html,/Your check-in was not confirmed/);assert.doesNotMatch(h.html,/Profile activation was not completed/);h.unmount();
});

test('club approval with pending media reports a saved tap without activating or redirecting',async()=>{
  const h=harness({ok:true,json:async()=>({ok:true,affiliation:{enrollmentStatus:'pending',clubApprovalStatus:'approved',shiftCheckedIn:false},message:'Your tap is saved. You are not checked in yet.'})});
  await h.settle();await h.submit();assert.match(h.html,/Your tap is saved/);assert.match(h.html,/not checked in yet/);
  assert.doesNotMatch(h.html,/Working Now|Opening your dancer dashboard|Try again|nfc=complete/);
  assert.equal(h.redirects.length,0);assert.equal(h.calls.length,2);h.unmount();
});
