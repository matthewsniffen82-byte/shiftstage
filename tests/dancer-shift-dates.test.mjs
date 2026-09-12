import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const require=createRequire(new URL('package.json',root)),ts=require('typescript');const {NextResponse}=require('next/server');
const {PublicApiError,resolveApiError}=await import(new URL('src/lib/api-error-policy.ts',root));
const {readBoundedJsonObject}=await import(new URL('src/lib/bounded-json-body.ts',root));
const {requestRoleFixture}=await import(new URL('tests/helpers/request-role-fixture.mjs',root));
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const routeCode=compile(readFileSync(new URL('app/api/dancer/shifts/route.ts',root),'utf8'));
const lifecycleCode=compile(readFileSync(new URL('src/lib/dancr/shift-lifecycle.ts',root),'utf8'));
const scheduleCode=compile(readFileSync(new URL('src/lib/dancr/schedule.ts',root),'utf8'));
const id=n=>'a1610000-0000-4000-8000-'+String(n).padStart(12,'0');
const dancer=id(1),venue=id(100),shift=id(1000),now=Date.parse('2026-09-12T12:00:00Z');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
function fixture({role='dancer',zone='Australia/Sydney',affiliated=true,status='approved',source='scheduled',active=false,otherOwner=false}={}){
  const auth=requestRoleFixture({role}),writes=[];let stored={id:shift,dancer_id:otherOwner?id(2):dancer,venue_id:venue,shift_date:'2026-10-04',timezone:zone,starts_at:'2026-10-03T14:01:00Z',ends_at:'2026-10-04T13:01:00Z',shift_source:source,status:'posted',checked_in_at:active?'2026-10-04T02:00:00Z':null,checked_out_at:null};
  const client={from(table){let operation='select',values,filters=[],selection;
    const q={select(value){selection=value;return q;},eq(key,value){filters.push([key,'eq',value]);return q;},neq(key,value){filters.push([key,'neq',value]);return q;},is(key,value){filters.push([key,'is',value]);return q;},or(value){filters.push(['or','or',value]);return q;},order(){return q;},limit(){return q;},insert(value){operation='insert';values=value;return q;},update(value){operation='update';values=value;return q;},single:execute,maybeSingle:execute};
    async function execute(){
      if(table==='dancer_profiles'){assert.ok(filters.some(([key,,value])=>key==='user_id'&&value==='verified-owner'));return{data:{id:dancer,stage_name:'Synthetic dancer',status},error:null};}
      if(table==='venue_dancer_affiliations'){assert.ok(filters.some(([key,,value])=>key==='dancer_id'&&value===dancer));return{data:affiliated?{venue_id:venue,venues:{id:venue,name:'Synthetic venue',slug:'synthetic',timezone:zone,is_active:true}}:null,error:null};}
      assert.equal(table,'shifts');
      if(operation==='insert'){writes.push({operation,values:structuredClone(values)});stored={...values,id:shift,checked_in_at:null,checked_out_at:null};return{data:{id:shift},error:null};}
      const matches=stored&&filters.every(([key,op,value])=>op==='or'?(stored.checked_in_at===null||stored.checked_out_at!==null):op==='neq'?stored[key]!==value:stored[key]===value);
      if(operation==='update'&&matches){writes.push({operation,values:structuredClone(values),filters:structuredClone(filters)});stored={...stored,...values};}
      return{data:matches?(selection==='id'?{id:shift}:structuredClone(stored)):null,error:null};
    }
    return q;
  }};
  const schedule={},lifecycle={},exports={};
  vm.runInNewContext(scheduleCode,{exports:schedule,Date:Clock,Intl});
  vm.runInNewContext(lifecycleCode,{exports:lifecycle,Date:Clock,Error,require(name){if(name==='../api-error-policy')return{PublicApiError};throw new Error(name);}});
  vm.runInNewContext(routeCode,{exports,Date:Clock,Error,Request,Response,URL,require(name){
    if(name==='next/server')return{NextResponse};
    if(name==='@/src/lib/api')return{apiError(error,fallback){const result=resolveApiError(error,fallback);return NextResponse.json(result.body,{status:result.status});}};
    if(name==='@/src/lib/bounded-json-body')return{readBoundedJsonObject};
    if(name==='@/src/lib/supabase/request')return{async createRequestSupabaseContext(...args){const context=await auth.createContext(...args);return{...context,client};}};
    if(name==='@/src/lib/supabase/admin')return{createAdminSupabaseClient:()=>client};
    if(name==='@/src/lib/dancr/schedule')return schedule;
    if(name==='@/src/lib/dancr/shift-lifecycle')return lifecycle;
    if(name==='@/src/lib/dancr/customer-follow-notifications')return{async broadcastFollowedDancerUpcomingShift(){return 0;}};
    throw new Error(name);
  }});
  return{...exports,writes,stored:()=>structuredClone(stored)};
}
const request=(method,body)=>new Request('https://example.test/api/dancer/shifts',{method,headers:{'content-type':'application/json',authorization:'Bearer synthetic'},body:JSON.stringify(body)});
for(const [key,values]of [['shiftDate',['',null,false,0,[],{},'not-a-date','2026-02-30']],['startsAt',['',null,false,0,[],{},'infinity','not-a-date']]])for(const value of values)
  test('editing rejects an explicit invalid '+key+' '+JSON.stringify(value)+' without falling back to the old date',async()=>{
    const f=fixture(),before=f.stored();const response=await f.PATCH(request('PATCH',{shiftId:shift,[key]:value,status:'cancelled'}));assert.equal(response.status,400);assert.deepEqual(f.writes,[]);assert.deepEqual(f.stored(),before);
  });
