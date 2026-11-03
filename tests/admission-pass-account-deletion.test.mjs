import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261103080039_allow_dancer_deletion_from_admission_passes.sql', import.meta.url), 'utf8');
const id = n => '98000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('Auth can delete its account without gaining access to application tables', async () => {
  const pg = await fixture();
  try {
    const before = (await pg.query('select * from qr_redemptions')).rows[0];
    await pg.exec('alter table accounts owner to supabase_auth_admin; set role supabase_auth_admin');
    await assert.rejects(pg.exec('select * from dancer_profiles'), e=>e.code==='42501');
    await pg.query('delete from accounts where id=$1', [id(1)]);
    await pg.exec('reset role');
    assert.deepEqual((await pg.query('select * from qr_redemptions')).rows[0], {...before,dancer_id:null,shift_id:null});
  } finally { await pg.close(); }
});


async function fixture() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
    create table accounts(id uuid primary key);
    create table dancer_profiles(id uuid primary key, user_id uuid references accounts on delete cascade);
    create table shifts(id uuid primary key, dancer_id uuid references dancer_profiles on delete cascade);
    create table qr_redemptions(
      id integer primary key, admission_pass_version smallint, arrival_method text, expires_at timestamptz,
      venue_id uuid, club_deal_id uuid, customer_id uuid, session_id uuid, redemption_token text, source_type text,
      dancer_id uuid references dancer_profiles on delete set null, shift_id uuid references shifts on delete set null,
      audit jsonb, status text, redeemed_at timestamptz, redeemed_by_user_id uuid, arrival_verified_at timestamptz
    );
    grant all on all tables in schema public to service_role,authenticated;
  `);
  await pg.exec(migration);
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261103080227_preserve_auth_role_dancer_deletion.sql', import.meta.url), 'utf8'));
  await pg.exec('create trigger protect_admission_pass before insert or update on qr_redemptions for each row execute function protect_admission_pass()');
  await pg.query('insert into accounts values($1);', [id(1)]);
  await pg.query('insert into dancer_profiles values($1,$2)', [id(2),id(1)]);
  await pg.query('insert into shifts values($1,$2)', [id(3),id(2)]);
  await pg.query(`insert into qr_redemptions values(1,1,'self_drive',now()+interval '1 day',
    $1,$1,$1,$1,'private-token','dancer_profile',$2,$3,'{"source":"profile"}','redeemed',now(),$1,now())`,
    [id(4),id(2),id(3)]);
  return pg;
}

test('account cascade clears dancer and shift attribution while preserving the complete guest pass', async () => {
  const pg = await fixture();
  try {
    const before = (await pg.query('select * from qr_redemptions')).rows[0];
    await pg.exec('set role service_role');
    await pg.query('delete from accounts where id=$1', [id(1)]);
    const after = (await pg.query('select * from qr_redemptions')).rows[0];
    assert.deepEqual(after, {...before, dancer_id:null, shift_id:null});
    assert.equal((await pg.query('select count(*)::integer n from dancer_profiles')).rows[0].n,0);
    assert.equal((await pg.query('select count(*)::integer n from shifts')).rows[0].n,0);
  } finally { await pg.close(); }
});

test('deleting a shift preserves its dancer attribution', async () => {
  const pg = await fixture();
  try {
    const before = (await pg.query('select * from qr_redemptions')).rows[0];
    await pg.query('delete from shifts where id=$1',[id(3)]);
    assert.deepEqual((await pg.query('select * from qr_redemptions')).rows[0], {...before,shift_id:null});
  } finally { await pg.close(); }
});

test('direct attribution, pass details and recorded admission edits remain prohibited', async () => {
  const pg = await fixture();
  try {
    const before = (await pg.query('select * from qr_redemptions')).rows[0];
    for (const change of ['dancer_id=null','shift_id=null',"source_type='club_page'","audit='{}'","status='generated'"]) {
      await assert.rejects(pg.exec('update qr_redemptions set '+change+' where id=1'), e=>e.code==='42501');
    }
    await pg.exec('set role authenticated');
    await assert.rejects(pg.exec("update qr_redemptions set status='redeemed' where id=1"), e=>e.code==='42501');
    await pg.exec('reset role');
    assert.deepEqual((await pg.query('select * from qr_redemptions')).rows[0],before);
  } finally { await pg.close(); }
});

