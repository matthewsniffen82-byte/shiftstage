import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { createAccountLifecycleDatabase, seedAccountLifecycle, asAccountLifecycleRole, transitionOwnAccount } from './helpers/account-lifecycle-database.mjs';

let db, next = 21000;
before(async () => {
  db = await createAccountLifecycleDatabase();
  await db.exec(readFileSync('supabase/migrations/20261026234410_separate_club_visibility_from_setup.sql', 'utf8'));
});
after(async () => db?.close());
async function fixture() {
  const owner = await seedAccountLifecycle(db, { n: next++, role: 'venue' });
  const admin = await seedAccountLifecycle(db, { n: next++, role: 'admin' });
  await db.query("update venues set page_reviewed_at='2026-01-01Z',page_reviewed_by_user_id=$1 where id=$2", [owner.userId, owner.venueId]);
  await db.query("update club_deals set is_active=true,payout_type='flat',payout_amount_cents=100,offer_type='admission',deal_title='Free admission' where venue_id=$1", [owner.venueId]);
  return { owner, admin };
}
const row = async id => (await db.query('select to_jsonb(v) as venue from venues v where id=$1', [id])).rows[0].venue;
const change = async (actor, venue, visible) => (await db.query('select set_venue_visibility_safely($1,$2,$3) as venue', [actor,venue,visible])).rows[0].venue;

test('hide and restore change only visibility and retain the original approval and publication', async () => {
  const { owner, admin } = await fixture();
  const original = await row(owner.venueId);
  const hidden = await change(admin.userId, owner.venueId, false);
  assert.deepEqual(hidden, { ...original, is_active: false });
  const restored = await change(admin.userId, owner.venueId, true);
  assert.deepEqual(restored, original);
});

for (const status of ['admin_draft', 'venue_review', 'changes_requested', 'venue_approved']) {
  test(`visibility controls cannot bypass ${status} approval`, async () => {
    const { owner, admin } = await fixture();
    await db.query('update venues set is_active=false,page_review_status=$1 where id=$2', [status, owner.venueId]);
    const before = await row(owner.venueId);
    await assert.rejects(change(admin.userId, owner.venueId, true), error => error.code === '40001');
    assert.deepEqual(await row(owner.venueId), before);
  });
}

test('restoration fails when the deal is inactive, then succeeds after a qualifying deal exists', async () => {
  const { owner, admin } = await fixture();
  await change(admin.userId, owner.venueId, false);
  await db.query('update club_deals set is_active=false where venue_id=$1', [owner.venueId]);
  await assert.rejects(change(admin.userId, owner.venueId, true), error => error.code === '40001');
  assert.equal((await row(owner.venueId)).is_active, false);
  await db.query('update club_deals set is_active=true where venue_id=$1', [owner.venueId]);
  assert.equal((await change(admin.userId, owner.venueId, true)).is_active, true);
});

test('paused owners and suspended admins cannot restore a club', async () => {
  const { owner, admin } = await fixture();
  await transitionOwnAccount(db, owner.userId, 'disabled');
  await assert.rejects(change(admin.userId, owner.venueId, true), error => error.code === '42501');
  await transitionOwnAccount(db, owner.userId, 'active');
  await change(admin.userId, owner.venueId, false);
  await db.query('update app_users set dmca_suspended_at=now() where id=$1', [admin.userId]);
  await assert.rejects(change(admin.userId, owner.venueId, true), error => error.code === '42501');
});

for (const role of ['venue', 'customer', 'dancer']) test(`${role} accounts cannot change club visibility`, async () => {
  const { owner } = await fixture();
  const actor = await seedAccountLifecycle(db, { n: next++, role });
  await assert.rejects(change(actor.userId, owner.venueId, false), error => error.code === '42501');
  assert.equal((await row(owner.venueId)).is_active, true);
});
for (const role of ['anon', 'authenticated']) test(`${role} cannot invoke the privileged visibility writer`, async () => {
  const { owner, admin } = await fixture();
  await assert.rejects(asAccountLifecycleRole(db, role, admin.userId, () => change(admin.userId, owner.venueId, false)), error => error.code === '42501');
});
test('service-role execution verifies the actor and returns a matching receipt', async () => {
  const { owner, admin } = await fixture();
  const hidden = await asAccountLifecycleRole(db, 'service_role', admin.userId, () => change(admin.userId, owner.venueId, false));
  assert.equal(hidden.id, owner.venueId);
  assert.equal(hidden.is_active, false);
});
test('a suppressed write is rejected without reporting false success', async () => {
  const { owner, admin } = await fixture();
  await db.exec('create function synthetic_stop_visibility() returns trigger language plpgsql as $$begin return null;end$$;create trigger synthetic_stop_visibility before update on venues for each row execute function synthetic_stop_visibility()');
  try {
    await assert.rejects(change(admin.userId, owner.venueId, false), error => error.code === '40001');
    assert.equal((await row(owner.venueId)).is_active, true);
  } finally {
    await db.exec('drop trigger synthetic_stop_visibility on venues;drop function synthetic_stop_visibility()');
  }
});