test('valid POST uses the affiliated venue timezone and the authenticated dancer',async()=>{
  const f=fixture();const response=await f.POST(request('POST',{venueId:venue,shiftDate:'2026-10-04',timezone:'UTC',dancerId:id(2)}));assert.equal(response.status,200);
  assert.deepEqual(f.writes[0].values,{dancer_id:dancer,venue_id:venue,shift_date:'2026-10-04',shift_source:'scheduled',starts_at:'2026-10-03T14:01:00.000Z',ends_at:'2026-10-04T13:01:00.000Z',timezone:'Australia/Sydney',status:'posted'});
});
test('a valid PATCH retains ownership and active/demo filters while moving the day',async()=>{
  const f=fixture();assert.equal((await f.PATCH(request('PATCH',{shiftId:shift,shiftDate:'2026-10-05'}))).status,200);
  const write=f.writes[0];assert.equal(write.values.shift_date,'2026-10-05');assert.equal(write.values.starts_at,'2026-10-04T13:01:00.000Z');
  assert.ok(write.filters.some(([key,,value])=>key==='dancer_id'&&value===dancer));assert.ok(write.filters.some(([key,op,value])=>key==='shift_source'&&op==='neq'&&value==='demo_locked'));assert.ok(write.filters.some(([key])=>key==='or'));
});
test('venue-only edit may deliberately reuse the existing local date',async()=>{
  const f=fixture();assert.equal((await f.PATCH(request('PATCH',{shiftId:shift,venueId:venue}))).status,200);assert.equal(f.writes[0].values.shift_date,'2026-10-04');
});
test('status-only cancellation remains valid without supplying a new schedule',async()=>{
  const f=fixture();assert.equal((await f.PATCH(request('PATCH',{shiftId:shift,status:'cancelled'}))).status,200);assert.deepEqual(f.writes[0].values,{status:'cancelled'});
});
test('the supported legacy absolute timestamp still resolves in the venue timezone',async()=>{
  const f=fixture();assert.equal((await f.PATCH(request('PATCH',{shiftId:shift,startsAt:'2026-10-05T02:00:00Z'}))).status,200);assert.equal(f.writes[0].values.shift_date,'2026-10-05');
});
test('an explicit invalid shiftDate cannot be overridden by a valid legacy timestamp',async()=>{
  for(const method of ['POST','PATCH']){const f=fixture();assert.equal((await f[method](request(method,{shiftId:shift,venueId:venue,shiftDate:null,startsAt:'2026-10-05T02:00:00Z'}))).status,400);assert.deepEqual(f.writes,[]);}
});
for(const [label,options,status]of [['demo',{source:'demo_locked'},409],['active',{active:true},409],['NFC',{source:'nfc_presence'},409],['unaffiliated',{affiliated:false},403],['other dancer',{otherOwner:true},500],['wrong role',{role:'customer'},403]])
  test(label+' guard continues to prevent schedule mutation',async()=>{
    const f=fixture(options);assert.equal((await f.PATCH(request('PATCH',{shiftId:shift,venueId:venue,shiftDate:'2026-10-05'}))).status,status);assert.deepEqual(f.writes,[]);
  });
test('profile approval still controls posting and cannot be supplied in the body',async()=>{
  const f=fixture({status:'pending_review'});assert.equal((await f.POST(request('POST',{venueId:venue,shiftDate:'2026-10-04',status:'approved'}))).status,403);assert.deepEqual(f.writes,[]);
});
