import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createClubDepartureDatabase, clubDepartureMigration } from "./helpers/club-departure-database.mjs";
import { seedAccountLifecycle, accountLifecycleId as id, asAccountLifecycleRole } from "./helpers/account-lifecycle-database.mjs";

let db, serial = 20000;
before(async () => { db = await createClubDepartureDatabase(); });
after(async () => db?.close());
const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args)).rows[0].result;
async function fixture() {
  const owner = await seedAccountLifecycle(db, { n: serial += 1000, role: "venue" });
  const dancer = await seedAccountLifecycle(db, { n: serial += 1000, role: "dancer" });
  const other = await seedAccountLifecycle(db, { n: serial += 1000, role: "venue" });
  const affiliationId = id(serial + 301), otherAffiliationId = id(serial + 302), tagId = id(serial + 303);
  for (const [affiliation, venue] of [[affiliationId, owner], [otherAffiliationId, other]]) {
    await db.query("insert into public.venue_dancer_affiliations(id,venue_id,dancer_id,approved_by_user_id) values($1,$2,$3,$4)", [affiliation, venue.venueId, dancer.dancerId, venue.userId]);
  }
  await db.query("update public.dancer_profiles set venue_approved_venue_id=$1,venue_approved_by_user_id=$2 where id=$3", [owner.venueId, owner.userId, dancer.dancerId]);
  await db.query("insert into public.dancer_photos(id,dancer_id,storage_path)values($1,$2,'synthetic/profile.jpg')", [id(serial + 304), dancer.dancerId]);
  await db.query("insert into public.nfc_tags(id,venue_id,tag_type,label,token_digest,created_by_user_id)values($1,$2,'dressing_room','Dressing room',$3,$4)", [tagId, owner.venueId, String(serial).padStart(64, '0'), owner.userId]);
  await db.query("insert into public.dancer_nfc_enrollments(dancer_user_id,venue_id,nfc_tag_id)values($1,$2,$3)", [dancer.userId, owner.venueId, tagId]);
  const shiftId = id(serial + 305);
  await db.query("insert into public.shifts(id,dancer_id,venue_id,starts_at,ends_at,timezone,status,shift_source,checked_in_at,location_status,location_verification_expires_at,nfc_tag_id)values($1,$2,$3,now()-interval '1 hour',now()+interval '5 hours','America/Los_Angeles','posted','nfc_presence',now()-interval '1 hour','club_confirmed',now()+interval '5 hours',$4)", [shiftId, dancer.dancerId, owner.venueId, tagId]);
  return { owner, dancer, other, affiliationId, otherAffiliationId, tagId, shiftId };
}
async function dancerIdentity(f) {
  return {
    account: (await db.query("select to_jsonb(a) value from public.app_users a where id=$1", [f.dancer.userId])).rows[0].value,
    auth: (await db.query("select to_jsonb(a) value from auth.users a where id=$1", [f.dancer.userId])).rows[0].value,
    profile: (await db.query("select id,user_id,stage_name,slug,status,verification_status,is_public,disabled_at from public.dancer_profiles where id=$1", [f.dancer.dancerId])).rows[0],
    photos: (await db.query("select * from public.dancer_photos where dancer_id=$1", [f.dancer.dancerId])).rows,
  };
}

