import assert from'node:assert/strict';import test from'node:test';import{readFileSync}from'node:fs';import{createRequire}from'node:module';import vm from'node:vm';
const root=new URL('../',import.meta.url);
const require=createRequire(new URL('package.json',root)),ts=require('typescript'),{NextResponse}=require('next/server');
const {PublicApiError,resolveApiError}=await import(new URL('src/lib/api-error-policy.ts',root));
const {readBoundedJsonObject}=await import(new URL('src/lib/bounded-json-body.ts',root));
const {requestRoleFixture}=await import(new URL('tests/helpers/request-role-fixture.mjs',root));
const markets=await import(new URL('src/lib/dancr/markets.ts',root));
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const adminCode=compile(readFileSync(new URL('src/lib/dancr/admin.ts',root),'utf8'));
const routeCode=compile(readFileSync(new URL('app/api/admin/venues/route.ts',root),'utf8'));
function fixture({role='admin',isActive=true,error=null}={}){
  const auth=requestRoleFixture({role}),writes=[],admin={},route={};let saved;
  const client={from(table){
    if(table==='admin_actions')return{async insert(row){writes.push({table,row:structuredClone(row)});return{error:null};}};
    assert.equal(table,'venues');const q={update(row){saved=structuredClone(row);writes.push({table,row:saved});return q;},eq(key,value){assert.equal(key,'id');assert.equal(value,'venue-1');return q;},select(){return q;},async single(){return{data:error?null:{id:'venue-1',name:'Synthetic venue',...saved},error};}};return q;
  }};
  vm.runInNewContext(adminCode,{exports:admin,Intl,Error,URL,require(name){
    if(name==='server-only')return{};
    if(name==='../api-error-policy')return{PublicApiError};
    if(name==='./venue')return{async getVenueById(){return{id:'venue-1',isActive,city:'Miami',state:'FL',address:'123 Synthetic Street'};}};
    if(name==='./markets')return markets;
    return new Proxy({},{get(_target,key){if(key==='__esModule')return false;return()=>{throw new Error('Unexpected dependency '+name+'.'+String(key));};}});
  }});
  vm.runInNewContext(routeCode,{exports:route,Error,URL,Request,Response,require(name){
    if(name==='next/server')return{NextResponse};
    if(name==='@/src/lib/api')return{apiError(e,fallback){const r=resolveApiError(e,fallback);return NextResponse.json(r.body,{status:r.status});}};
    if(name==='@/src/lib/bounded-json-body')return{readBoundedJsonObject};
    if(name==='@/src/lib/supabase/request')return{createRequestSupabaseContext:auth.createContext};
    if(name==='@/src/lib/supabase/admin')return{createAdminSupabaseClient:()=>client};
    if(name==='@/src/lib/dancr/admin')return admin;
    if(name==='@/src/lib/dancr/venue-claims')return{};
    throw new Error(name);
  }});
  return{patch:route.PATCH,writes,saved:()=>saved};
}
const request=body=>new Request('https://example.test/api/admin/venues',{method:'PATCH',headers:{'content-type':'application/json',authorization:'Bearer synthetic'},body:JSON.stringify({venueId:'venue-1',...body})});
for(const value of ['America/Los_Angles','Mars/Olympus','PST','PDT','EST','CET','PST8PDT','+05:30','-07:00',false,0,[],{}])
  test('invalid or ambiguous venue timezone '+JSON.stringify(value)+' is rejected before save or audit',async()=>{
    const f=fixture();const response=await f.patch(request({timezone:value,name:'Other edit'}));assert.equal(response.status,400);assert.deepEqual(f.writes,[]);assert.match((await response.json()).error,/named time zone/);
  });
for(const value of ['America/Los_Angeles','America/New_York','Australia/Sydney','Australia/Lord_Howe','Asia/Kathmandu','Pacific/Chatham','UTC','GMT','Etc/GMT+8','US/Pacific','utc','america/los_angeles'])
  test('supported named venue timezone '+value+' preserves its actual clock rules',async()=>{
    const f=fixture();assert.equal((await f.patch(request({timezone:'  '+value+'  '}))).status,200);
    assert.equal(f.saved().timezone,value);
    assert.equal(f.writes.length,2);assert.equal(f.writes[1].row.admin_id,'verified-owner');
    for(const field of ['is_active','published_at','page_review_status'])assert.equal(f.saved()[field],undefined);
  });
for(const value of [null,'','  '])test('existing blank venue timezone input retains the Los Angeles default '+JSON.stringify(value),async()=>{
  const f=fixture();assert.equal((await f.patch(request({timezone:value}))).status,200);assert.equal(f.saved().timezone,'America/Los_Angeles');
});
test('an unrelated venue edit preserves the existing timezone without resetting it',async()=>{
  const f=fixture();assert.equal((await f.patch(request({phone:'555-0100'}))).status,200);assert.equal(f.saved().timezone,undefined);
});
test('a private venue timezone edit remains in its existing review workflow',async()=>{
  const f=fixture({isActive:false});assert.equal((await f.patch(request({timezone:'America/New_York'}))).status,200);assert.equal(f.saved().page_review_status,'admin_draft');assert.equal(f.saved().is_active,undefined);
});
test('administrator authorization still precedes timezone validation and writes',async()=>{
  for(const role of ['customer','dancer','venue']){const f=fixture({role});assert.equal((await f.patch(request({timezone:'Mars/Olympus'}))).status,403);assert.deepEqual(f.writes,[]);}
});
test('an unavailable venue save stays private and does not append a false success audit',async()=>{
  const f=fixture({error:{code:'08006',message:'secret.internal.database'}});const response=await f.patch(request({timezone:'America/New_York'}));assert.equal(response.status,503);assert.equal(f.writes.length,1);assert.doesNotMatch(JSON.stringify(await response.json()),/secret\.internal/);
});
