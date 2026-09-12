import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260912232600_preserve_club_shuttle_requests.sql', import.meta.url), 'utf8');
const narrowGrants = readFileSync(new URL('../supabase/migrations/20260913000500_narrow_shuttle_service_grants.sql', import.meta.url), 'utf8');
const id = n => `95000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role',true)$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table public.notifications(id uuid primary key, recipient_id uuid not null,
      notification_type text,channel text,title text,body text,payload jsonb);
    grant all on public.notifications to service_role;
    alter default privileges in schema public grant all on tables to service_role;`);
  await db.exec(migration);
  await db.exec(narrowGrants);
  const rows = [1,2].map(n => ({ id:id(n+10),recipient_id:id(n),title:'Synthetic shuttle',body:'Synthetic pickup',payload:{kind:'club_shuttle_request',requestId:id(20)} }));
  await db.query(`insert into public.club_shuttle_requests(id,venue_id,details_hash,notification_rows)
    values($1,$2,repeat('a',64),$3)`, [id(20),id(30),JSON.stringify(rows)]);
  await db.exec("set role service_role; set request.jwt.claim.role='service_role'");
  return { db, rows, handoff: async () => (await db.query('select public.handoff_club_shuttle_request($1) as result',[id(20)])).rows[0].result };
}

test('shuttle handoff is atomic, durable, replayable, and survives notification deletion', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.handoff()).newly_handed_off, true);
    assert.equal((await f.db.query('select count(*)::int n from notifications')).rows[0].n, 2);
    await f.db.exec('delete from notifications');
    assert.equal((await f.handoff()).newly_handed_off, false);
    assert.equal((await f.db.query('select count(*)::int n from notifications')).rows[0].n, 0);
    assert.equal((await f.db.query('select count(*)::int n from club_shuttle_requests')).rows[0].n, 1);
  } finally { await f.db.close(); }
});

test('a conflicting inbox record rolls back the complete handoff but retains the primary request', async () => {
  const f = await fixture();
  try {
    await f.db.query('insert into notifications(id,recipient_id,body,payload) values($1,$2,$3,$4)',[id(12),id(2),'Other','{}']);
    await assert.rejects(f.handoff(), e => e.code === '23505');
    assert.equal((await f.db.query('select count(*)::int n from notifications')).rows[0].n, 1);
    assert.equal((await f.db.query('select handed_off_at from club_shuttle_requests')).rows[0].handed_off_at, null);
    await f.db.exec('delete from notifications');
    assert.equal((await f.handoff()).newly_handed_off, true);
  } finally { await f.db.close(); }
});

test('browser roles cannot read, change, delete or hand off private shuttle requests', async () => {
  const f = await fixture();
  try {
    for (const role of ['anon','authenticated']) {
      await f.db.exec(`reset role; set role ${role}; set request.jwt.claim.role='${role}'`);
      for (const sql of ['select * from club_shuttle_requests','delete from club_shuttle_requests','update club_shuttle_requests set handed_off_at=now()',`select handoff_club_shuttle_request('${id(20)}')`]) {
        await assert.rejects(f.db.exec(sql),e=>e.code==='42501');
      }
    }
    await f.db.exec("reset role; set role service_role; set request.jwt.claim.role='service_role'");
    await assert.rejects(f.db.exec('delete from club_shuttle_requests'),e=>e.code==='42501');
    await assert.rejects(f.db.exec("update club_shuttle_requests set details_hash=repeat('b',64)"),e=>e.code==='42501');
  } finally { await f.db.close(); }
});