test("club departure removes club links and check-ins while retaining dancer identity, profile, media, and other affiliations", async () => {
  const f = await fixture(), before = await dancerIdentity(f);
  const receipt = await asAccountLifecycleRole(db, "service_role", null, () => rpc("end_venue_participation", [f.owner.userId, f.owner.venueId]));
  assert.equal(receipt.dancerAccountsPreserved, true);
  assert.deepEqual(await dancerIdentity(f), before);
  assert.equal((await db.query("select status from public.venue_dancer_affiliations where id=$1", [f.otherAffiliationId])).rows[0].status, "active");
  assert.deepEqual((await db.query("select status,reentry_blocked from public.venue_dancer_affiliations where id=$1", [f.affiliationId])).rows[0], { status: "revoked", reentry_blocked: true });
  assert.equal((await db.query("select status from public.shifts where id=$1", [f.shiftId])).rows[0].status, "cancelled");
  assert.equal((await db.query("select is_active from public.venues where id=$1", [f.owner.venueId])).rows[0].is_active, false);
  assert.equal((await db.query("select status from public.nfc_tags where id=$1", [f.tagId])).rows[0].status, "revoked");
  assert.equal((await db.query("select status from public.dancer_nfc_enrollments where venue_id=$1", [f.owner.venueId])).rows[0].status, "revoked");
  assert.deepEqual(await rpc("end_venue_participation", [f.owner.userId, f.owner.venueId]), receipt, "retries are idempotent");
  await assert.rejects(db.query("update public.venues set is_active=true where id=$1", [f.owner.venueId]), error => error.code === "42501");
  await assert.rejects(db.query("update public.venue_dancer_affiliations set status='active',revoked_at=null,revoked_by_user_id=null where id=$1", [f.affiliationId]), error => error.code === "42501");
});

test("roster removal ends presence, preserves even the last-club dancer account, and requires club permission plus a new tap", async () => {
  const f = await fixture(), before = await dancerIdentity(f);
  await rpc("revoke_dancer_venue_affiliation", [f.affiliationId, f.owner.userId, "Dancer left the club."]);
  await rpc("revoke_dancer_venue_affiliation", [f.otherAffiliationId, f.other.userId, "Dancer left the club."]);
  assert.deepEqual(await dancerIdentity(f), before);
  assert.equal((await db.query("select venue_approved_venue_id from public.dancer_profiles where id=$1", [f.dancer.dancerId])).rows[0].venue_approved_venue_id, null);
  await assert.rejects(db.query("update public.venue_dancer_affiliations set status='active',revoked_at=null,revoked_by_user_id=null where id=$1", [f.affiliationId]), error => error.code === "42501");
  await assert.rejects(rpc("allow_dancer_venue_retap", [f.dancer.userId, f.affiliationId]), error => error.code === "42501");
  await assert.rejects(rpc("allow_dancer_venue_retap", [f.other.userId, f.affiliationId]), error => error.code === "42501");
  await rpc("allow_dancer_venue_retap", [f.owner.userId, f.affiliationId]);
  assert.equal((await db.query("select status from public.venue_dancer_affiliations where id=$1", [f.affiliationId])).rows[0].status, "revoked");
  await db.query("update public.venue_dancer_affiliations set status='active',revoked_at=null,revoked_by_user_id=null where id=$1", [f.affiliationId]);
  assert.deepEqual(await dancerIdentity(f), before);
});

test("other clubs, dancers, staff, and managers cannot withdraw a club; an administrator can", async () => {
  const f = await fixture();
  for (const actor of [f.dancer.userId, f.other.userId]) await assert.rejects(rpc("end_venue_participation", [actor, f.owner.venueId]), error => error.code === "42501");
  for (const role of ["staff", "manager"]) {
    await db.query("insert into public.venue_team_members(venue_id,user_id,role,status)values($1,$2,$3,'active')on conflict(venue_id,user_id)do update set role=excluded.role", [f.owner.venueId, f.other.userId, role]);
    await assert.rejects(rpc("end_venue_participation", [f.other.userId, f.owner.venueId]), error => error.code === "42501");
  }
  const admin = await seedAccountLifecycle(db, { n: serial += 1000, role: "admin" });
  assert.equal((await rpc("end_venue_participation", [admin.userId, f.owner.venueId])).dancerAccountsPreserved, true);
});

