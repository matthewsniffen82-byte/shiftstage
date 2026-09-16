import assert from 'node:assert/strict';
import test from 'node:test';
import { pickupFixture, pickupId as id } from './helpers/pickup-fixture.mjs';

const migrations = ['20260914190000_club_pickup_domain.sql', '20260914191000_club_pickup_security_commands.sql',
  '20260914192000_club_pickup_inbox_queries.sql', '20260914194000_club_pickup_arrival_attribution.sql',
  '20260914195000_harden_pickup_transitions.sql', '20260915180000_guest_pickup_chat.sql',
  '20260916010000_guest_pickup_unread_count.sql'];
const key = n => n.toString(16).padStart(64, '0');
async function fixture() {
  const f = await pickupFixture(migrations);
  await f.asUser(3); await f.db.query('select pickup_set_enabled($1,true)', [id(10)]);
  const service = () => f.asUser(null, 'service_role');
  const create = async (n = 20, k = n, rate = 1, venue = 10) => {
    await service();
    return (await f.db.query("select pickup_guest_create($1,$2,$3,$4,'Test hotel lobby',2,'pickup-chat-v1') id",
      [id(n), key(k), key(rate), id(venue)])).rows[0].id;
  };
  const get = async (n = 20, k = n, before = null) => {
    await service(); return (await f.db.query('select pickup_guest_get($1,$2,$3) detail', [id(n), key(k), before])).rows[0].detail;
  };
  const command = async (name, args = {}, n = 20, k = n) => {
    await service(); await f.db.query('select pickup_guest_command($1,$2,$3,$4)', [id(n), key(k), name, JSON.stringify(args)]);
  };
  return { ...f, service, create, get, command };
}

test('guest capability creates a private conversation without an account; venue consent and ownership still apply', async () => {
  const f = await fixture(); const { db, asUser } = f;
  try {
    assert.equal(await f.create(), id(20));
    const detail = await f.get();
    assert.equal(detail.request.customer_user_id, null); assert.equal(detail.guest, true);
    assert.equal(detail.consented, true); assert.equal(detail.messages.length, 1);
    assert.equal(detail.request.venue.name, 'Test Club');
    assert.doesNotMatch(JSON.stringify(detail), /key_hash|rate_key|access_expires_at/);
    await assert.rejects(f.get(20, 21), e => e.code === '42501');
    await assert.rejects(f.get(21, 20), e => e.code === '42501');
    for (const user of [1, 2, 4, 6, 8]) {
      await asUser(user);
      assert.equal((await db.query('select * from pickup_requests where id=$1', [id(20)])).rows.length, 0);
      await assert.rejects(db.query('select pickup_guest_get($1,$2,null)', [id(20), key(20)]), e => e.code === '42501');
    }
    for (const user of [3, 5]) {
      await asUser(user);
      assert.equal((await db.query('select * from pickup_requests where id=$1', [id(20)])).rows.length, 1);
      assert.equal((await db.query('select * from pickup_messages where pickup_request_id=$1', [id(20)])).rows.length, 0);
      await db.query("select pickup_accept_consent($1,'pickup-chat-v1')", [id(20)]);
      assert.equal((await db.query('select * from pickup_messages where pickup_request_id=$1', [id(20)])).rows.length, 1);
    }
    await asUser(null, 'anon');
    await assert.rejects(db.query('select * from pickup_guest_access'), e => e.code === '42501');
    await assert.rejects(db.query('select pickup_guest_create($1,$2,$3,$4,$5,2,$6)', [id(21), key(21), key(1), id(10), 'Hotel lobby', 'pickup-chat-v1']), e => e.code === '42501');
    await f.service();
    await assert.rejects(db.query('select * from pickup_guest_access'), e => e.code === '42501');
    await assert.rejects(db.query("insert into pickup_messages(pickup_request_id,sender_type,message_text) values($1,'customer','Spoof')", [id(20)]), e => e.code === '42501');
  } finally { await db.close(); }
});

