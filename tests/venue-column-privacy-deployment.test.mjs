import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {before,after,test} from 'node:test';
import {createAccountLifecycleDatabase,seedAccountLifecycle} from './helpers/account-lifecycle-database.mjs';
import {buildVenuePrivacyDeployment,venuePrivacyTargetSql,venuePrivacyVersion} from './helpers/venue-column-privacy-deployment.mjs';
const source=readFileSync(new URL('../supabase/migrations/20260912123000_minimize_public_venue_review_columns.sql',import.meta.url),'utf8');
let db;
before(async()=>{db=await createAccountLifecycleDatabase();await seedAccountLifecycle(db,{role:'venue'});});
after(async()=>db?.close());
const target=async()=>(await db.query(venuePrivacyTargetSql+' as target')).rows[0].target;
const ledger=async()=>Number((await db.query('select count(*)n from supabase_migrations.schema_migrations')).rows[0].n);
test('venue privacy applies after the atomic account foundation without changing other objects or records',async()=>{
  const expectedTarget=await target(),sql=buildVenuePrivacyDeployment({source,expectedTarget});
  const result=await db.exec(sql.replace(/commit;\s*$/,'rollback;'));
  const receipt=result.flatMap(r=>r.rows||[]).find(r=>r.release)?.release;
  assert.equal(receipt.public_columns,20);assert.equal(receipt.private_columns,10);assert.equal(receipt.records_preserved,true);assert.equal(receipt.metadata_preserved,true);
  assert.equal(await ledger(),0);assert.deepEqual(await target(),expectedTarget);
});
for(const [name,afterSql,message]of [
  ['venue record mutation',"update public.venues set city='Changed'",'VENUE_PRIVACY_RECORDS_CHANGED'],
  ['lost service SELECT','revoke select on public.venues from service_role','VENUE_PRIVACY_METADATA_CHANGED'],
  ['lost unrelated account grant','revoke select on public.app_users from service_role','VENUE_PRIVACY_METADATA_CHANGED'],
  ['removed public venue field','revoke select(name)on public.venues from anon','VENUE_PRIVACY_PROJECTION_MISMATCH'],
  ['private field regrant','grant select(page_review_notes)on public.venues to anon','VENUE_PRIVACY_PROJECTION_MISMATCH'],
  ['legacy service publication regrant','grant update(is_active)on public.venues to service_role','VENUE_PRIVACY_METADATA_CHANGED'],
  ['review write authority changed','revoke update on public.venues from authenticated','VENUE_PRIVACY_METADATA_CHANGED'],
  ['row policy changed','alter table public.venues disable row level security','VENUE_PRIVACY_METADATA_CHANGED'],
])test(`venue deployment rolls back ${name}`,async()=>{
  const expectedTarget=await target();await assert.rejects(db.exec(buildVenuePrivacyDeployment({source,expectedTarget,after:afterSql+';'})),new RegExp(message));
  await db.exec('rollback');assert.equal(await ledger(),0);assert.deepEqual(await target(),expectedTarget);
});
test('venue deployment refuses stale ACL metadata before execution',async()=>{
  const expectedTarget=await target();await db.exec('grant select(page_review_notes)on public.venues to anon');
  await assert.rejects(db.exec(buildVenuePrivacyDeployment({source,expectedTarget})),/VENUE_PRIVACY_ACCESS_DRIFT/);
  await db.exec('rollback;revoke select(page_review_notes)on public.venues from anon');assert.equal(await ledger(),0);
});
test('inherited internal venue field access prevents application',async()=>{
  await db.exec('create role synthetic_venue_reader;grant select(page_review_notes)on public.venues to synthetic_venue_reader;grant synthetic_venue_reader to anon');
  await assert.rejects(db.exec(buildVenuePrivacyDeployment({source,expectedTarget:await target()})),/PUBLIC_VENUE_ACCESS_MISMATCH/);
  await db.exec('rollback;revoke synthetic_venue_reader from anon;revoke select(page_review_notes)on public.venues from synthetic_venue_reader');assert.equal(await ledger(),0);
});
test('venue migration ledger records the exact committed body and rejects replay',async()=>{
  await db.exec(buildVenuePrivacyDeployment({source,expectedTarget:await target()}));
  const row=(await db.query("select version,md5(array_to_string(statements,E'\\n'))hash from supabase_migrations.schema_migrations")).rows[0];
  assert.equal(row.version,venuePrivacyVersion);assert.equal(row.hash,createHash('md5').update(source.replaceAll('\r\n','\n')).digest('hex'));
  await assert.rejects(db.exec(buildVenuePrivacyDeployment({source,expectedTarget:await target()})),/VENUE_PRIVACY_ALREADY_APPLIED/);await db.exec('rollback');assert.equal(await ledger(),1);
});
