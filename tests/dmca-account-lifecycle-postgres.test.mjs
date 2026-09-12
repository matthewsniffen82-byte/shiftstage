import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {database,seed,notice,takeDown,eligible,restore,snapshot,id,schema,operatorQuery} from './helpers/dmca-lifecycle-database.mjs';
let db;
before(async()=>{
 db=await database();
 for(const path of ['ownership.sql','takedown.sql','restoration.sql'])await db.exec(readFileSync(new URL('./fixtures/dmca-lifecycle/'+path,import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec('reset role;truncate '+[...schema.scope.fullTargets.map(t=>'public.'+t),...schema.scope.relatedProjections,'public.dmca_enforcement_states'].join(','));
 await seed(db);
});
const transition=async(state,n=1)=>(await db.query('select public.transition_own_account_safely($1,$2)result',[id(n),state])).rows[0].result;
const row=async(table,n=1)=>(await db.query('select * from public.'+table+' where id=$1',[id(n)])).rows[0];
const pauses=async()=> (await db.query('select * from public.account_self_pauses order by user_id')).rows;
const states=async()=> (await db.query('select * from public.dmca_enforcement_states order by target_type,target_id')).rows;
async function full(){return{...await snapshot(db),states:await states(),auth:(await db.query('select * from auth.users order by id')).rows};}
async function three(){for(let n=0;n<3;n++){await notice(db,200+n,100+n);await takeDown(db,200+n);}}

test('self-pause followed by repeat enforcement retains disabled login without recreating resume permission',async()=>{
 await transition('disabled');assert.equal((await pauses()).length,1);
 await three();assert.equal((await pauses()).length,0);
 await eligible(db,200);await restore(db,200);
 const account=await row('app_users'),profile=await row('dancer_profiles',10);
 assert.equal(account.account_state,'disabled');assert.equal(account.dmca_suspended_at,null);
 assert.equal(profile.status,'disabled');assert.equal(profile.is_public,false);assert.equal(profile.dmca_suspended_at,null);
 assert.equal((await pauses()).length,0);
 await assert.rejects(transition('active'),{message:'ACCOUNT_TRANSITION_NOT_SELF_PAUSED',code:'42501'});
});
for(const action of ['disabled','active'])test('DMCA-held account rejects '+action+' before any same-state or pause permission decision',async()=>{
 await three();const before=await full();
 await assert.rejects(transition(action),{message:'ACCOUNT_TRANSITION_RESTRICTED',code:'42501'});
 assert.deepEqual(await full(),before);
});
test('earlier eligible case restores an originally active account with both trigger families installed',async()=>{
 await three();await eligible(db,200);await restore(db,200);
 assert.equal((await row('app_users')).account_state,'active');
 const profile=await row('dancer_profiles',10);assert.equal(profile.status,'approved');assert.equal(profile.is_public,true);
 assert.equal((await pauses()).length,0);
});
test('actual administrator profile disable preserves login resume while withholding profile restoration',async()=>{
 await transition('disabled');
 await db.query("select public.transition_dancer_publication_safely($1,'disable',$2)",[id(10),id(2)]);
 const pause=(await pauses())[0];assert.equal(pause.dancer_previous_state,null);
 await transition('active');const profile=await row('dancer_profiles',10);
 assert.equal((await row('app_users')).account_state,'active');assert.equal(profile.status,'disabled');assert.equal(profile.is_public,false);assert.ok(profile.admin_disabled_at);
});
test('same-value trusted account decision invalidates pause permission and service direct writes stay denied',async()=>{
 await transition('disabled');
 await assert.rejects(db.query("update public.app_users set account_state='disabled' where id=$1",[id(1)]),{code:'42501'});
 assert.equal((await pauses()).length,1);
 await operatorQuery(db,"update public.app_users set account_state='disabled' where id=$1",[id(1)]);
 assert.equal((await pauses()).length,0);
 await assert.rejects(transition('active'),{message:'ACCOUNT_TRANSITION_NOT_SELF_PAUSED'});
});
test('unrelated display and caption edits preserve private ownership and their edited values',async()=>{
 await transition('disabled');await notice(db);await takeDown(db);const oldPauses=await pauses(),oldStates=await states();
 await db.query("update public.app_users set display_name='Changed display' where id=$1",[id(1)]);
 await db.query("update public.mydancr_tv_videos set caption='Changed caption' where id=$1",[id(100)]);
 assert.deepEqual(await pauses(),oldPauses);assert.deepEqual(await states(),oldStates);
 await transition('active');await eligible(db);await restore(db);
 assert.equal((await row('app_users')).display_name,'Changed display');assert.equal((await row('mydancr_tv_videos',100)).caption,'Changed caption');
});
for(const [action,table,operation]of [['takedown','notifications','insert'],['restore','admin_actions','insert'],['restore','app_users','update']])test(action+' failure at '+table+' rolls back both private stores and all related records',async()=>{
 await transition('disabled');
 for(let n=0;n<(action==='takedown'?2:3);n++){await notice(db,200+n,100+n);await takeDown(db,200+n);}
 if(action==='takedown')await notice(db,202,102);else await eligible(db,200);
 const before=await full();
 await db.exec(`reset role;create function public.synthetic_combined_failure()returns trigger language plpgsql as $$begin return null;end$$;create trigger synthetic_combined_failure before ${operation} on public.${table} for each row execute function public.synthetic_combined_failure();set role service_role`);
 try{await assert.rejects(action==='takedown'?takeDown(db,202):restore(db,200));assert.deepEqual(await full(),before);}
 finally{await db.exec(`reset role;drop trigger synthetic_combined_failure on public.${table};drop function public.synthetic_combined_failure();set role service_role`);}
});
test('self-deletion during enforcement cannot later reactivate or republish the account',async()=>{
 await three();await transition('deleted');await eligible(db,200);await restore(db,200);
 assert.equal((await row('app_users')).account_state,'deleted');assert.equal((await pauses()).length,0);
 const profile=await row('dancer_profiles',10);assert.equal(profile.status,'disabled');assert.equal(profile.is_public,false);
 assert.equal((await row('mydancr_tv_videos',100)).status,'hidden');
});
test('synthetic physical Auth deletion cascades both private stores and retains case history for safe resolution',async()=>{
 await transition('disabled');await notice(db);await takeDown(db);await eligible(db);
 assert.equal((await pauses()).length,1);assert.ok((await states()).length>0);
 await operatorQuery(db,'delete from auth.users where id=$1',[id(1)]);
 assert.equal(await row('app_users'),undefined);assert.equal((await pauses()).length,0);assert.equal((await states()).length,0);
 const retained=await row('dmca_cases',200);assert.equal(retained.uploader_id,null);
 const receipt=await restore(db);assert.equal(receipt.restorationOutcome,'missing_content');
 assert.equal(await row('app_users'),undefined);assert.equal(await row('dancer_profiles',10),undefined);
});
test('unrelated venue self-pause survives dancer enforcement and restores only its own venue',async()=>{
 await operatorQuery(db,'insert into auth.users(id)values($1)',[id(5)]);
 await operatorQuery(db,"insert into public.app_users(id,role,display_name,email)values($1,'venue','Synthetic venue owner','venue@example.invalid')",[id(5)]);
 await operatorQuery(db,"insert into public.venues(id,owner_user_id,name,slug,city,is_active,page_review_status,published_at)values($1,$2,'Synthetic venue','synthetic-venue','Las Vegas',true,'published','2026-01-01Z')",[id(40),id(5)]);
 await transition('disabled',5);const before=await pauses();
 await three();await eligible(db,200);await restore(db,200);assert.deepEqual(await pauses(),before);
 assert.equal((await row('venues',40)).is_active,false);
 await transition('active',5);assert.equal((await row('venues',40)).is_active,true);
});
for(const change of ["court_filing_received=true,status='court_hold'","restore_eligible_at=now()+interval '1 day'"])test('ineligible resolution preserves self-pause and DMCA stores: '+change,async()=>{
 await transition('disabled');await notice(db);await takeDown(db);await eligible(db);
 await db.exec('update public.dmca_cases set '+change);const before=await full();
 await assert.rejects(restore(db));assert.deepEqual(await full(),before);
});