test("untrusted callers cannot execute departure or grant themselves reentry", async () => {
  const f = await fixture();
  for (const role of ["anon", "authenticated"]) {
    for (const [name, args] of [["end_venue_participation", [f.owner.userId, f.owner.venueId]], ["allow_dancer_venue_retap", [f.owner.userId, f.affiliationId]]]) {
      await assert.rejects(asAccountLifecycleRole(db, role, f.owner.userId, () => rpc(name, args)), error => error.code === "42501");
    }
  }
});

test("a failed check-in cancellation rolls back the entire club departure", async () => {
  const f = await fixture(), before = await dancerIdentity(f);
  await db.exec("create function public.synthetic_stop_shift_change()returns trigger language plpgsql as $$begin return null;end$$;create trigger synthetic_stop_shift_change before update on public.shifts for each row execute function public.synthetic_stop_shift_change()");
  try {
    await assert.rejects(rpc("revoke_dancer_venue_affiliation", [f.affiliationId, f.owner.userId, "Dancer left"]), error => error.code === "40001");
    assert.equal((await db.query("select status from public.venue_dancer_affiliations where id=$1", [f.affiliationId])).rows[0].status, "active");
    await assert.rejects(rpc("end_venue_participation", [f.owner.userId, f.owner.venueId]), error => error.code === "40001");
    assert.equal((await db.query("select count(*)::int n from public.venue_participation_ends where venue_id=$1", [f.owner.venueId])).rows[0].n, 0);
    assert.equal((await db.query("select is_active from public.venues where id=$1", [f.owner.venueId])).rows[0].is_active, true);
    assert.deepEqual(await dancerIdentity(f), before);
  } finally { await db.exec("drop trigger synthetic_stop_shift_change on public.shifts;drop function public.synthetic_stop_shift_change()"); }
});

test("scheduled inserts and reopening are blocked even through older service clients", async () => {
  const f = await fixture();
  await assert.rejects(db.query("insert into public.shifts(dancer_id,venue_id,starts_at,ends_at,timezone,status,shift_source)values($1,$2,now()+interval '1 day',now()+interval '2 days','America/Los_Angeles','posted','scheduled')", [f.dancer.dancerId, f.owner.venueId]), error => error.code === "42501");
  await assert.rejects(db.query("update public.shifts set shift_source='scheduled' where id=$1", [f.shiftId]), error => error.code === "42501");
});

test("migration withdraws future posts while preserving a current verified session", async () => {
  const beforeDb = await createClubDepartureDatabase({ migrate: false });
  try {
    const owner = await seedAccountLifecycle(beforeDb, { n: 100, role: "venue" });
    const dancer = await seedAccountLifecycle(beforeDb, { n: 1000, role: "dancer" });
    await beforeDb.query("insert into public.venue_dancer_affiliations(venue_id,dancer_id,approved_by_user_id)values($1,$2,$3)", [owner.venueId, dancer.dancerId, owner.userId]);
    await beforeDb.query("insert into public.shifts(id,dancer_id,venue_id,starts_at,ends_at,timezone,status,shift_source)values($1,$2,$3,now()+interval '1 day',now()+interval '2 days','America/Los_Angeles','posted','scheduled')", [id(99), dancer.dancerId, owner.venueId]);
    await beforeDb.query("insert into public.shifts(id,dancer_id,venue_id,starts_at,ends_at,timezone,status,shift_source,checked_in_at,location_status,location_verification_expires_at)values($1,$2,$3,now()-interval '1 hour',now()+interval '5 hours','America/Los_Angeles','posted','scheduled',now()-interval '1 hour','club_confirmed',now()+interval '5 hours')", [id(98), dancer.dancerId, owner.venueId]);
    await beforeDb.exec(clubDepartureMigration);
    assert.deepEqual((await beforeDb.query("select id,status,shift_source from public.shifts order by id")).rows, [
      { id: id(98), status: "posted", shift_source: "nfc_presence" }, { id: id(99), status: "cancelled", shift_source: "scheduled" },
    ]);
  } finally { await beforeDb.close(); }
});
