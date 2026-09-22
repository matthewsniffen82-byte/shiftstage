import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../app/dashboard/DancerShiftManager.tsx',import.meta.url),'utf8');
const start=source.indexOf('  async function endWorkingNow('),end=source.indexOf('\n  return (',start);
assert.ok(start>0&&end>start);
const code=ts.transpileModule(source.slice(start,end)+'\nthis.end=endWorkingNow;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({refreshFails=false}={}){
  const calls=[],status=[],saved=[];let resolve,reject;
  const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const context={venueId:'venue',shiftDate:'2026-09-15',editVenueId:'venue',editDate:'2026-09-16',activeShift:{id:'active'},
    actionPendingRef:{current:false},mountedRef:{current:true},loadSequenceRef:{current:0},loadAbortRef:{current:null},
    setSaving:v=>saved.push(v),setStatus:v=>status.push(v),setShiftDate:v=>{context.shiftDate=v;},setEditingId:v=>{context.editingId=v;},editingId:'shift',
    setEndConfirmationOpen(){},setWorkingNowStatusKind(){},setWorkingNowStatus:v=>status.push(v),
    requestDancerShiftsJson:options=>{calls.push(options);return pending;},requestDancerShiftCheckInJson:options=>{calls.push(options);return pending;},
    load:async()=>{if(refreshFails)throw new Error('Reload failed');return true;},Error,DashboardDataRequestError:class extends Error{},
  };
  vm.runInNewContext(code,context);
  return {context,calls,status,saved,resolve,reject};
}
test('failed end-check-in requests unlock the control and retain the current session',async()=>{
  const f=fixture(),run=f.context.end();f.reject(new Error('End failed'));await run;
  assert.equal(f.context.activeShift.id,'active');assert.equal(f.saved.at(-1),false);
  assert.match(f.status.at(-1),/End failed/);assert.equal(f.context.actionPendingRef.current,false);
});
test('an ended session with a failed refresh still reports the successful end',async()=>{
  const f=fixture({refreshFails:true}),run=f.context.end();f.resolve({ok:true});await run;
  assert.match(f.status.at(-1),/Working Now ended.*Refresh/);
});
test('rapid end-check-in requests cannot overlap before React disables the control',async()=>{
  const f=fixture(),run=f.context.end();await f.context.end();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'DELETE');
  f.resolve({ok:true});await run;assert.equal(f.context.actionPendingRef.current,false);
});
test('late completion does not update status after unmount',async()=>{
  const f=fixture(),run=f.context.end();const before=f.status.slice();f.context.mountedRef.current=false;f.resolve({ok:true});await run;
  assert.deepEqual(f.status,before);assert.equal(f.context.actionPendingRef.current,false);
});
