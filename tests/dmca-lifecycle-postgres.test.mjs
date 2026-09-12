import assert from 'node:assert/strict';
import test,{before,after,beforeEach} from 'node:test';
import {readFileSync} from 'node:fs';
import {database,seed,notice,takeDown,eligible,restore,snapshot,id,schema} from './helpers/dmca-lifecycle-database.mjs';
import {operatorQuery} from './helpers/dmca-lifecycle-database.mjs';
let db;
before(async()=>{
 db=await database();
 for(const path of ['ownership.sql','takedown.sql','restoration.sql'])await db.exec(readFileSync(new URL('./fixtures/dmca-lifecycle/'+path,import.meta.url),'utf8'));
});
after(async()=>{await db?.close();});
beforeEach(async()=>{
 const tables=[...schema.scope.fullTargets.map(t=>'public.'+t),...schema.scope.relatedProjections,'public.dmca_enforcement_states'];
 await db.exec('reset role;truncate '+tables.join(','));await seed(db);
});
async function three(){for(let n=0;n<3;n++){await notice(db,200+n,100+n);await takeDown(db,200+n);}}
async function full(){return{...await snapshot(db),states:(await db.query('select * from public.dmca_enforcement_states order by target_type,target_id')).rows};}
const account=state=>state.app_users.find(u=>u.id===id(1));
const video=(state,n=100)=>state.mydancr_tv_videos.find(v=>v.id===id(n));
test('ordinary takedown and eligible restoration retain original publication time and decision',async()=>{
 const initial=await snapshot(db);await notice(db);const taken=await takeDown(db);assert.equal(taken.activeStrikes,1);
 await eligible(db);const result=await restore(db),state=await snapshot(db);
 assert.equal(result.restorationOutcome,'previous_state_restored');assert.equal(result.contentStatus,'approved');
 for(const field of ['status','published_at','review_notes'])assert.equal(video(state)[field],video(initial)[field]);
 assert.equal(state.dmca_strikes[0].active,false);assert.equal(state.dmca_counter_notices[0].status,'completed');
});
for(const action of ["status='hidden'","review_notes='Later manual decision'","reviewed_at=clock_timestamp()"]){
 test('later manual video decision survives: '+action,async()=>{
  await notice(db);await takeDown(db);await eligible(db);await db.query('update public.mydancr_tv_videos set '+action+' where id=$1',[id(100)]);
  const before=await snapshot(db),result=await restore(db),after=await snapshot(db);
  assert.equal(result.restorationOutcome,'independent_decision_preserved');
  for(const field of ['status','published_at','review_notes','reviewed_at'])assert.equal(video(after)[field],video(before)[field]);
 });
}
test('unrelated caption and display-name edits preserve the owned restoration snapshot',async()=>{
 await notice(db);await takeDown(db);await eligible(db);
 await db.query("update public.mydancr_tv_videos set caption='New caption' where id=$1",[id(100)]);
 await db.query("update public.app_users set display_name='New display' where id=$1",[id(1)]);
 await restore(db);const state=await snapshot(db);assert.equal(video(state).status,'approved');assert.equal(video(state).caption,'New caption');assert.equal(account(state).display_name,'New display');
});
test('another active case keeps the video hidden until both strikes are rescinded',async()=>{
 await notice(db,200,100);await takeDown(db,200);await notice(db,201,100);await takeDown(db,201);
 await eligible(db,200);const first=await restore(db,200);assert.equal(first.restorationOutcome,'another_active_case');assert.equal(video(await snapshot(db)).status,'hidden');
 await eligible(db,201);const second=await restore(db,201);assert.equal(second.restorationOutcome,'previous_state_restored');assert.equal(video(await snapshot(db)).status,'approved');
});
test('restoring any earlier case releases repeat enforcement at three-to-two strikes',async()=>{
 await three();await eligible(db,200);await restore(db,200);const state=await snapshot(db);
 assert.equal(account(state).account_state,'active');assert.equal(account(state).dmca_suspended_at,null);assert.equal(state.dancer_profiles[0].status,'approved');
 assert.equal(state.dancer_profiles[0].dmca_suspended_at,null);assert.equal(state.dancer_profiles[0].disabled_at,null);
 assert.equal(video(state,100).status,'approved');assert.equal(video(state,101).status,'hidden');assert.equal(video(state,102).status,'hidden');
 for(const n of [103,104,105])assert.equal(video(state,n).status,'approved');
});
test('fourth strike preserves the original first suspension snapshot across staged restorations',async()=>{
 await three();await notice(db,203,103);await takeDown(db,203);await eligible(db,202);const first=await restore(db,202);
 assert.equal(first.restorationOutcome,'repeat_strike_restriction');assert.equal(account(await snapshot(db)).account_state,'disabled');
 await eligible(db,203);await restore(db,203);const state=await snapshot(db);
 assert.equal(account(state).account_state,'active');assert.equal(state.dancer_profiles[0].status,'approved');
 for(const n of [102,103,104,105])assert.equal(video(state,n).status,'approved');
});
test('independent account/profile restrictions remain after the DMCA suspension marker clears',async()=>{
 await three();await operatorQuery(db,"update public.app_users set account_state='disabled' where id=$1",[id(1)]);
 await db.query("update public.dancer_profiles set status='disabled',admin_disabled_at=clock_timestamp() where id=$1",[id(10)]);
 await eligible(db,202);const result=await restore(db,202),state=await snapshot(db);
 assert.equal(result.restorationOutcome,'independent_decision_preserved');assert.equal(account(state).account_state,'disabled');assert.equal(account(state).dmca_suspended_at,null);
 assert.equal(state.dancer_profiles[0].status,'disabled');assert.equal(state.dancer_profiles[0].dmca_suspended_at,null);assert.ok(state.dancer_profiles[0].admin_disabled_at);
 assert.equal(video(state,102).status,'hidden');
});
test('an independent account deletion marker cannot be reverted by copyright restoration',async()=>{
 await three();await operatorQuery(db,"update public.app_users set account_state='deleted' where id=$1",[id(1)]);
 await eligible(db,202);await restore(db,202);const state=await snapshot(db);
 assert.equal(account(state).account_state,'deleted');assert.equal(state.dancer_profiles[0].status,'disabled');assert.equal(video(state,102).status,'hidden');
});

