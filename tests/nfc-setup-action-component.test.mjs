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
function harness(response, clubApprovalStatus = null, refreshedSession){
  const slots=[],effects=[],cleanups=[],calls=[],redirects=[],exports={};
  let browserSession = { account: { role: 'dancer' }, accessToken: 'synthetic', refreshToken: 'refresh' };
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
    async fetch(path,options){calls.push({path,options});return options.method==='POST'?response:{ok:true,json:async()=>({...tag, clubApprovalStatus, session: refreshedSession})};},
    require(name){
      if(name==='react')return hooks;
      if(name==='react/jsx-runtime')return require(name);
      if(name==='next/link')return {default:props=>React.createElement('a',props)};
      if(name.endsWith('/NfcIcon'))return {default:()=>null};
      if(name.endsWith('/visibility-mode'))return {VISIBILITY_OPTIONS};
      if(name.endsWith('/browser-session'))return {
        readBrowserAuthSession: () => browserSession,
        persistRefreshedBrowserAuthSession(session, expected) {
          if (session && expected.accessToken === browserSession.accessToken) browserSession = { ...browserSession, ...session };
        },
      };
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

for (const [approval, button, note] of [
  ['not_requested', 'Request approval', 'This club reviews your profile and media before your first check-in here.'],
  ['pending', 'Confirm tap', 'Your request is under review'],
  ['rejected', 'Confirm tap', 'This club declined your request'],
  ['approved', 'Check in', '6-hour cooldown at this club'],
  [null, 'Confirm tap', 'Your first tap at this club requests approval'],
]) test(`tap preview shows the action for this club: ${approval}`, async () => {
  const h = harness(null, approval);
  await h.settle();
  const [visible, help] = h.html.split('<details');
  assert.ok(visible.includes(`disabled="">${button}</button>`));
  assert.ok(visible.includes(note));
  assert.match(visible, /<legend>Choose who can see you when you’re checked in<\/legend>/);
  for (const [value, label, description] of [
    ['internal', 'Club roster only', 'Guests at this club and its invited VIPs can see you.'],
    ['external', 'Public on MyDancr only', 'Anyone browsing MyDancr can see you’re working here.'],
    ['both', 'Both', 'Show me on the club roster and on public MyDancr.'],
  ]) {
    assert.match(visible, new RegExp(`value="${value}"[^>]*><span><strong>${label}</strong>`));
    assert.ok(visible.includes(`<strong>${label}</strong><small>${description}</small>`));
  }
  assert.match(help, /^ class="nfc-help"><summary>How check-in works<\/summary><ul>/);
  assert.equal((help.match(/<li>/g) || []).length, 3);
  assert.match(help, /The 6-hour window starts when you tap/);
  assert.match(help, /at this club 12 hours after your original tap, even if you check out early/);
  assert.match(help, /<li><strong>Switching clubs\?<\/strong> Check out of your current club,[^<]*next approved club[^<]*unless that club has its own cooldown/);
  assert.doesNotMatch(help, /final approval|VIPs/);
  if (approval === 'not_requested') {
    assert.match(visible, /First tap at this club/);
    assert.ok(visible.includes(`<h1>${tag.venue.name}</h1><p>${tag.venue.city}, ${tag.venue.state}</p>`));
    assert.ok(visible.indexOf(note) < visible.indexOf('<fieldset'));
    assert.match(visible, /If approved within 6 hours of your tap, you’ll check in automatically for the time left\. If approved later, tap again\.<\/p>/);
    assert.doesNotMatch(visible, /MyDancr gives final approval|MyDancr is reviewing|cooldown|>Check in<\/button>/);
  }
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.headers.authorization, 'Bearer synthetic');
  h.unmount();
});

test('a first tap uses the refreshed session and sends the selected visibility only on confirmation', async () => {
  const h = harness({ ok: true, json: async () => ({
    ok: true, affiliation: { enrollmentStatus: 'pending', clubApprovalStatus: 'pending' }, message: 'Tap saved. We’ll email you with the review result.',
  }) }, 'not_requested', { accessToken: 'renewed', refreshToken: 'next-refresh' });
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.headers['x-dancr-refresh-token'], 'refresh');
  await h.submit();
  const { options } = h.calls[1];
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.authorization, 'Bearer renewed');
  assert.equal(JSON.parse(options.body).visibility, 'both');
  assert.match(h.html, /Tap saved\. We’ll email you with the review result\./);
  assert.equal(h.redirects.length, 0);
  h.unmount();
});

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
  assert.match(h.html,/Confirm tap/);h.unmount();
});

test('temporary failures show one error with retry and a dashboard exit',async()=>{
  const h=harness({ok:false,json:async()=>({ok:false,code:'UNAVAILABLE',error:'Unable to confirm this tap.'})});
  await h.settle();await h.submit();assert.match(h.html,/Try again/);assert.match(h.html,/Back to dancer dashboard/);
  assert.match(h.html,/role="alert">Unable to confirm this tap\./);
  assert.doesNotMatch(h.html,/Your check-in was not confirmed|Profile activation was not completed|class="nfc-status"/);h.unmount();
});

test('the dancer sees the club and return time directly on a blocked tap',async()=>{
  const h=harness({ok:false,json:async()=>({ok:false,code:'DANCER_TAP_COOLDOWN',error:'You can check in at Synthetic club again on Nov 10, 9:30 PM PST.'})},'approved');
  await h.settle();await h.submit();
  assert.match(h.html,/role="alert">You can check in at Synthetic club again on Nov 10, 9:30 PM PST\./);
  assert.equal(h.redirects.length,0);h.unmount();
});

test('club approval with pending media reports a saved tap without activating or redirecting',async()=>{
  const h=harness({ok:true,json:async()=>({ok:true,affiliation:{enrollmentStatus:'pending',clubApprovalStatus:'approved',shiftCheckedIn:false},message:'Your tap is saved. You are not checked in yet.'})});
  await h.settle();await h.submit();assert.match(h.html,/Your tap is saved/);assert.match(h.html,/not checked in yet/);
  assert.doesNotMatch(h.html,/Working Now|Opening your dancer dashboard|Try again|nfc=complete/);
  assert.equal(h.redirects.length,0);assert.equal(h.calls.length,2);h.unmount();
});
