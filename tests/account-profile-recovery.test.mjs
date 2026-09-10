import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import test,{before,after,beforeEach} from 'node:test';
import {PublicApiError,resolveApiError} from '../src/lib/api-error-policy.ts';
import {createProvisioningDatabase,insertIdentity} from './helpers/account-provisioning-database.mjs';
const require=createRequire(import.meta.url);
const id='71000000-0000-4000-8000-000000000001';
let db;
before(async()=>{db=await createProvisioningDatabase();await db.exec(readFileSync(new URL('../supabase/migrations/20260910014900_preserve_existing_account_profiles.sql',import.meta.url),'utf8'));});
after(async()=>db?.close());
beforeEach(async()=>db.exec('reset role;truncate auth.users cascade;'));
function load(path,dependencies){
 const source=readFileSync(new URL('../'+path,import.meta.url),'utf8'),exports={};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,Request,Response,URL,Buffer,Error,console:{warn(){},error(){},info(){}},
  require:name=>name==='next/server'||name==='node:crypto'?require(name):Object.hasOwn(dependencies,name)?dependencies[name]:(()=>{throw new Error('Unexpected import '+name);})(),
 });
 return exports;
}
const auth=load('src/lib/dancr/auth.ts',{'server-only':{},'../api-error-policy':{PublicApiError},'./profile-publication':{}});
const recovery=load('src/lib/dancr/account-profile-recovery.ts',{'server-only':{},'../api-error-policy':{PublicApiError},'./auth':auth});
const user=(role='dancer')=>({id,email:'synthetic@example.test',user_metadata:{role},app_metadata:{}});
function client(options={}){
 const calls=[];
 return {calls,
  async rpc(name,args){
   calls.push({kind:'rpc',name,args});assert.equal(name,'provision_app_account_safely');
   if(options.rpcError)return {data:null,error:options.rpcError};
   const result=await db.query('select public.provision_app_account_safely($1,$2,$3,$4,$5) as result',[args.p_user_id,args.p_role,args.p_email,args.p_display_name,args.p_city]);
   if(options.afterCommitError)return {data:null,error:options.afterCommitError};
   return {data:Object.hasOwn(options,'ack')?options.ack:result.rows[0].result,error:null};
  },
  from(table){
   assert.ok(['app_users','customer_profiles','dancer_profiles'].includes(table));
   let fields,field,value;
   const query={select(selection){assert.match(selection,/^[a-z_, ]+$/);fields=selection;return query;},
    eq(key,target){assert.ok(['id','user_id'].includes(key));field=key;value=target;return query;},
    async maybeSingle(){
     calls.push({kind:'read',table,field,value});
     if(options.readError&&(!options.afterWriteOnly||calls.some(c=>c.kind==='rpc')))return {data:null,error:options.readError};
     if(options.missingAfterWrite&&calls.some(c=>c.kind==='rpc'))return {data:null,error:null};
     const result=await db.query(`select ${fields} from public.${table} where ${field}=$1`,[value]);
     assert.ok(result.rows.length<=1);
     return {data:result.rows[0]||null,error:null};
    }};
   return query;
  }};
}
const account=c=>auth.getAccountByUserId(c,id);
for(const role of ['customer','dancer'])test(`verified ${role} with a missing child is repaired once without changing its account`,async()=>{
 await insertIdentity(db,id,role);
 await db.query(`delete from ${role==='dancer'?'dancer_profiles':'customer_profiles'} where user_id=$1`,[id]);
 const c=client(),before=await account(c);
 assert.deepEqual(await recovery.recoverVerifiedPublicAccount(c,user(role),before),before);
 assert.equal(c.calls.filter(c=>c.kind==='rpc').length,1);
 const after=await account(c);await recovery.recoverVerifiedPublicAccount(c,user(role),after);
 assert.equal(c.calls.filter(c=>c.kind==='rpc').length,1);
 if(role==='dancer'){
  const profile=(await db.query('select stage_name,status,is_public,approved_at,venue_approved_at from dancer_profiles')).rows[0];
  assert.deepEqual(profile,{stage_name:'',status:'draft',is_public:false,approved_at:null,venue_approved_at:null});
 }
});
for(const role of ['customer','dancer'])test(`missing public account can recover the verified ${role} after an interrupted setup`,async()=>{
 await insertIdentity(db,id,role,{bootstrap:false});
 const c=client(),result=await recovery.recoverVerifiedPublicAccount(c,user(role),null);
 assert.equal(result.id,id);assert.equal(result.role,role);
 assert.equal(c.calls.filter(c=>c.kind==='rpc').length,1);
});
test('an established dancer keeps identity, approval, city and profile links during entry',async()=>{
 await insertIdentity(db,id);await db.query("update dancer_profiles set stage_name='Harper',city='Preserved',status='approved',is_public=true where user_id=$1",[id]);
 const before=(await db.query('select row_to_json(t) as row from dancer_profiles t')).rows;
 const c=client();await recovery.recoverVerifiedPublicAccount(c,user('customer'),await account(c));
 assert.equal(c.calls.filter(c=>c.kind==='rpc').length,0);
 assert.deepEqual((await db.query('select row_to_json(t) as row from dancer_profiles t')).rows,before);
});
for(const state of ['disabled','deleted'])test(`${state} accounts are not provisioned or reactivated`,async()=>{
 await insertIdentity(db,id);await db.query('delete from dancer_profiles where user_id=$1',[id]);await db.query('update app_users set account_state=$1 where id=$2',[state,id]);
 const c=client(),before=await account(c),result=await recovery.recoverVerifiedPublicAccount(c,user(),before);
 assert.equal(result.accountState,state);assert.equal(c.calls.filter(c=>c.kind==='rpc').length,0);
 assert.equal((await db.query('select count(*)::int as n from dancer_profiles')).rows[0].n,0);
});
for(const hint of ['admin','venue'])for(const field of ['user_metadata','app_metadata'])test(`missing account never grants ${hint} authority from ${field}`,async()=>{
 await insertIdentity(db,id,'customer',{bootstrap:false});const identity=user();
 identity[field]={[field==='app_metadata'?'mydancr_provisioned_role':'role']:hint};
 const c=client();await assert.rejects(recovery.recoverVerifiedPublicAccount(c,identity,null),error=>error.status===409);
 assert.equal(c.calls.length,0);
});
test('a lookup outage is not mistaken for a missing profile',async()=>{
 await insertIdentity(db,id);const fault={code:'57014'},c=client({readError:fault});
 const existing=await account(client());await assert.rejects(recovery.recoverVerifiedPublicAccount(c,user(),existing),error=>error===fault);
 assert.equal(c.calls.filter(c=>c.kind==='rpc').length,0);
});
for(const code of ['PGRST202','57014','08006'])test(`repair RPC ${code} fails without a legacy write fallback`,async()=>{
 await insertIdentity(db,id,'dancer',{bootstrap:false});const fault={code},c=client({rpcError:fault});
 await assert.rejects(recovery.recoverVerifiedPublicAccount(c,user(),null),error=>error===fault);
 assert.equal(c.calls.length,1);assert.equal((await db.query('select count(*)::int as n from app_users')).rows[0].n,0);
});
for(const ack of [null,false,{},1,'true'])test(`an ambiguous provisioning acknowledgment ${JSON.stringify(ack)} cannot report ready`,async()=>{
 await insertIdentity(db,id,'dancer',{bootstrap:false});const c=client({ack});
 await assert.rejects(recovery.recoverVerifiedPublicAccount(c,user(),null),error=>error.status===503);
 assert.equal(c.calls.filter(c=>c.kind==='rpc').length,1);
});
test('an uncertain committed repair is reused on explicit retry without overwriting its new profile',async()=>{
 await insertIdentity(db,id,'dancer',{bootstrap:false});const fault={code:'08006'},c=client({afterCommitError:fault});
 await assert.rejects(recovery.recoverVerifiedPublicAccount(c,user(),null),error=>error===fault);
 await db.query("update dancer_profiles set stage_name='Harper' where user_id=$1",[id]);
 const retry=client();assert.equal((await recovery.recoverVerifiedPublicAccount(retry,user(),await account(retry))).role,'dancer');
 assert.equal(retry.calls.filter(c=>c.kind==='rpc').length,0);
 assert.equal((await db.query('select stage_name from dancer_profiles')).rows[0].stage_name,'Harper');
});
for(const options of [{missingAfterWrite:true},{readError:{code:'08006'},afterWriteOnly:true}])test('failed verification after a write cannot silently return an incomplete account',async()=>{
 await insertIdentity(db,id,'dancer',{bootstrap:false});const c=client(options);
 await assert.rejects(recovery.recoverVerifiedPublicAccount(c,user(),null));
 assert.equal(c.calls.filter(c=>c.kind==='rpc').length,1);
});
test('mismatched verified identity and account fail before any database request',async()=>{
 const c=client();
 await assert.rejects(recovery.recoverVerifiedPublicAccount(c,user(),{id:'different',role:'dancer',accountState:'active'}),error=>error.status===409);
 assert.equal(c.calls.length,0);
});