for(const changed of ["approved_at=null","venue_approved_by_user_id=null","venue_approved_venue_id=null"]){
 test('a later profile approval decision is preserved: '+changed,async()=>{
  await three();await eligible(db,200);await db.exec('update public.dancer_profiles set '+changed);await restore(db,200);const state=await snapshot(db);
  assert.equal(state.dancer_profiles[0].status,'disabled');assert.equal(state.dancer_profiles[0].dmca_suspended_at,null);assert.equal(video(state).status,'hidden');
 });
}
test('a later account role decision invalidates restoration of its previous active state',async()=>{
 await three();await eligible(db,200);await db.query("update public.app_users set role='customer' where id=$1",[id(1)]);await restore(db,200);const state=await snapshot(db);
 assert.equal(account(state).role,'customer');assert.equal(account(state).account_state,'disabled');assert.equal(account(state).dmca_suspended_at,null);
});
test('an explicit new distribution decision is not automatically published by restoration',async()=>{
 await notice(db);await takeDown(db);await eligible(db);await db.query("update public.mydancr_tv_videos set distribution_scope='feed_only' where id=$1",[id(100)]);
 const result=await restore(db),state=await snapshot(db);assert.equal(result.restorationOutcome,'independent_decision_preserved');assert.equal(video(state).status,'hidden');assert.equal(video(state).distribution_scope,'feed_only');
});