test('guest retries cannot steal another guest or signed-in request; disabled venues and request limits fail closed', async () => {
  const f = await fixture(); const { db, asUser } = f;
  try {
    await f.create(); assert.equal(await f.create(), id(20));
    await assert.rejects(f.create(20, 21), e => e.code === '42501');
    await asUser(1);
    await assert.rejects(db.query("select pickup_create_request($1,$2,'Test hotel lobby',2,'pickup-chat-v1')", [id(20), id(10)]), e => e.code === '22023');
    await db.query("select pickup_create_request($1,$2,'Test hotel lobby',2,'pickup-chat-v1')", [id(90), id(10)]);
    await assert.rejects(f.create(90), e => e.code === '42501');
    await assert.rejects(f.create(91, 91, 1, 11), e => e.code === '22023');
    for (const n of [21, 22, 23, 24]) await f.create(n);
    await assert.rejects(f.create(25), e => e.code === 'P0001');
    assert.equal(await f.create(), id(20), 'retries succeed even at the creation limit');
    await asUser(3); await db.query('select pickup_set_enabled($1,false)', [id(10)]);
    await assert.rejects(f.create(26, 26, 2), e => e.code === '22023');
    assert.equal((await f.get()).request.id, id(20), 'opt-out preserves existing guest conversations');
  } finally { await db.close(); }
});

test('guest messages, venue replies, pagination and reports work without exposing audit data or allowing spoofing', async () => {
  const f = await fixture(); const { db, asUser } = f;
  try {
    await f.create(); await f.create(21);
    const message = { p_message_id: id(30), p_text: '<script>Plain guest text</script>' };
    await f.command('pickup_send_message', message); await f.command('pickup_send_message', message);
    await assert.rejects(f.command('pickup_send_message', { ...message, p_text: 'Changed' }), e => e.code === '22023');
    await assert.rejects(f.command('pickup_send_message', message, 21), e => e.code === '22023');
    await f.command('pickup_mark_read', { p_sequence: 9999 });
    await asUser(3); await db.query("select pickup_accept_consent($1,'pickup-chat-v1')", [id(20)]);
    await db.query('select pickup_send_message($1,$2,$3)', [id(20), id(31), 'Please wait in the lobby.']);
    const detail = await f.get();
    assert.equal(detail.messages.length, 3); assert.equal(detail.messages[1].sender_type, 'customer');
    assert.equal(detail.messages[2].sender_type, 'venue'); assert.deepEqual(detail.events, []);
    assert.equal((await f.get(20, 20, detail.messages[2].sequence)).messages.length, 2);
    for (const n of Array.from({ length: 11 }, (_, i) => 40 + i)) await f.command('pickup_send_message', { p_message_id: id(n), p_text: 'Rate test' });
    await assert.rejects(f.command('pickup_send_message', { p_message_id: id(70), p_text: 'Too many' }), e => e.code === 'P0001');
    await f.command('pickup_report_conversation', { p_reason: 'harassment', p_details: 'Synthetic report' });
    await f.command('pickup_report_conversation', { p_reason: 'harassment', p_details: 'Synthetic report' });
    await asUser(7);
    const reports = (await db.query('select * from pickup_reports where pickup_request_id=$1', [id(20)])).rows;
    assert.equal(reports.length, 1); assert.equal(reports[0].guest_request_id, id(20));
    await assert.rejects(db.query("update pickup_messages set message_text='Edited'"), e => e.code === '42501');
    await assert.rejects(f.command('pickup_admin_note', { p_note: 'Impersonation' }), e => e.code === '42501');
  } finally { await db.close(); }
});

