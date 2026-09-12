import assert from 'node:assert/strict';
import test,{before,after,beforeEach,afterEach} from 'node:test';
import {database,seed,notice,id,schema} from './helpers/dmca-lifecycle-database.mjs';
import {dmcaMetadataSql,dmcaRecordsSql,dmcaTargetSql,dmcaEffectsSql,dmcaLedgerSql,expectedDmcaTarget,draftDmcaSource,buildDmcaDeployment,dmcaSignatures} from './helpers/dmca-lifecycle-deployment.mjs';
let db,effects,target,wrapper,expectedLedger;
const version='20990101000000',name='preserve_owned_dmca_lifecycle_states';
const tables=schema.scope.fullTargets.map(t=>'public.'+t);
const value=async sql=>Object.values((await db.query(sql)).rows[0])[0];
before(async()=>{
 db=await database();
 await db.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations values('20260901000000','synthetic_prior',array['select 1;']);set search_path=pg_catalog,public,pg_temp;");
 await seed(db);await db.exec('reset role');
 expectedLedger=await value(dmcaLedgerSql);
 target=await value(dmcaTargetSql);
 // Every captured group must be equal except the explicitly inspected PG17/18
 // constraint-expression rendering differences recorded alongside the run.
 for(const key of Object.keys(target))if(key!=='constraints')assert.deepEqual(target[key],expectedDmcaTarget[key],key);
 assert.equal(target.constraints.length,expectedDmcaTarget.constraints.length);
 for(let i=0;i<target.constraints.length;i++){
  assert.deepEqual([target.constraints[i][0],target.constraints[i][1],target.constraints[i][3]],[expectedDmcaTarget.constraints[i][0],expectedDmcaTarget.constraints[i][1],expectedDmcaTarget.constraints[i][3]]);
  if(target.constraints[i][0]==='mydancr_tv_videos'&&target.constraints[i][1]==='mydancr_tv_dimensions_check'){
   assert.equal(expectedDmcaTarget.constraints[i][2],'CHECK ((((width >= 240) AND (width <= 4320)) AND ((height >= width) AND (height <= 7680))))');
   assert.equal(target.constraints[i][2],'CHECK (((width >= 240) AND (width <= 4320) AND ((height >= width) AND (height <= 7680))))');
  }else assert.equal(target.constraints[i][2],expectedDmcaTarget.constraints[i][2]);
 }
 await db.exec('begin');await db.exec(draftDmcaSource.replace('\nbegin;','\n').replace(/commit;\s*$/,''));effects=await value(dmcaEffectsSql);
 for(const signature of dmcaSignatures){
  for(const role of ['anon','authenticated','service_role']){
   const allowed=(await db.query('select has_function_privilege($1,$2,\'EXECUTE\')allowed',[role,signature])).rows[0].allowed;
   assert.equal(allowed,role==='service_role'&&!signature.includes('invalidate_'),role+' '+signature);
  }
 }
 for(const [,hash,owner,acl,definer,settings]of effects.functions){assert.match(hash,/^[a-f0-9]{32}$/);assert.equal(owner,'postgres');assert.ok(acl);assert.equal(typeof definer,'boolean');assert.ok(settings.includes('search_path=""'));}
 assert.equal(effects.functions.filter(f=>f[4]).length,6);
 for(const role of ['anon','authenticated','service_role'])for(const right of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
  assert.equal((await db.query('select has_table_privilege($1,$2,$3)allowed',[role,'public.dmca_enforcement_states',right])).rows[0].allowed,role==='service_role'&&['SELECT','INSERT','UPDATE','DELETE'].includes(right));
 }
 await db.exec('rollback');
 assert.equal(effects.functions.length,6);assert.equal(effects.triggers.length,3);assert.equal(effects.table.rls,true);assert.equal(effects.table.force,false);assert.equal(effects.table.policies,0);
 wrapper=buildDmcaDeployment({source:draftDmcaSource,version,name,effects,tables,target,expectedLedger});
});
after(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
function nested(sql=wrapper){return sql.replace(/^begin;/,'savepoint dmca_trial;').replace(/commit;\s*$/,'release savepoint dmca_trial;');}
async function fails(sql=wrapper,expected='DMCA_LEDGER_CHANGED_OR_ALREADY_APPLIED'){await assert.rejects(db.exec(nested(sql)),error=>error.message===expected);await db.exec('rollback to savepoint dmca_trial');}
test('guarded migration preserves existing state and records exactly its source once',async()=>{
 const before=await value(dmcaMetadataSql);await db.exec(nested());const post=await value(dmcaEffectsSql);assert.deepEqual(post,effects);
 const ledger=(await db.query('select version,name,statements from supabase_migrations.schema_migrations order by version')).rows;
 assert.equal(ledger.length,2);assert.equal(ledger[1].name,name);assert.equal(ledger[1].statements[0],draftDmcaSource);
 const after=await value(dmcaMetadataSql);const {ledger:_,...a}=before,{ledger:__,...b}=after;assert.deepEqual(a,b);
 await fails();assert.deepEqual(await value(dmcaEffectsSql),effects);
});
for(const sql of [
 "alter table public.dancer_profiles add column synthetic_drift text",
 "grant update(status)on public.dancer_profiles to authenticated",
 "grant references on public.app_users to authenticated",
 "revoke maintain on public.dmca_cases from service_role",
 "revoke select(stage_name)on public.dancer_profiles from anon",
 "alter table public.dmca_cases disable row level security",
 "alter table public.dmca_cases drop constraint dmca_cases_uploader_id_fkey",
 "alter table public.dmca_cases add constraint synthetic_check check(true)",
 "revoke execute on function public.apply_dmca_takedown(uuid,uuid,text)from service_role",
 "alter function public.restore_dmca_case(uuid,uuid,text)set search_path=public,pg_temp",
 "create function public.transition_dmca_admin_case(uuid,uuid,text,text,timestamptz,text)returns jsonb language sql as $$select '{}'::jsonb$$",
 "create table public.dmca_enforcement_states(id uuid)",
 "insert into supabase_migrations.schema_migrations values('20990101000001','newer',array['select 2;'])"
]){
 test('preflight rejects current schema/access/ledger drift: '+sql.split(' ').slice(0,5).join(' '),async()=>{
  await db.exec(sql);const before=await value(dmcaMetadataSql);
  const expected=sql.startsWith('insert into')?'DMCA_LEDGER_CHANGED_OR_ALREADY_APPLIED':sql.startsWith('create')?'DMCA_UNEXPECTED_NEW_OBJECT':sql.startsWith('alter function')||sql.startsWith('revoke execute')?'DMCA_DEPENDENCY_DRIFT':'DMCA_SCHEMA_ACCESS_DRIFT';
  await fails(wrapper,expected);assert.deepEqual(await value(dmcaMetadataSql),before);
 });
}
test('existing copyright cases require a separate transition plan',async()=>{
 await notice(db);const before=await value(dmcaMetadataSql);await fails(wrapper,'DMCA_EXISTING_ENFORCEMENT_REQUIRES_SEPARATE_TRANSITION');assert.deepEqual(await value(dmcaMetadataSql),before);
 assert.equal((await db.query('select count(*)count from public.dmca_cases')).rows[0].count,1);
});
for(const change of ["update supabase_migrations.schema_migrations set name='unexpected'","update supabase_migrations.schema_migrations set statements=array['select 2;']","insert into supabase_migrations.schema_migrations values('20260801000000','unexpected_older',array['select 3;'])"]){
 test('captured ledger rejects prior history drift: '+change,async()=>{
  await db.exec(change);const before=await value(dmcaMetadataSql);await fails(wrapper,'DMCA_CAPTURED_LEDGER_CHANGED');assert.deepEqual(await value(dmcaMetadataSql),before);
 });
}
test('captured historical entries with unavailable SQL remain unchanged without invented hashes',async()=>{
 await db.exec('update supabase_migrations.schema_migrations set statements=null');
 const historical=await value(dmcaLedgerSql);assert.equal(historical[0].sql_md5,null);
 await db.exec(nested(buildDmcaDeployment({source:draftDmcaSource,version,name,effects,tables,target,expectedLedger:historical})));
 assert.deepEqual((await value(dmcaLedgerSql)).filter(row=>row.version!==version),historical);
 assert.equal((await db.query("select statements from supabase_migrations.schema_migrations where version='20260901000000'")).rows[0].statements,null);
});
for(const table of ['app_users','dancer_profiles']){
 test('existing '+table+' copyright suspension requires a separate transition plan',async()=>{
  await db.exec('update public.'+table+" set dmca_suspended_at=now()");await fails(wrapper,'DMCA_EXISTING_ENFORCEMENT_REQUIRES_SEPARATE_TRANSITION');
  assert.ok((await db.query('select count(*)count from public.'+table+' where dmca_suspended_at is not null')).rows[0].count>0);
 });
}
for(const injected of [
 "update public.app_users set display_name='unexpected mutation'",
 "grant select on public.dmca_enforcement_states to anon",
 "grant execute on function public.invalidate_dmca_enforcement_state()to service_role",
 "alter table public.dmca_enforcement_states disable row level security",
 "create policy synthetic_leak on public.dmca_enforcement_states for select to anon using(true)",
 "drop trigger invalidate_dmca_video_enforcement on public.mydancr_tv_videos",
 "alter table public.dmca_enforcement_states add column synthetic_drift text",
 "alter function public.restore_dmca_case(uuid,uuid,text)set search_path=public,pg_temp",
 "alter table public.notifications add column synthetic_unrelated text",
 "create function public.synthetic_unrelated()returns integer language sql as $$select 1$$",
 "update supabase_migrations.schema_migrations set name='tampered'",
 "alter default privileges in schema public grant all on tables to anon"
]){
 test('postflight rolls back unexpected effects: '+injected.split(' ').slice(0,6).join(' '),async()=>{
  const before=await value(dmcaMetadataSql);
  const expected=injected.startsWith('update public.app_users')?'DMCA_RECORDS_CHANGED':/notifications|synthetic_unrelated|supabase_migrations|default privileges/.test(injected)?'DMCA_UNRELATED_METADATA_CHANGED':'DMCA_NEW_EFFECTS_MISMATCH';
  await fails(buildDmcaDeployment({source:draftDmcaSource,version,name,effects,tables,target,expectedLedger,after:injected+';'}),expected);assert.deepEqual(await value(dmcaMetadataSql),before);
  assert.equal((await db.query("select to_regclass('public.dmca_enforcement_states')object")).rows[0].object,null);
 });
}
test('broad inherited table privileges do not leak the private snapshot table',async()=>{
 await db.exec('alter default privileges in schema public grant all on tables to anon,authenticated,service_role');await db.exec(nested());
 for(const role of ['anon','authenticated']){
  for(const right of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await db.query('select has_table_privilege($1,$2,$3)allowed',[role,'public.dmca_enforcement_states',right])).rows[0].allowed,false);
 }
 for(const right of ['TRUNCATE','REFERENCES','TRIGGER'])assert.equal((await db.query('select has_table_privilege($1,$2,$3)allowed',['service_role','public.dmca_enforcement_states',right])).rows[0].allowed,false);
});

