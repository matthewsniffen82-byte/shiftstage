import test,{before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAgentDatabase,seedAgents,insertAgentChain,assignAgent,agentSnapshot,agentId} from './helpers/agent-hierarchy-database.mjs';
const migration=readFileSync(new URL('../supabase/migrations/20260912084000_require_finite_attribution_times.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
let db;
before(async()=>{db=await createAgentDatabase();await db.exec(migration);});
after(async()=>db?.close());
beforeEach(async()=>{await seedAgents(db);await insertAgentChain(db);});
for(const value of ['infinity','-infinity']) {
  test('initial assignment rejects '+value+' without adding attribution or audit',async()=>{
    const before=await agentSnapshot(db);await assert.rejects(assignAgent(db,{effective:value}),e=>e.code==='23514'&&e.constraint==='venue_sales_attributions_finite_times_check');assert.deepEqual(await agentSnapshot(db),before);
  });
  test('replacing a valid assignment with '+value+' cannot supersede its history',async()=>{
    await assignAgent(db);const before=await agentSnapshot(db);await assert.rejects(assignAgent(db,{effective:value}));assert.deepEqual(await agentSnapshot(db),before);
  });
  for(const field of ['effective_from','superseded_at'])test('direct '+field+' update to '+value+' is rejected',async()=>{
    await assignAgent(db);const before=await agentSnapshot(db);await assert.rejects(db.query('update public.venue_sales_attributions set '+field+'=$1',[value]),e=>e.code==='23514');assert.deepEqual(await agentSnapshot(db),before);
  });
}
test('finite assignment windows retain the ancestor snapshot, exact microseconds and audit',async()=>{
  await assignAgent(db,{effective:'2026-09-12T09:00:00.123456+05:45'});
  await assignAgent(db,{effective:'2026-09-12T03:15:00.123457Z'});
  const rows=(await db.query('select effective_from::text,superseded_at::text,sponsor_level_5_agent_id from public.venue_sales_attributions order by effective_from')).rows;
  assert.equal(rows.length,2);assert.match(rows[0].effective_from,/\.123456/);assert.match(rows[0].superseded_at,/\.123457/);assert.match(rows[1].effective_from,/\.123457/);assert.equal(rows[1].superseded_at,null);assert.equal(rows[1].sponsor_level_5_agent_id,agentId(15));
  assert.equal((await agentSnapshot(db)).audit.length,2);
});
test('an invalid approval timestamp cannot leave an approved request or attribution',async()=>{
  await db.exec('reset role');await db.query("insert into public.venue_signup_requests(id,status,referring_agent_id,matched_venue_id,reviewed_by,reviewed_at)values($1,'pending',$2,$3,$4,null)",[agentId(900),agentId(10),agentId(100),agentId(1)]);
  const before=await agentSnapshot(db);
  await assert.rejects(db.exec("update public.venue_signup_requests set status='approved',reviewed_at='infinity'"),e=>e.code==='23514');assert.deepEqual(await agentSnapshot(db),before);
});
test('service-only access and all deployed assignment definitions remain unchanged',async()=>{
  await db.exec('reset role');
  const rows=(await db.query("select md5(pg_get_functiondef(oid))hash,proacl::text acl from pg_proc where oid='public.assign_admin_venue_sales_agent(uuid,uuid,uuid,text,timestamptz)'::regprocedure")).rows;
  assert.equal(rows[0].hash,'5b90232f8c2996747f2adae61b628a8c');assert.equal(rows[0].acl,'{postgres=X/postgres,service_role=X/postgres}');
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(assignAgent(db),e=>e.code==='42501');await db.exec('reset role');}
});
test('old schema accepts infinity and then blocks a later finite replacement',async()=>{
  const old=await createAgentDatabase();try{await seedAgents(old);await insertAgentChain(old);await assignAgent(old,{effective:'infinity'});await assert.rejects(assignAgent(old,{effective:'2027-01-01T00:00:00Z'}),e=>e.code==='22023');assert.equal((await agentSnapshot(old)).attributions[0].effective_from,'infinity');}finally{await old.close();}
});
test('migration refuses existing non-finite history without changing it',async()=>{
  const old=await createAgentDatabase();try{await seedAgents(old);await insertAgentChain(old);await assignAgent(old,{effective:'infinity'});await old.exec('reset role');const before=await agentSnapshot(old);try{await assert.rejects(old.exec(migration),e=>e.code==='23514');}finally{await old.exec('rollback');}assert.deepEqual(await agentSnapshot(old),before);assert.equal((await old.query("select count(*)::int n from pg_constraint where conrelid='public.venue_sales_attributions'::regclass and conname='venue_sales_attributions_finite_times_check'")).rows[0].n,0);}finally{await old.close();}
});