test('takedown cannot silently assign a case from a different recorded uploader',async()=>{
 await notice(db);await db.query('update public.dmca_cases set uploader_id=$1 where id=$2',[id(3),id(200)]);const before=await full();
 await assert.rejects(takeDown(db),{code:'40001'});assert.deepEqual(await full(),before);
});
test('a mismatched existing strike cannot be reactivated for another uploader',async()=>{
 await notice(db);await db.query('insert into public.dmca_strikes(case_id,user_id,active)values($1,$2,false)',[id(200),id(3)]);const before=await full();
 await assert.rejects(takeDown(db),{code:'40001'});assert.deepEqual(await full(),before);
});
for(const action of ['takedown','restore']){
 test(action+' rejects oversized direct-call notes without writes',async()=>{
  await notice(db);if(action==='restore'){await takeDown(db);await eligible(db);}const before=await full();
  await assert.rejects(db.query('select public.'+(action==='takedown'?'apply_dmca_takedown':'restore_dmca_case')+'($1,$2,$3)',[id(200),id(2),'x'.repeat(4001)]),{code:'22023'});assert.deepEqual(await full(),before);
 });
}
for(const status of ['hidden','submitted','moderating','uploading','rejected','expired']){
 test('restore the actual prior content state without inventing publication: '+status,async()=>{
  await db.query('update public.mydancr_tv_videos set status=$1,published_at=null,review_notes=$2 where id=$3',[status,'Prior '+status,id(100)]);
  await notice(db);await takeDown(db);await eligible(db);await restore(db);const state=await snapshot(db);
  assert.equal(video(state).status,status);assert.equal(video(state).published_at,null);assert.equal(video(state).review_notes,'Prior '+status);
 });
}
for(const changed of ["status='rejected'","status='withdrawn'","status='completed'","status='submitted'","forwarded_to_claimant_at=null","forwarded_to_claimant_at='infinity'","mistake_belief_confirmed=false","jurisdiction_confirmed=false"]){
 test('an ineligible counter cannot clear the case: '+changed,async()=>{
  await notice(db);await takeDown(db);await eligible(db);await db.exec('update public.dmca_counter_notices set '+changed);const before=await full();
  await assert.rejects(restore(db));assert.deepEqual(await full(),before);
 });
}
for(const changed of ["court_filing_received=true","status='court_hold'","restore_eligible_at=now()+interval '1 day'","restore_eligible_at='-infinity'"]){
 test('existing case eligibility remains enforced: '+changed,async()=>{
  await notice(db);await takeDown(db);await eligible(db);await db.exec('update public.dmca_cases set '+changed);const before=await full();
  await assert.rejects(restore(db));assert.deepEqual(await full(),before);
 });
}
for(const action of ['takedown','restore'])for(const [table,operation]of [['mydancr_tv_videos','update'],['dmca_cases','update'],['notifications','insert'],['admin_actions','insert'],['dmca_strikes',action==='takedown'?'insert':'update']])for(const body of ["raise exception 'synthetic failure' using errcode='XX000';",'return null;']){
 test(`${action} rolls back all state after ${table} ${body.startsWith('return')?'suppression':'error'}`,async()=>{
  await notice(db);if(action==='restore'){await takeDown(db);await eligible(db);}const before=await full();
  await db.exec(`reset role;create function public.synthetic_dmca_failure()returns trigger language plpgsql as $$begin ${body}end$$;
    create trigger synthetic_dmca_failure before ${operation} on public.${table} for each row execute function public.synthetic_dmca_failure();set role service_role`);
  try{await assert.rejects(action==='takedown'?takeDown(db):restore(db));assert.deepEqual(await full(),before);}
  finally{await db.exec('reset role;drop trigger synthetic_dmca_failure on public.'+table+';drop function public.synthetic_dmca_failure();set role service_role');}
 });
}
for(const role of ['anon','authenticated']){
 test(role+' cannot invoke enforcement writers or inspect private snapshots',async()=>{
  await notice(db);await takeDown(db);await db.exec('set role '+role);
  await assert.rejects(db.query('select * from public.dmca_enforcement_states'),{code:'42501'});
  await assert.rejects(db.query('select public.apply_dmca_takedown($1,$2,null)',[id(200),id(2)]),{code:'42501'});
  await assert.rejects(db.query('select public.restore_dmca_case($1,$2,null)',[id(200),id(2)]),{code:'42501'});
 });
}
test('source deletion retires only its own enforcement snapshot',async()=>{
 await notice(db);await takeDown(db);await db.query('delete from public.mydancr_tv_videos where id=$1',[id(100)]);
 assert.equal((await db.query('select count(*)count from public.dmca_enforcement_states')).rows[0].count,0);
 await eligible(db);const result=await restore(db);assert.equal(result.restorationOutcome,'missing_content');assert.equal(result.contentStatus,null);
});

test('physical account deletion preserves the retained case without recreating removed records',async()=>{
 await notice(db);await takeDown(db);await eligible(db);
 await db.query('delete from public.app_users where id=$1',[id(1)]);
 const before=await snapshot(db);assert.equal(before.dmca_cases[0].uploader_id,null);
 assert.equal(before.dmca_counter_notices.length,0);assert.equal(before.dmca_strikes.length,0);assert.equal(before.mydancr_tv_videos.length,0);
 const result=await restore(db),after=await snapshot(db);
 assert.equal(result.restorationOutcome,'missing_content');assert.equal(result.contentStatus,null);assert.equal(result.uploaderId,null);
 assert.equal(after.dmca_cases[0].status,'restored');assert.equal(after.dmca_strikes.length,0);assert.equal(after.dmca_counter_notices.length,0);
 assert.equal(after.mydancr_tv_videos.length,0);assert.equal(after.dancer_profiles.length,0);assert.deepEqual(after.app_users,before.app_users);
});

for(const changed of ["counter_received_at=null","counter_received_at='infinity'","counter_received_at=now()+interval '1 day'"]){
 test('retained account deletion does not manufacture missing eligibility: '+changed,async()=>{
  await notice(db);await takeDown(db);await eligible(db);await db.query('delete from public.app_users where id=$1',[id(1)]);
  await db.exec('update public.dmca_cases set '+changed);const before=await full();
  await assert.rejects(restore(db));assert.deepEqual(await full(),before);
 });
}

test('missing counter on a retained live account remains an unconfirmed case',async()=>{
 await notice(db);await takeDown(db);await eligible(db);await db.exec('delete from public.dmca_counter_notices');const before=await full();
 await assert.rejects(restore(db));assert.deepEqual(await full(),before);
});

