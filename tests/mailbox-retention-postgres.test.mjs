import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db;
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema private;grant usage on schema private to service_role;
    create table app_users(id uuid primary key,role text,account_state text,admin_workspace_role text);
    create table compliance_records(id uuid primary key default gen_random_uuid(),kind text,title text,status text,revision int default 1);
    create table content_reports(id uuid primary key,case_kind text,status text,retention_closed_at timestamptz,workflow jsonb default '{}');
    create table support_threads(id uuid primary key,status text,retention_closed_at timestamptz);
    create table safety_media_restrictions(report_id uuid references content_reports(id) on delete cascade);
    insert into app_users values('${id(1)}','admin','active','owner'),('${id(2)}','admin','active','compliance');
    insert into compliance_records(kind,title,status) values('retention','Support and privacy cases','verified'),('retention','Safety decisions and appeals','verified');
    grant select,insert,update,delete on all tables in schema public to service_role;`);
  await db.exec(readFileSync('supabase/migrations/20261101020411_zoho_mailbox_retention.sql', 'utf8'));
});
after(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback'));
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].r;
const enroll = (earlier = null, actor = id(1), search = null) => scalar('select enroll_mailbox_retention($1,$2,$3,$4,$5,$6,$7,$8) r', [actor, 'content_reports', id(3), '7153850000000008002', JSON.stringify([{ messageId: '1793405354839162800', folderId: '100' }]), earlier, earlier ? 'Purpose completed; copy no longer needed.' : '', search]);
const seed = async (category = 'safety', stamp = '2020-02-29T12:00:00Z') => {
  await db.query('insert into content_reports(id,case_kind,status,retention_closed_at) values($1,$2,$3,$4)', [id(3), category, 'resolved', stamp]);
};
const enabled = () => scalar('select set_mailbox_retention($1,true) r', [id(1)]);
const claim = () => scalar("select claim_mailbox_retention('7153850000000008002') r");
const valid = j => scalar('select check_mailbox_retention_lease($1,$2) r', [j.id, j.lease_id]);
const finish = (j, result = 'trashed') => scalar('select finish_mailbox_retention($1,$2,$3,$4) r', [j.id, j.lease_id, result, '200']);

test('calendar deadlines and lossless references; default paused and owner-only enrollment', async () => {
  await seed(); await enroll();
  const j = (await db.query('select * from mailbox_retention_jobs')).rows[0];
  assert.equal(j.maximum_due_at.toISOString(), '2023-02-28T12:00:00.000Z');
  assert.equal(j.message_id, '1793405354839162800'); assert.equal(j.search_phrase, id(3));
  assert.equal(await claim(), null); await enabled();
  await db.exec('set role service_role'); assert.equal((await claim()).id, j.id); await db.exec('reset role');
  await assert.rejects(enroll(null, id(2)), /Owner access/);
});
test('support and privacy use closure plus 24 calendar months', async () => {
  await seed('privacy');
  const ctx = await scalar('select mailbox_case_context($1,$2) r', ['content_reports', id(3)]);
  assert.equal(new Date(ctx.maximumDueAt).toISOString(), '2022-02-28T12:00:00.000Z');
  await db.exec(`insert into support_threads values('${id(4)}','answered',null)`);
  assert.equal(await scalar('select mailbox_case_context($1,$2) r', ['support_threads', id(4)]), null);
});
test('open, missing-clock, future-clock and preservation-marked cases cannot enroll', async () => {
  await seed();
  for (const change of ["status='open'", "status='resolved',retention_closed_at=null", "retention_closed_at=now()+interval '1 day'", "retention_closed_at=now()-interval '1 day',workflow=' {\"preservation\":\"required\"}'::jsonb"]) {
    await db.exec(`savepoint x;update content_reports set ${change}`);
    await assert.rejects(enroll(), /closed case/); await db.exec('rollback to x');
  }
});
test('holds and policy changes invalidate even an already claimed lease', async () => {
  await seed(); await enroll(); await enabled(); const j = await claim(); assert.ok(await valid(j));
  await db.exec("insert into compliance_records(kind,status) values('hold','draft')");
  assert.equal(await valid(j), false); assert.equal(await claim(), null);
  await db.exec("update compliance_records set status='completed' where kind='hold';update compliance_records set revision=2 where kind='retention'");
  assert.equal(await valid(j), false);
});
test('reopening latches review; fresh review cannot restart or extend the original deadline', async () => {
  await seed(); await enroll(); await enabled();
  await db.exec("update content_reports set status='open';update content_reports set status='resolved'");
  assert.equal(await claim(), null); await enroll(); assert.ok(await claim());
  await db.exec("update mailbox_retention_jobs set lease_until=now()-interval '1 second';update content_reports set retention_closed_at=now()-interval '1 day';savepoint x");
  await assert.rejects(enroll(), /Original closure/); await db.exec('rollback to x');
});
test('earlier minimization can shorten but cannot later extend a deadline', async () => {
  await seed(); await enroll('2021-01-01T00:00:00Z');
  await db.exec('savepoint x'); await assert.rejects(enroll(), /Original closure/); await db.exec('rollback to x');
  await enroll('2020-12-01T00:00:00Z');
  assert.equal((await scalar('select due_at r from mailbox_retention_jobs')).toISOString(), '2020-12-01T00:00:00.000Z');
});
test('case deletion preserves mailbox work, but deleting preserved material blocks removal', async () => {
  await seed(); await enroll(); await enabled(); await db.exec('delete from content_reports');
  assert.ok(await claim());
  await db.exec('rollback;begin'); await seed(); await enroll(); await enabled();
  await db.exec(`insert into safety_media_restrictions values('${id(3)}');delete from content_reports`);
  assert.equal(await claim(), null);
});
test('leases prevent duplicate workers, receipts are retry-safe and restored mail keeps its original clock', async () => {
  await seed(); await enroll(); await enabled(); const j = await claim(); assert.equal(await claim(), null);
  assert.equal(await finish({ ...j, lease_id: id(99) }), false); assert.ok(await finish(j)); assert.equal(await finish(j), false);
  const original = await scalar('select first_removed_at r from mailbox_retention_jobs');
  await db.exec("update mailbox_retention_jobs set next_attempt_at=now()-interval '1 second'");
  const repeat = await claim(); assert.ok(await finish(repeat));
  assert.equal((await scalar('select first_removed_at r from mailbox_retention_jobs')).toISOString(), original.toISOString());
  assert.equal(await scalar("select count(*)::int r from mailbox_retention_receipts where outcome='trashed'"), 2);
});
test('recovery references expire only after 90 days and recent confirmed search absence', async () => {
  await seed(); await enroll(); await enabled(); await finish(await claim(), 'absent');
  await db.exec("update mailbox_retention_jobs set first_removed_at=now()-interval '91 days',last_checked_at=now()-interval '5 days'");
  await claim(); assert.equal(await scalar('select count(*)::int r from mailbox_retention_jobs'), 1);
  await db.exec('update mailbox_retention_jobs set last_checked_at=now()'); await claim();
  assert.equal(await scalar('select count(*)::int r from mailbox_retention_jobs'), 0);
});
test('public clients cannot read jobs, write settings or execute retention functions', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const table of ['mailbox_retention_jobs', 'mailbox_retention_receipts', 'mailbox_retention_settings']) {
      assert.equal(await scalar('select has_table_privilege($1,$2,$3) r', [role, table, 'SELECT']), false);
    }
    assert.equal(await scalar("select has_function_privilege($1,'public.preview_mailbox_retention()','EXECUTE') r", [role]), false);
    assert.equal(await scalar("select has_function_privilege($1,'public.claim_mailbox_retention(text)','EXECUTE') r", [role]), false);
  }
  assert.equal(await scalar("select bool_and(relrowsecurity) r from pg_class where relname like 'mailbox_retention_%' and relkind='r'"), true);
});
