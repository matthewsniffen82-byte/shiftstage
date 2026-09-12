import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../app/dashboard/DancerShiftManager.tsx',import.meta.url),'utf8');
const start=source.indexOf('  async function postDate('),end=source.indexOf('\n  return (',start);
assert.ok(start>0&&end>start);
const code=ts.transpileModule(source.slice(start,end)+'\nthis.post=postDate;this.edit=saveEdit;this.end=endWorkingNow;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
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
const event={preventDefault(){}};
test('failed date creation preserves the entered date and unlocks the form',async()=>{
  const f=fixture(),run=f.context.post(event);f.reject(new Error('Save failed'));await run;
  assert.equal(f.context.shiftDate,'2026-09-15');assert.equal(f.saved.at(-1),false);
  assert.match(f.status.at(-1),/Save failed/);assert.equal(f.context.actionPendingRef.current,false);
});
test('failed editing keeps the editor open with its entered date',async()=>{
  const f=fixture(),run=f.context.edit('shift');f.reject(new Error('Save failed'));await run;
  assert.equal(f.context.editingId,'shift');assert.equal(f.context.editDate,'2026-09-16');
});
test('a committed save with a failed refresh reports success and clears only the submitted form',async()=>{
  const f=fixture({refreshFails:true}),run=f.context.post(event);f.resolve({ok:true});await run;
  assert.equal(f.context.shiftDate,'');assert.match(f.status.at(-1),/Upcoming date posted\. Refresh/);
});
test('rapid submit and end-shift actions cannot overlap before React disables controls',async()=>{
  const f=fixture(),run=f.context.post(event);
  await f.context.post(event);await f.context.end();
  assert.equal(f.calls.length,1);assert.equal(f.context.shiftDate,'2026-09-15');
  f.resolve({ok:true});await run;assert.equal(f.context.shiftDate,'');
});
test('ending Working Now also excludes concurrent schedule writes',async()=>{
  const f=fixture(),run=f.context.end();await f.context.post(event);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'DELETE');
  f.resolve({ok:true});await run;assert.equal(f.context.actionPendingRef.current,false);
});
test('a late save completion cannot clear input after unmount',async()=>{
  const f=fixture(),run=f.context.post(event);f.context.mountedRef.current=false;f.resolve({ok:true});await run;
  assert.equal(f.context.shiftDate,'2026-09-15');assert.equal(f.context.actionPendingRef.current,false);
});