async function widePreservationTables(){
 const extra=Array.from({length:81},(_,n)=>'public.synthetic_preserved_'+String.fromCharCode(97+Math.floor(n/26))+String.fromCharCode(97+n%26));
 await db.exec(extra.map((relation,n)=>'create table '+relation+'(id integer primary key,value text);insert into '+relation+" values(1,'synthetic "+n+"'),(2,null);").join('\n'));
 return [...tables,...extra];
}
test('a preservation scope larger than PostgreSQL argument limit checks all tables',async()=>{
 const wide=await widePreservationTables(),before=await value(dmcaRecordsSql(wide));assert.equal(Object.keys(before).length,tables.length+81);
 for(const name of wide.slice(tables.length))assert.equal(before[name].count,2);
 await db.exec(nested(buildDmcaDeployment({source:draftDmcaSource,version,name,effects,tables:wide,target,expectedLedger})));
 assert.deepEqual(await value(dmcaRecordsSql(wide)),before);assert.deepEqual(await value(dmcaEffectsSql),effects);
});
test('an altered row in the last preservation group rolls back the entire deployment',async()=>{
 const wide=await widePreservationTables(),before=await value(dmcaRecordsSql(wide));
 await fails(buildDmcaDeployment({source:draftDmcaSource,version,name,effects,tables:wide,target,expectedLedger,after:'update '+wide.at(-1)+" set value='unexpected change' where id=1;"}),'DMCA_RECORDS_CHANGED');
 assert.deepEqual(await value(dmcaRecordsSql(wide)),before);assert.equal((await db.query("select to_regclass('public.dmca_enforcement_states')value")).rows[0].value,null);
});
test('preservation scope rejects empty, duplicate and untrusted relation text',()=>{
 for(const invalid of [[],['public.app_users','public.app_users'],['public.app_users;delete from public.app_users'],['public.app_users where true'],['untrusted.app_users']])assert.throws(()=>dmcaRecordsSql(invalid));
});
test('actual outer COMMIT records the source, drops temporary captures and rejects replay',async()=>{
 const committed=await database();
 try{
  await committed.exec("create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);insert into supabase_migrations.schema_migrations values('20260901000000','synthetic_prior',array['select 1;']);set search_path=pg_catalog,public,pg_temp");await seed(committed);await committed.exec('reset role');
  const committedTarget=Object.values((await committed.query(dmcaTargetSql)).rows[0])[0];assert.deepEqual(committedTarget,target);
  const actual=buildDmcaDeployment({source:draftDmcaSource,version,name,effects,tables,target:committedTarget,expectedLedger});await committed.exec(actual);
  const check=async()=>{
   assert.deepEqual(Object.values((await committed.query(dmcaEffectsSql)).rows[0])[0],effects);
   const entries=(await committed.query('select version,statements from supabase_migrations.schema_migrations order by version')).rows;assert.equal(entries.length,2);assert.equal(entries[1].statements[0],draftDmcaSource);
   assert.equal((await committed.query("select to_regclass('pg_temp.dmca_metadata_before')metadata,to_regclass('pg_temp.dmca_records_before')records")).rows[0].metadata,null);
   assert.equal((await committed.query("select to_regclass('pg_temp.dmca_records_before')records")).rows[0].records,null);
  };
  await check();await assert.rejects(committed.exec(actual),error=>error.message==='DMCA_LEDGER_CHANGED_OR_ALREADY_APPLIED');await committed.exec('rollback');await check();
 }finally{await committed.close();}
});
