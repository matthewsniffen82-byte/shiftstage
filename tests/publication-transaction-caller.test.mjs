import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {database,seed,notice,takeDown,eligible,restore,snapshot,id,schema} from './helpers/dmca-case-callers-database.mjs';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(root+'/package.json'),ts=require('typescript');
const {PublicApiError}=await import(pathToFileURL(root+'/src/lib/api-error-policy.ts').href);
const code=ts.transpileModule(readFileSync(sourceRoot+'/src/lib/dancr/profile-publication.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const library={};
vm.runInNewContext(code,{exports:library,Error,Date,Number,require:()=>({PublicApiError})});
let db;
// Load independently captured deployed definitions and permissions directly.
before(async()=>{db=await database();});

after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('reset role;truncate '+[...schema.scope.fullTargets.map(t=>'public.'+t),...schema.scope.relatedProjections].join(','));await seed(db);});
function harness({receipt=x=>x,error=null,lost=false,envelope=x=>x}={}){
 const calls=[];const client={async rpc(name,args){calls.push({name,args});assert.equal(name,'transition_dancer_publication_safely');if(error==='throw')throw new Error('private publication failure');if(error)return{data:null,error:{code:error}};
  let result;try{result=(await db.query('select public.transition_dancer_publication_safely($1,$2,$3)result',[args.p_dancer_id,args.p_transition,args.p_actor_user_id])).rows[0].result;}catch(failure){return{data:null,error:{code:failure.code}};}
  if(lost)throw new Error('private lost commit');return envelope({data:receipt(result),error:null});
 },from(){assert.fail('No missing-RPC or failed-receipt direct read/write fallback');}};
 return{calls,run:(action='set_private',actor=id(1))=>library.transitionDancerPublication(client,id(10),action,{actorUserId:actor})};
}
for(const [action,actor,status,isPublic]of [['submit_for_venue_review',1,'pending_review',false],['admin_accept',2,'pending_review',false],['admin_reject',2,'rejected',false],['set_public',1,'approved',true],['set_private',1,'approved',false],['disable',1,'disabled',false],['disable',2,'disabled',false],['reactivate',1,'approved',true]])test('actual publication receipt confirms '+action+' actor '+actor,async()=>{
 const h=harness(),result=await h.run(action,id(actor));assert.equal(result.id,id(10));assert.equal(result.userId,id(1));assert.equal(result.status,status);assert.equal(result.isPublic,isPublic);assert.equal(h.calls.length,1);const row=(await snapshot(db)).dancer_profiles[0];assert.equal(row.status,result.status);assert.equal(row.is_public,result.isPublic);
});
for(const [error,status]of [['PGRST202',503],['42883',503],['08006',503],['throw',503],['42501',403],['22023',409],['40001',409],['P0002',404]])test('publication '+error+' fails safely with no direct fallback',async()=>{
 const before=await snapshot(db),h=harness({error});await assert.rejects(h.run(),e=>e.status===status&&!e.message.includes('private'));assert.equal(h.calls.length,1);assert.deepEqual(await snapshot(db),before);
});
for(const [name,receipt]of [['null',()=>null],['array',()=>[]],['empty',()=>({})],['wrong identity',r=>({...r,id:id(999)})],['wrong owner',r=>({...r,user_id:id(3)})],['missing owner',r=>({...r,user_id:null})],['unknown status',r=>({...r,status:'published'})],['unknown verification',r=>({...r,verification_status:'verified'})],['string visibility',r=>({...r,is_public:'false'})],['missing visibility',r=>({...r,is_public:undefined})],['invalid approval',r=>({...r,approved_at:'infinity'})],['missing timestamp',r=>({...r,disabled_at:undefined})],['date-only venue approval',r=>({...r,venue_approved_at:'2026-09-12'})],['invalid venue identity',r=>({...r,venue_approved_venue_id:'not-a-uuid'})],['wrong transition',r=>({...r,is_public:true})]])test('unconfirmed '+name+' receipt does not cause a second publication write',async()=>{
 const h=harness({receipt});await assert.rejects(h.run(),e=>e.status===503);assert.equal(h.calls.length,1);assert.equal((await snapshot(db)).dancer_profiles[0].is_public,false);
});
for(const envelope of [()=>null,()=>undefined,()=>[],()=>false])test('invalid publication response envelope '+envelope.toString()+' is unavailable',async()=>{const h=harness({envelope});await assert.rejects(h.run(),e=>e.status===503);assert.equal(h.calls.length,1);});
test('unknown private receipt fields are not returned to the caller',async()=>{
 const h=harness({receipt:r=>({...r,privateReview:'Private review'})}),result=await h.run();assert.deepEqual(Object.keys(result).sort(),['approvedAt','disabledAt','id','isPublic','status','userId','venueApprovedAt','venueApprovedByUserId','venueApprovedVenueId','verificationStatus']);
});
test('lost committed response keeps resulting private visibility and requires review',async()=>{
 const h=harness({lost:true});await assert.rejects(h.run(),e=>e.status===503);assert.equal(h.calls.length,1);assert.equal((await snapshot(db)).dancer_profiles[0].is_public,false);
});
test('an administrative suspension remains disabled through the owner reactivation receipt',async()=>{
 await harness().run('disable',id(2));const before=(await snapshot(db)).dancer_profiles[0],result=await harness().run('reactivate');assert.equal(result.status,'disabled');assert.equal(result.isPublic,false);assert.equal(result.disabledAt,before.disabled_at);assert.equal((await snapshot(db)).dancer_profiles[0].admin_disabled_at,before.admin_disabled_at);
});
for(const actor of [id(3),null])test('an unrelated or missing actor cannot change profile visibility: '+actor,async()=>{
 const before=await snapshot(db);await assert.rejects(harness().run('set_public',actor),e=>e.status===403);assert.deepEqual(await snapshot(db),before);
});
test('owner cannot publish or reactivate an account held by three copyright strikes',async()=>{
 for(let n=200;n<203;n++){await notice(db,n,n-100);await takeDown(db,n);}const before=await snapshot(db);
 for(const action of ['set_public','reactivate'])await assert.rejects(harness().run(action),e=>e.status===409);assert.deepEqual(await snapshot(db),before);
});
test('publication decision after repeat enforcement is preserved when an earlier case resolves',async()=>{
 for(let n=200;n<203;n++){await notice(db,n,n-100);await takeDown(db,n);}await eligible(db);await harness().run('admin_reject',id(2));await restore(db);
 const row=(await snapshot(db)).dancer_profiles[0];assert.equal(row.status,'rejected');assert.equal(row.verification_status,'rejected');assert.equal(row.is_public,false);
});
test('unconfirmed suppressed native publication update is not reported as a completed action',async()=>{
 const before=await snapshot(db);await db.exec('reset role;create function public.synthetic_publication_suppression()returns trigger language plpgsql as $$begin return null;end$$;create trigger synthetic_publication_suppression before update on public.dancer_profiles for each row execute function public.synthetic_publication_suppression();set role service_role');
 try{await assert.rejects(harness().run(),e=>e.status===503);assert.deepEqual(await snapshot(db),before);}finally{await db.exec('reset role;drop trigger synthetic_publication_suppression on public.dancer_profiles;drop function public.synthetic_publication_suppression();set role service_role');}
});
