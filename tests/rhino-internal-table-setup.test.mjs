import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';

const setup = readFileSync(new URL('../scripts/setup-rhino-internal-table.sql', import.meta.url), 'utf8');
const venue = '103e9b1b-77b5-43d2-9eb8-88aa11ed906d';

async function fixture(t) {
  const db = await createInternalRosterDatabase();
  t.after(() => db.close());
  await db.query('insert into auth.users values($1)', [id(7)]);
  await db.query("insert into public.app_users(id,role,account_state) values($1,'venue','active')", [id(7)]);
  await db.query(`insert into public.venues(id,name,slug,city,owner_user_id,is_active,timezone)
    values($1,'Spearmint Rhino','spearmint-rhino','Las Vegas',$2,true,'America/Los_Angeles')`, [venue, id(7)]);
  await db.query("insert into public.internal_roster_links(venue_id,kind,label) values($1,'table','Other club table')", [id(20)]);
  return db;
}

const snapshot = async db => (await db.query('select * from public.internal_roster_links order by id')).rows;

test('Rhino setup creates one usable table, preserves other clubs, and safely replays', async t => {
  const db = await fixture(t);
  const other = await snapshot(db);
  await db.exec(setup);
  const rows = await snapshot(db);
  assert.deepEqual(rows.filter(row => row.venue_id !== venue), other);
  const own = rows.filter(row => row.venue_id === venue);
  assert.equal(own.length, 1);
  assert.equal(own[0].label, 'Table 1');
  assert.equal(own[0].kind, 'table');
  assert.equal(own[0].active, true);
  assert.match(own[0].token, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(own[0].token, own[0].id);
  await db.exec(setup);
  assert.deepEqual(await snapshot(db), rows);
  await db.query("update public.internal_roster_links set label='Lounge' where venue_id=$1", [venue]);
  const renamed = await snapshot(db);
  await db.exec(setup);
  assert.deepEqual(await snapshot(db), renamed);
});

test('Rhino setup fails closed for changed club identity, inactive club or owner', async t => {
  const db = await fixture(t);
  const before = await snapshot(db);
  for (const change of [
    `update public.venues set slug='different-club' where id='${venue}'`,
    `update public.venues set is_active=false where id='${venue}'`,
    `update public.app_users set account_state='disabled' where id='${id(7)}'`,
  ]) {
    await db.exec('begin; ' + change);
    await assert.rejects(db.exec(setup), /Expected the active Spearmint Rhino club and owner/);
    await db.exec('rollback');
    assert.deepEqual(await snapshot(db), before);
  }
});

test('Rhino setup cannot recreate a revoked table or replace a legacy display link', async t => {
  const db = await fixture(t);
  for (const kind of ['table', 'display']) {
    await db.query("insert into public.internal_roster_links(venue_id,kind,label,active) values($1,$2,'Disabled',false)", [venue, kind]);
    const before = await snapshot(db);
    await assert.rejects(db.exec(setup), /Existing inactive or legacy Rhino links require Admin review/);
    await db.exec('rollback');
    assert.deepEqual(await snapshot(db), before);
    await db.query('delete from public.internal_roster_links where venue_id=$1', [venue]);
  }
});