test('a pre-existing administrator hold survives repeat-enforcement and release',async()=>{
 await db.query("update public.dancer_profiles set status='disabled',disabled_at='2026-01-01Z',admin_disabled_at='2026-01-01Z' where id=$1",[id(10)]);
 await three();await eligible(db,200);await restore(db,200);const state=await snapshot(db);
 assert.equal(state.dancer_profiles[0].status,'disabled');assert.ok(state.dancer_profiles[0].admin_disabled_at);
 assert.equal(video(state).status,'hidden');
});
test('snapshot identity stays valid across caller session timezones',async()=>{
 await db.exec("set timezone='Australia/Sydney'");await three();await eligible(db,202);await db.exec("set timezone='America/Los_Angeles'");
 await restore(db,202);const state=await snapshot(db);assert.equal(account(state).account_state,'active');assert.equal(video(state,102).status,'approved');
});
for(const action of ['takedown','restore'])for(const [table,operation]of [['app_users','update'],['dancer_profiles','update'],...(action==='takedown'?[['dmca_enforcement_states','insert']]:[])])for(const body of ["raise exception 'synthetic failure' using errcode='XX000';",'return null;']){
 test(`${action} rolls back repeat-enforcement ${table} ${body.startsWith('return')?'suppression':'error'}`,async()=>{
  if(action==='restore'){await three();await eligible(db,202);}else{for(let n=0;n<2;n++){await notice(db,200+n,100+n);await takeDown(db,200+n);}await notice(db,202,102);}
  const before=await full();
  await db.exec(`reset role;create function public.synthetic_dmca_failure()returns trigger language plpgsql as $$begin ${body}end$$;
    create trigger synthetic_dmca_failure before ${operation} on public.${table} for each row execute function public.synthetic_dmca_failure();set role service_role`);
  try{await assert.rejects(action==='takedown'?takeDown(db,202):restore(db,202));assert.deepEqual(await full(),before);}
  finally{await db.exec('reset role;drop trigger synthetic_dmca_failure on public.'+table+';drop function public.synthetic_dmca_failure();set role service_role');}
 });
}
for(const level of ['repeatable read','serializable']){
 test('unsupported '+level+' cannot use stale cross-case snapshots',async()=>{
  await notice(db);const before=await full();await db.exec('begin isolation level '+level);
  try{await assert.rejects(takeDown(db),{code:'0A000'});}finally{await db.exec('rollback');}
  assert.deepEqual(await full(),before);
 });
}
for(const action of ['takedown','restore'])for(const actor of [id(3),id(999)]){
 test(action+' rejects an unverified administrator identity '+actor,async()=>{
  await notice(db);if(action==='restore'){await takeDown(db);await eligible(db);}const before=await full();
  await assert.rejects(db.query(action==='restore'?'select public.restore_dmca_case($1,$2,null)':'select public.apply_dmca_takedown($1,$2,null)',[id(200),actor]),{code:'42501'});
  assert.deepEqual(await full(),before);
 });
}
test('the scheduled restorer retains its explicitly authorized null administrator',async()=>{
 await notice(db);await takeDown(db);await eligible(db);
 const receipt=(await db.query('select public.restore_dmca_case($1,null,null)result',[id(200)])).rows[0].result;
 assert.equal(receipt.restorationOutcome,'previous_state_restored');assert.equal(video(await snapshot(db)).status,'approved');
});
test('new takedowns never turn a deleted account into a disabled account',async()=>{
 await operatorQuery(db,"update public.app_users set account_state='deleted' where id=$1",[id(1)]);await three();const state=await snapshot(db);
 assert.equal(account(state).account_state,'deleted');assert.equal(account(state).dmca_suspended_at,null);
 assert.equal((await db.query("select count(*)count from public.dmca_enforcement_states where target_type='account'")).rows[0].count,0);
});
for(const current of [44,45]){
 test('repeat-strike restoration retains the actual fifty-video capacity: '+current+' new videos',async()=>{
  await three();
  for(let n=0;n<current;n++)await db.query("insert into public.mydancr_tv_videos(id,dancer_id,submitted_by,caption,storage_path,storage_mime,file_size_bytes,duration_seconds,width,height,status,consent_confirmed,rights_confirmed)values($1,$2,$3,'Synthetic added video',$4,'video/mp4',1024,10,720,1280,'submitted',true,true)",[id(1000+n),id(10),id(1),'synthetic/added-'+n+'.mp4']);
  // Two other cases still hold their videos: four original videos are restored.
  await eligible(db,202);await restore(db,202);const first=await snapshot(db);
  assert.equal(account(first).account_state,'active');
  await eligible(db,200);await restore(db,200);await eligible(db,201);const before=await full();
  if(current===45){await assert.rejects(restore(db,201));assert.deepEqual(await full(),before);}
  else{await restore(db,201);assert.equal((await snapshot(db)).mydancr_tv_videos.filter(v=>v.status!=='hidden').length,50);}
 });
}
