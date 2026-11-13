import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createInternalRosterDatabase } from './helpers/internal-roster-database.mjs';
import { fixtureId as id } from './helpers/dancer-tap-database.mjs';

const migration = name => readFileSync(new URL('../supabase/migrations/' + name + '.sql', import.meta.url), 'utf8');

test('legacy labels keep their table numbers, stickers and request history when normalized', async () => {
  const db = await createInternalRosterDatabase();
  try {
    for (const name of ['20260928190000_internal_table_request_push', '20261001190000_internal_alert_recovery',
      '20261018043831_dancer_table_request_notifications', '20261020033002_venue_internal_request_emails']) await db.exec(migration(name));
    await db.query('select public.register_dancer_channel_tap($1,$2,$3,$4,$5)', [id(30), id(1), id(50), 'internal', {}]);
    const labels = ['Training table 002', 'Table 2', 'Retired Table 1 sticker (04281D)', 'VIP booth'];
    for (const [i, label] of labels.entries()) {
      await db.query("insert into public.internal_roster_links(id,venue_id,kind,label,token) values($1,$2,'table',$3,$4)",
        [id(70+i), id(20), label, id(90+i)]);
    }
    await db.query('select public.internal_roster_request($1,$2,$3)', [id(90), id(10), id(80)]);
    await db.exec(migration('20261113034301_canonical_roster_table_labels'));
    const links = (await db.query('select label,token from public.internal_roster_links order by id')).rows;
    assert.deepEqual(links.map(row => row.label), ['Table 2', 'Table 2', 'Table 1', 'Table 3']);
    assert.deepEqual(links.map(row => row.token), labels.map((_, i) => id(90+i)));
    for (const table of ['dancer_table_request_deliveries', 'internal_request_email_deliveries']) {
      assert.deepEqual((await db.query('select distinct table_label from public.' + table)).rows, [{ table_label: 'Table 2' }]);
    }
    const inbox = (await db.query("select body,payload from public.notifications where payload->>'kind'='dancer_table_request'")).rows;
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].payload.tableLabel, 'Table 2');
    assert.match(inbox[0].body, /^Table 2 at /);
    await assert.rejects(db.query("update public.internal_roster_links set label='Training table 2' where id=$1", [id(70)]), /internal_roster_table_label_number/);
  } finally { await db.close(); }
});