function routes(c,identity){
 const api={PublicApiError,apiError(error,fallback){const value=resolveApiError(error,fallback);return Response.json(value.body,{status:value.status});}};
 const context={client:c,user:identity,session:{accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresAt:2000000000}};
 const common={
  '@/src/lib/api':api,'@/src/lib/bounded-json-body':{readBoundedJsonObject:r=>r.json()},
  '@/src/lib/dancr/auth':auth,'@/src/lib/dancr/account-profile-recovery':recovery,
  '@/src/lib/supabase/admin':{createAdminSupabaseClient:()=>c},
  '@/src/lib/supabase/request':{createRequestSupabaseContext:async()=>context},
  '@/src/lib/security/safe-error-metadata':{safeErrorMetadata:()=>({})},
 };
 const build=path=>{
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const dependencies=Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(m=>[m[1],{}]));
  return load(path,{...dependencies,...common,
   '@supabase/supabase-js':{isAuthError:()=>false},
   '@/src/lib/dancr/public-request-rate-limit':{enforcePublicRequestRateLimit:async()=>{},PublicRequestRateLimitError:class extends Error{}},
   '@/src/lib/dancr/account-recovery':{AccountRecoveryRateLimitError:class extends Error{}},
   '@/src/lib/supabase/server':{createServerSupabaseClient:()=>({auth:{signInWithPassword:async()=>({error:null,data:{user:identity,session:{access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:2000000000}}})}})},
  });
 };
 return {auth:build('app/api/auth/route.ts'),account:build('app/api/account/route.ts')};
}
for(const entry of ['login','confirmation','account'])test(`the actual ${entry} entry restores a verified missing dancer profile before success`,async()=>{
 await insertIdentity(db,id);await db.query('delete from dancer_profiles where user_id=$1',[id]);
 const c=client(),r=routes(c,user());
 const response=entry==='account'?await r.account.GET(new Request('https://mydancr.com/api/account'))
  :entry==='confirmation'?await r.auth.PUT(new Request('https://mydancr.com/api/auth',{method:'PUT',body:JSON.stringify({accessToken:'synthetic-access',refreshToken:'synthetic-refresh'})}))
  :await r.auth.POST(new Request('https://mydancr.com/api/auth',{method:'POST',body:JSON.stringify({mode:'login',role:'dancer',email:'synthetic@example.test',password:'Synthetic1!'})}));
 assert.equal(response.status,200);assert.equal((await response.json()).account.id,id);
 assert.equal((await db.query('select count(*)::int as n from dancer_profiles')).rows[0].n,1);
 assert.equal(c.calls.filter(c=>c.kind==='rpc').length,1);
});
