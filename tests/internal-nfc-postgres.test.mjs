import assert from 'node:assert/strict';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { id } from './helpers/internal-nfc-fixture.mjs';
let pg;
before(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table app_users(id uuid primary key,role text,account_state text);
    create table venues(id uuid primary key,owner_user_id uuid references app_users(id),is_active boolean);
    create table internal_roster_links(id uuid primary key,venue_id uuid references venues(id),token uuid,kind text,active boolean);
    grant all on app_users,venues,internal_roster_links to service_role;`);
  await pg.exec(readFileSync(new URL('../supabase/migrations/20261027182550_internal_secure_nfc_access.sql', import.meta.url), 'utf8'));
  await pg.query("insert into app_users values($1,'venue','active'),($2,'admin','active')", [id(4), id(5)]);
  await pg.query('insert into venues values($1,$2,true)', [id(2), id(4)]);
  await pg.query("insert into internal_roster_links values($1,$2,$3,'table',true)", [id(1),id(2),id(3)]);
  await pg.query("insert into internal_nfc_tags(id,link_id,uid,encrypted_keys,generation,created_by) values($1,$2,'04DE5F1EACC040','synthetic',$3,$4)", [id(40),id(1),id(41),id(5)]);
});
beforeEach(async () => pg.exec('begin; set role service_role'));
afterEach(async () => pg.exec('rollback; reset role'));
after(async () => pg?.close());
const tap = async (counter = 61, generation = id(41)) => (await pg.query('select consume_internal_nfc_tap($1,$2,$3) result', [id(40),generation,counter])).rows[0].result;
test('a verified test consumes the counter before activation, then a fresh tap grants active access', async () => {
  assert.equal((await tap()).status, 'staged');
  await pg.exec("update internal_nfc_tags set status='active'");
  assert.equal((await tap(62)).status, 'active');
  assert.equal((await pg.query('select last_counter,verified_at from internal_nfc_tags')).rows[0].last_counter, 62);
});
test('replayed and lower counters are rejected without overwriting the high-water mark', async () => {
  await tap();
  await pg.exec('savepoint rejected');
  await assert.rejects(tap(), /NFC_REPLAY/); await pg.exec('rollback to rejected');
  await assert.rejects(tap(60), /NFC_REPLAY/); await pg.exec('rollback to rejected');
  assert.equal((await pg.query('select last_counter from internal_nfc_tags')).rows[0].last_counter, 61);
});
test('stale provisioning generations cannot consume counters', async () => { await assert.rejects(tap(61,id(99)), /NFC_UNAVAILABLE/); });
for (const [label, sql] of [
  ['disabled sticker', "update internal_nfc_tags set status='disabled'"],
  ['disabled table', 'update internal_roster_links set active=false'],
  ['inactive club', "update internal_nfc_tags set status='active',verified_at=now(); update venues set is_active=false"],
  ['suspended owner', "update internal_nfc_tags set status='active',verified_at=now(); update app_users set account_state='suspended' where role='venue'"],
]) test(`a ${label} cannot issue access`, async () => { await pg.exec(sql); await assert.rejects(tap(), /NFC_UNAVAILABLE/); });
test('activation requires a successful physical verification', async () => { await assert.rejects(pg.exec("update internal_nfc_tags set status='active'"), /check constraint/); });
for (const role of ['anon','authenticated']) test(`${role} cannot read keys or call the counter acceptance function`, async () => {
  await pg.exec(`set role ${role}; savepoint denied`);
  await assert.rejects(pg.exec('select * from internal_nfc_tags'), /permission denied/); await pg.exec('rollback to denied');
  await assert.rejects(tap(), /permission denied/);
});
