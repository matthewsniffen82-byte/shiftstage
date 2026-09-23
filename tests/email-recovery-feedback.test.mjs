import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/live-shell/app/03-submit-password-recovery-form.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('    let loginRecoveryRequestVersion'), source.indexOf('    function friendlyAuthErrorMessage'));
function fixture() {
  const elements = new Map(), calls = [], pending = [];
  const node = id => {
    if (!elements.has(id)) elements.set(id, {value:'Test value', disabled:false, textContent:'', hidden:true, dataset:{}, attributes:{}, setAttribute(k,v){this.attributes[k]=v;}});
    return elements.get(id);
  };
  const fields = ['loginRecoveryRole','loginRecoveryAccountName','loginRecoveryCity','loginRecoveryContactEmail','loginRecoveryDetails'].map(node);
  const context = vm.createContext({ document:{getElementById:node}, loginRecoveryCard:node('card'), loginRecoveryStatus:node('status'), loginRecoveryForm:{querySelectorAll:()=>fields}, fetch:async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body)});
    return new Promise((resolve,reject)=>pending.push({resolve: data=>resolve({ok:data.ok,json:async()=>data}), reject}));
  }});
  vm.runInContext(code, context);
  context.resetLoginRecoveryFeedback();
  return {node, calls, pending, fields, reset:context.resetLoginRecoveryFeedback, submit:()=>context.submitLoginRecoveryForm({preventDefault(){}})};
}

test('email recovery blocks duplicates and keeps the confirmed reference visible until edited', async()=>{
  const f=fixture(), request=f.submit();
  assert.equal(f.node('loginRecoverySubmit').attributes['aria-busy'],'true');
  assert.ok(f.fields.every(field=>field.disabled));
  await f.submit(); assert.equal(f.calls.length,1);
  f.pending[0].resolve({ok:true,message:'Support will contact you.',reference:'REC-123'});
  await request;
  assert.equal(f.node('loginRecoverySubmit').textContent,'✓ Recovery request sent');
  assert.equal(f.node('loginRecoverySubmit').disabled,true);
  assert.match(f.node('status').textContent,/REC-123/);
  assert.ok(f.fields.every(field=>!field.disabled));
  await f.submit(); assert.equal(f.calls.length,1);
  f.reset();
  assert.equal(f.node('status').hidden,true);
  assert.equal(f.node('loginRecoverySubmit').disabled,false);
});

test('failed recovery requests stay editable and can retry without a false confirmation', async()=>{
  const f=fixture(), request=f.submit();
  f.pending[0].reject(new Error('Please try again.')); await request;
  assert.equal(f.node('card').dataset.state,'error');
  assert.equal(f.node('loginRecoverySubmit').disabled,false);
  assert.match(f.node('status').textContent,/Please try again/);
  const retry=f.submit();
  f.pending[1].resolve({ok:true,message:'Request received.'}); await retry;
  assert.equal(f.node('card').dataset.state,'success');
  assert.doesNotMatch(f.node('status').textContent,/undefined/);
});

for (const outcome of ['resolve','reject']) test(`late recovery ${outcome} cannot replace a reopened form's new request`,async()=>{
  const f=fixture(), old=f.submit();
  f.reset(); const current=f.submit();
  f.pending[0][outcome](outcome==='resolve'?{ok:true,message:'Old request.'}:new Error('Old error'));
  await old;
  assert.equal(f.node('card').dataset.state,'sending');
  assert.equal(f.node('loginRecoverySubmit').disabled,true);
  f.pending[1].resolve({ok:true,message:'Current request.'}); await current;
  assert.equal(f.node('status').textContent,'Current request.');
});

test('a delayed mobile change event cannot clear an in-flight recovery request', async()=>{
  const f=fixture(), request=f.submit();
  f.reset({type:'change'});
  assert.equal(f.node('card').dataset.state,'sending');
  assert.equal(f.node('loginRecoverySubmit').disabled,true);
  f.pending[0].resolve({ok:true,message:'Current request.'}); await request;
  assert.equal(f.node('card').dataset.state,'success');
  f.reset({type:'input'});
  assert.equal(f.node('card').dataset.state,'idle');
});