test('guest status commands preserve venue authority, arrival evidence, closure and link expiry', async () => {
  const f = await fixture(); const { db, asUser } = f;
  try {
    await f.create();
    await assert.rejects(f.command('pickup_set_status', { p_status: 'accepted', p_expected_status: 'requested' }), e => e.code === '42501');
    await assert.rejects(f.command('pickup_confirm_arrival'), e => e.code === '42501');
    await asUser(3); await db.query("select pickup_accept_consent($1,'pickup-chat-v1')", [id(20)]);
    await db.query("select pickup_set_status($1,'accepted','requested')", [id(20)]);
    await f.command('pickup_confirm_arrival');
    assert.equal((await f.get()).request.status, 'arrived');
    await f.command('pickup_confirm_arrival');
    assert.equal((await f.get()).evidence.length, 1);
    await asUser(3); await db.query("select pickup_set_status($1,'completed','arrived')", [id(20)]);
    await assert.rejects(f.command('pickup_send_message', { p_message_id: id(30), p_text: 'Closed' }), e => e.code === '22023');
    await f.create(21);
    await f.command('pickup_set_status', { p_status: 'cancelled', p_expected_status: 'requested', p_reason: 'Plans changed' }, 21);
    assert.equal((await f.get(21)).request.status, 'cancelled');
    await db.exec('reset role');
    await db.query("update pickup_guest_access set access_expires_at=now()-interval '1 second' where pickup_request_id=$1", [id(21)]);
    await assert.rejects(f.get(21), e => e.code === '42501');
    await assert.rejects(f.command('pickup_mark_read', { p_sequence: 1 }, 21), e => e.code === '42501');
  } finally { await db.close(); }
});

test('guest unread totals count every unread venue reply across valid private links without marking anything read', async () => {
  const f = await fixture(); const { db, asUser } = f;
  const links = [{ id: id(20), key_hash: key(20) }, { id: id(21), key_hash: key(21) }];
  const count = async (input = links) => {
    await f.service();
    return Number((await db.query('select pickup_guest_unread_count($1) count', [JSON.stringify(input)])).rows[0].count);
  };
  try {
    await f.create(); await f.create(21);
    await f.command('pickup_send_message', { p_message_id: id(30), p_text: 'My hotel' });
    assert.equal(await count(), 0, 'guest messages and system updates are not new venue replies');
    await db.exec('reset role');
    await db.query("insert into pickup_messages(pickup_request_id,sender_user_id,sender_type,message_text) select $1,$2,'venue','Venue reply '||n from generate_series(1,55) n", [id(20), id(3)]);
    await db.query("insert into pickup_messages(pickup_request_id,sender_user_id,sender_type,message_text) values($1,$2,'venue','Other pickup reply')", [id(21), id(3)]);
    assert.equal(await count(), 56, 'counts beyond the 50-message conversation page');
    assert.equal(await count(), 56, 'checking a badge never marks a reply read');
    assert.equal(await count([...links, links[0]]), 56, 'duplicate capabilities cannot inflate the total');
    assert.equal(await count([{ id: id(20), key_hash: key(21) }]), 0, 'another chat key grants no access');
    assert.equal(await count([{ id: id(99), key_hash: key(20) }]), 0, 'unknown chats reveal no count');
    const detail = await f.get();
    await f.command('pickup_mark_read', { p_sequence: detail.messages.at(-1).sequence });
    assert.equal(await count(), 1, 'reading one chat clears only that conversation');
    await db.exec('reset role');
    await db.query("update pickup_guest_access set access_expires_at=now()-interval '1 second' where pickup_request_id=$1", [id(21)]);
    assert.equal(await count(), 0, 'expired keys are excluded without breaking valid saved chats');
    assert.equal(await count([]), 0);
    for (const invalid of [null, {}, [null], [{}], [{ id: 'bad', key_hash: key(20) }], Array(51).fill(links[0])]) {
      await assert.rejects(count(invalid), error => error.code === '22023');
    }
    for (const [user,role] of [[null,'anon'],[1,'authenticated']]) {
      await asUser(user,role);
      await assert.rejects(db.query('select pickup_guest_unread_count($1)', [JSON.stringify(links)]), error => error.code === '42501');
    }
  } finally { await db.close(); }
});
