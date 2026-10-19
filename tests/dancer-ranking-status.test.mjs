import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
import * as progress from '../src/lib/dancr/external-ranking-progress.ts';
import * as scoring from '../src/lib/dancr/venue-dancer-scores.ts';

const require = createRequire(import.meta.url);
const status = (external = 2, overall = 1, eligible = true) => ({eligible,score:overall,
  scorecard:{scores:{externalTime:{value:external},overall:{value:overall}}}});
function compile(file, deps, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,
    target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText, {exports,AbortController,...globals,
    require:name=>{assert.ok(name in deps, name);return deps[name];}});
  return exports;
}
function render(value, error = false) {
  const { DancerExternalRankingBenefit } = compile('app/dashboard/DancerExternalRankingBenefit.tsx',{
    'react/jsx-runtime':require('react/jsx-runtime'),
    './useDancerRankingStatus':{useDancerRankingStatus:()=>({status:value,error})},
    '@/src/lib/dancr/external-ranking-progress':progress,'@/src/lib/dancr/venue-dancer-scores':scoring,
  });
  return renderToStaticMarkup(DancerExternalRankingBenefit({refreshKey:'shift'}));
}

test('Overview confirms actual earned benefit, and never treats hidden, pending or unavailable scores as active',()=>{
  assert.match(render(status()), /External ranking benefit active/);
  for (const [external,overall,eligible] of [[0,null,true],[null,20,true],[2,null,true],[2,1,false],[NaN,1,true],[2,Infinity,true],[101,1,true]]) {
    assert.equal(progress.hasExternalRankingBenefit(status(external,overall,eligible)),false);
    assert.doesNotMatch(render(status(external,overall,eligible)), /benefit active/);
  }
  assert.match(render(status(0,null)),/after 5 recorded external minutes/);
  assert.match(render(status(2,1,false)),/approved and public/);
  assert.match(render(null),/Checking ranking benefit/);
  assert.match(render(status(),true),/temporarily unavailable/);
  assert.doesNotMatch(render(status(),true),/benefit active/);
});

function hookFixture() {
  let state = null, effect, cleanup, deps;
  const requests = [], intervals = new Map(), events = new Map();
  const document = {visibilityState:'visible',addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:(name)=>events.delete(name)};
  const hook = compile('app/dashboard/useDancerRankingStatus.ts',{
    react:{useState:()=>[state,value=>{state=value;}],useEffect:(fn,next)=>{if(!deps||next[0]!==deps[0]){effect=fn;deps=next;}}},
    './dashboard-session':{requestDashboardJson:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))},
  },{document,window:{setInterval:(fn,ms)=>{assert.equal(ms,60_000);intervals.set(fn,fn);return fn;},clearInterval:fn=>intervals.delete(fn)}}).useDancerRankingStatus;
  return {requests,document,intervals,events,render(key='shift'){
    const value=hook(key);if(effect){cleanup?.();cleanup=effect();effect=null;}return value;
  },unmount(){cleanup?.();},tick(){for(const fn of intervals.values())fn();},visible(){document.visibilityState='visible';events.get('visibilitychange')?.();}};
}
const settle = () => new Promise(resolve=>setImmediate(resolve));

test('minute refresh detects newly earned points, avoids overlapping requests, pauses hidden polling and clears failures',async()=>{
  const f=hookFixture();assert.equal(f.render().status,null);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.expectedRole,'dancer');
  f.tick();assert.equal(f.requests.length,1);
  f.requests[0].resolve(status(0,null));await settle();assert.equal(progress.hasExternalRankingBenefit(f.render().status),false);
  f.tick();assert.equal(f.requests.length,2);
  f.requests[1].resolve(status());await settle();assert.equal(progress.hasExternalRankingBenefit(f.render().status),true);
  f.document.visibilityState='hidden';f.tick();assert.equal(f.requests.length,2);
  f.visible();assert.equal(f.requests.length,3);
  f.requests[2].reject(new Error('Temporary failure'));await settle();assert.equal(f.render().error,true);assert.equal(f.render().status,null);
  f.tick();f.requests[3].resolve(status());await settle();assert.equal(f.render().error,false);
  f.unmount();assert.equal(f.intervals.size,0);assert.equal(f.events.size,0);
});

test('changing shift hides stale benefit immediately and aborts old reads; late replies after cleanup cannot update state',async()=>{
  const f=hookFixture();f.render();f.requests[0].resolve(status());await settle();assert.ok(f.render().status);
  f.tick();const old=f.requests[1];assert.equal(f.render('next-shift').status,null);assert.equal(old.options.signal.aborted,true);
  old.resolve(status());await settle();assert.equal(f.render('next-shift').status,null);
  const current=f.requests[2];f.unmount();assert.equal(current.options.signal.aborted,true);
  current.resolve(status());await settle();assert.equal(f.render('next-shift').status,null);
});
