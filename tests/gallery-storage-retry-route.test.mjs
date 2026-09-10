import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test,{before,beforeEach,after} from 'node:test';
import ts from 'typescript';
import {createAvatarRetirementDatabase,seedGalleryRetirementDatabase,claimGalleryRetirement,fixtureId as id} from './helpers/avatar-retirement-database.mjs';
import {loadGalleryCleanupRuntime} from './helpers/gallery-cleanup-runtime.mjs';

const runtime=loadGalleryCleanupRuntime(),profile=id(11),path=id(1)+'/'+profile+'/avatar/photo.r320.m800x900.f50x50.jpg';
const routeSource=readFileSync(new URL('../app/api/admin/gallery-retirements/[retirementId]/retry/route.ts',import.meta.url),'utf8');
const adminSource=ts.createSourceFile('admin.ts',readFileSync(new URL('../src/lib/dancr/admin.ts',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true);
const authSource=adminSource.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text==='requireAdmin').getText(adminSource);
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const adminExports={};vm.runInNewContext(compile(authSource),{exports:adminExports,Error,console:{warn(){}}});
const error={code:'08006',message:'private-provider-secret-and-file-path'};
let db,marker;
before(async()=>{db=await createAvatarRetirementDatabase();});
beforeEach(async()=>{
 await seedGalleryRetirementDatabase(db);await db.query('update dancer_profiles set avatar_storage_path=$1 where id=$2',[path,profile]);await db.query('update dancer_profiles set avatar_storage_path=null where id=$1',[profile]);marker=await claimGalleryRetirement(db,path);
});
after(async()=>db?.close());
const markers=async()=> (await db.query('select to_jsonb(t) row from gallery_storage_retirements t')).rows.map(r=>r.row);
function harness(options={}){
 const events=[],exports={},files=new Set([path,path+'.w320.webp','dancer-photos/'+path]);let removes=0;
 const session={accessToken:'synthetic-access',refreshToken:'synthetic-refresh'};
 const client={
  from(table){
   assert.ok(['app_users','gallery_storage_retirements'].includes(table));let field,value;
   const q={select(){return q;},eq(k,v){field=k;value=v;return q;},async maybeSingle(){
    events.push(table==='app_users'?'authorize':'lookup');
    if(table==='app_users'&&options.authReadError)return {data:null,error};
    if(table==='gallery_storage_retirements'&&options.lookupError)return {data:null,error};
    assert.equal(field,table==='app_users'?'id':'retirement_id');
    const fields=table==='app_users'?'id,role,account_state':'retirement_id,profile_id,storage_path';
    const data=(await db.query('select '+fields+' from '+table+' where '+field+'=$1',[value])).rows[0]??null;
    return {data:table==='gallery_storage_retirements'&&options.lookupReceipt?options.lookupReceipt(data):data,error:null};
   }};return q;
  },
  async rpc(name,args){
   events.push('claim');assert.equal(name,'claim_gallery_storage_retirement');assert.equal(args.p_storage_path,path);assert.equal(args.p_profile_id,profile);
   if(options.claimError)return {data:null,error};
   const data=await claimGalleryRetirement(db,args.p_storage_path,args.p_profile_id);
   return {data:options.claimReceipt?options.claimReceipt(data):data,error:null};
  },
  storage:{from(bucket){return {async remove(paths){
   events.push('remove:'+bucket);removes++;
   const fail=options.failStorageAt===removes;
   if(fail&&options.storageMode==='error')return {data:null,error};
   const removed=[];for(const p of paths)if(files.delete(p))removed.push({name:p});
   if(fail&&options.storageMode==='lost')return {data:null,error};
   if(fail&&options.storageMode==='foreign')return {data:[{name:'unrelated/file.jpg'}],error:null};
   return {data:removed,error:null};
  }};}},
 };
 const modules={
  'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
  '@/src/lib/api':{apiError:(e,fallback,status)=>{const r=runtime.apiPolicy.resolveApiError(e,fallback,status);return Response.json(r.body,{status:r.status});}},
  '@/src/lib/dancr/admin':adminExports,
  '@/src/lib/dancr/gallery-storage-retry':runtime.retry,
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>{events.push('service');return client;}},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>{events.push('authenticate');if(options.anonymous)throw new Error('Sign in required.');return {client,user:{id:options.userId??id(3)},session};}},
 };
 vm.runInNewContext(compile(routeSource),{exports,Error,console:{info(){}},require:name=>{assert.ok(modules[name],name);return modules[name];}});
 const run=(retirementId=marker.retirement_id,body)=>exports.POST(new Request('https://example.test/api/admin/gallery-retirements/'+retirementId+'/retry',{method:'POST',...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})}),{params:Promise.resolve({retirementId})});
 return {run,events,files,options,session};
}
test('active admin retries the actual native receipt and returns refreshed session without revealing storage paths',async()=>{
 const h=harness(),response=await h.run();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await response.json(),{ok:true,retirementId:marker.retirement_id,cleanup:'confirmed',session:h.session});assert.equal(h.files.size,0);
 assert.deepEqual(h.events,['authenticate','authorize','service','lookup','claim','remove:dancer-photos','remove:dancr-media-originals']);assert.equal((await markers()).length,1);
});
for(const kind of ['anonymous','customer','dancer','inactive-admin','missing-account','auth-read-error'])test(kind+' cannot obtain a service client or retry file cleanup',async()=>{
 if(kind==='inactive-admin')await db.query("update app_users set account_state='disabled' where id=$1",[id(4)]);
 const options={anonymous:kind==='anonymous',authReadError:kind==='auth-read-error',userId:{customer:id(5),dancer:id(1),'inactive-admin':id(4),'missing-account':id(999)}[kind]};
 const h=harness(options),response=await h.run();assert.equal(response.status,kind==='anonymous'?401:kind==='auth-read-error'?503:403);
 assert.ok(!h.events.includes('service'));assert.equal(h.files.size,3);assert.doesNotMatch(JSON.stringify(await response.json()),/private-provider|storage_path|profile_id/);
});
for(const badId of ['invalid','', '../file.jpg'])test('invalid retirement ID is rejected before marker lookup: '+badId,async()=>{
 const h=harness(),response=await h.run(badId);assert.equal(response.status,400);assert.ok(!h.events.includes('lookup'));assert.equal(h.files.size,3);
});
test('an unknown retirement UUID is not found and cannot claim arbitrary storage',async()=>{
 const h=harness(),response=await h.run(id(999));assert.equal(response.status,404);assert.ok(!h.events.includes('claim'));assert.equal(h.files.size,3);
});
test('uppercase retirement UUIDs resolve only the same stored receipt',async()=>{
 const h=harness();assert.equal((await h.run(marker.retirement_id.toUpperCase())).status,200);assert.equal(h.files.size,0);
});
const badReads=[['undefined',()=>undefined],['array',()=>[]],['wrong id',r=>({...r,retirement_id:id(999)})],['wrong profile',r=>({...r,profile_id:'invalid'})],['missing path',r=>({...r,storage_path:null})]];
for(const [label,lookupReceipt] of badReads)test('unconfirmed lookup '+label+' cannot reach claim or storage',async()=>{
 const h=harness({lookupReceipt});assert.equal((await h.run()).status,503);assert.ok(!h.events.includes('claim'));assert.equal(h.files.size,3);
});
for(const option of ['lookupError','claimError'])test(option+' preserves the permanent receipt and hides provider details',async()=>{
 const before=await markers(),h=harness({[option]:true}),response=await h.run();assert.equal(response.status,503);assert.ok(h.events.every(e=>!e.startsWith('remove:')));assert.equal(h.files.size,3);assert.deepEqual(await markers(),before);assert.doesNotMatch(JSON.stringify(await response.json()),/private-provider/);
});
for(const claimReceipt of [()=>null,r=>({...r,retirement_id:id(999)}),r=>({...r,profile_id:id(12)}),r=>({...r,storage_path:path+'x'})])test('a missing or mismatched claim cannot authorize retry bytes',async()=>{
 const h=harness({claimReceipt});assert.equal((await h.run()).status,503);assert.ok(h.events.every(e=>!e.startsWith('remove:')));assert.equal(h.files.size,3);
});
test('a restored reference makes the real RPC retain the file and the endpoint reports a conflict',async()=>{
 await db.exec('reset role;alter table dancer_profiles disable trigger dancer_profiles_guard_storage_reference');
 await db.query('update dancer_profiles set avatar_storage_path=$1 where id=$2',[path,id(12)]);
 await db.exec('alter table dancer_profiles enable trigger dancer_profiles_guard_storage_reference;set role service_role');
 const h=harness(),response=await h.run();assert.equal(response.status,409);assert.equal(h.files.size,3);assert.ok(h.events.every(e=>!e.startsWith('remove:')));
});
for(const failStorageAt of [1,2])for(const storageMode of ['error','lost','foreign'])test(storageMode+' at cleanup phase '+failStorageAt+' remains recoverable by the same receipt',async()=>{
 const before=await markers(),options={failStorageAt,storageMode},h=harness(options);assert.equal((await h.run()).status,503);assert.equal(h.events.filter(e=>e.startsWith('remove:')).length,failStorageAt);
 assert.deepEqual(await markers(),before);options.failStorageAt=undefined;assert.equal((await h.run()).status,200);assert.equal(h.files.size,0);assert.deepEqual(await markers(),before);
});
test('repeated successful recovery is idempotent and cannot use a supplied profile or storage path',async()=>{
 const before=await markers(),h=harness();const arbitrary={profileId:id(12),storagePath:'someone-else/private.jpg',retirementId:id(999)};
 assert.equal((await h.run(marker.retirement_id,arbitrary)).status,200);assert.equal((await h.run()).status,200);assert.equal(h.files.size,0);assert.deepEqual(await markers(),before);
});
