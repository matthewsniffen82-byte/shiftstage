import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClubDepartureDatabase } from "./helpers/club-departure-database.mjs";
import { seedAccountLifecycle, accountLifecycleId as id, asAccountLifecycleRole } from "./helpers/account-lifecycle-database.mjs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let db, serial = 300000;
before(async () => {
  db = await createClubDepartureDatabase();
  const ddl = read("../supabase/migrations/202608100001_venue_team_operations.sql").match(/create table if not exists public\.venue_activity_log \([\s\S]*?\n\);/)[0];
  await db.exec(ddl);
  await db.exec(read("../supabase/migrations/20260922050000_allow_venue_staff_to_end_checkins.sql"));
});
after(async () => db?.close());
const end = async (actor, venue, shift) => (await db.query("select public.end_venue_dancer_checkin($1,$2,$3) result", [actor, venue, shift])).rows[0].result;
async function fixture() {
  const owner = await seedAccountLifecycle(db, { n: serial += 1000, role: "venue" });
  const dancer = await seedAccountLifecycle(db, { n: serial += 1000, role: "dancer" });
  const other = await seedAccountLifecycle(db, { n: serial += 1000, role: "venue" });
  const affiliationId = id(serial + 301), shiftId = id(serial + 302);
  await db.query("insert into public.venue_dancer_affiliations(id,venue_id,dancer_id,approved_by_user_id)values($1,$2,$3,$4)", [affiliationId, owner.venueId, dancer.dancerId, owner.userId]);
  await db.query("insert into public.dancer_photos(id,dancer_id,storage_path)values($1,$2,'synthetic/checkout.jpg')", [id(serial + 303), dancer.dancerId]);
  await db.query("insert into public.shifts(id,dancer_id,venue_id,starts_at,ends_at,timezone,status,shift_source,checked_in_at,location_status,location_verification_expires_at,nfc_last_tapped_at,working_status,commission_tracking_started_at)values($1,$2,$3,now()-interval '1 hour',now()+interval '5 hours','America/Los_Angeles','posted','nfc_presence',now()-interval '1 hour','club_confirmed',now()+interval '5 hours',now()-interval '1 hour','checked_in',now()-interval '1 hour')", [shiftId, dancer.dancerId, owner.venueId]);
  return { owner, dancer, other, affiliationId, shiftId };
}
async function preserved(f) {
  const result = {};
  for (const [table, column, value] of [["auth.users", "id", f.dancer.userId], ["public.app_users", "id", f.dancer.userId], ["public.dancer_profiles", "id", f.dancer.dancerId], ["public.dancer_photos", "dancer_id", f.dancer.dancerId], ["public.venue_dancer_affiliations", "dancer_id", f.dancer.dancerId]]) {
    result[table] = (await db.query(`select to_jsonb(t) value from ${table} t where ${column}=$1 order by id`, [value])).rows;
  }
  return result;
}
const shift = async f => (await db.query("select * from public.shifts where id=$1", [f.shiftId])).rows[0];

test("owner checkout ends presence and commission tracking while preserving full account, profile, media, approval and tap cooldown", async () => {
  const f = await fixture(), before = await preserved(f), original = await shift(f);
  const receipt = await asAccountLifecycleRole(db, "service_role", null, () => end(f.owner.userId, f.owner.venueId, f.shiftId));
  const ended = await shift(f);
  assert.equal(receipt.alreadyEnded, false);
  assert.equal(receipt.shiftId, f.shiftId);
  assert.deepEqual(await preserved(f), before);
  assert.equal(ended.working_status, "ended");
  assert.equal(ended.ended_reason, "venue_checkout");
  assert.deepEqual(ended.checked_out_at, ended.location_verification_expires_at);
  assert.deepEqual(ended.checked_out_at, ended.commission_tracking_stopped_at);
  assert.deepEqual(ended.nfc_last_tapped_at, original.nfc_last_tapped_at);
  assert.deepEqual(ended.starts_at, original.starts_at);
  assert.deepEqual(ended.ends_at, original.ends_at);
  assert.equal(ended.status, "posted");
  const log = (await db.query("select actor_user_id,actor_role,target_id,action from public.venue_activity_log where target_id=$1", [f.shiftId])).rows;
  assert.deepEqual(log, [{ actor_user_id: f.owner.userId, actor_role: "owner", target_id: f.shiftId, action: "dancer_checkin_ended" }]);
});

test("active managers and staff can check out their club dancers without roster management permission", async () => {
  for (const role of ["manager", "staff"]) {
    const f = await fixture(), before = await preserved(f);
    await db.query("insert into public.venue_team_members(venue_id,user_id,role,status)values($1,$2,$3,'active')", [f.owner.venueId, f.other.userId, role]);
    await end(f.other.userId, f.owner.venueId, f.shiftId);
    assert.deepEqual(await preserved(f), before);
    assert.equal((await db.query("select actor_role from public.venue_activity_log where target_id=$1", [f.shiftId])).rows[0].actor_role, role);
  }
});

test("foreign clubs, dancers, removed team members and disabled or suspended accounts cannot end a check-in", async () => {
  const f = await fixture(), original = await shift(f);
  for (const actor of [f.other.userId, f.dancer.userId]) await assert.rejects(end(actor, f.owner.venueId, f.shiftId), e => e.code === "42501");
  await assert.rejects(end(f.other.userId, f.other.venueId, f.shiftId), e => e.code === "P0002");
  await db.query("insert into public.venue_team_members(venue_id,user_id,role,status)values($1,$2,'staff','removed')", [f.owner.venueId, f.other.userId]);
  await assert.rejects(end(f.other.userId, f.owner.venueId, f.shiftId), e => e.code === "42501");
  await db.query("update public.venue_team_members set status='active' where user_id=$1", [f.other.userId]);
  await db.query("update public.app_users set dmca_suspended_at=now() where id=$1", [f.other.userId]);
  await assert.rejects(end(f.other.userId, f.owner.venueId, f.shiftId), e => e.code === "42501");
  await db.query("update public.app_users set dmca_suspended_at=null where id=$1", [f.other.userId]);
  await db.query("update public.app_users set account_state='disabled' where id=$1", [f.owner.userId]);
  await assert.rejects(end(f.other.userId, f.owner.venueId, f.shiftId), e => e.code === "42501");
  assert.deepEqual(await shift(f), original);
});

test("anonymous and authenticated clients cannot execute the service checkout RPC with a forged actor", async () => {
  const f = await fixture();
  for (const role of ["anon", "authenticated"]) await assert.rejects(asAccountLifecycleRole(db, role, f.owner.userId, () => end(f.owner.userId, f.owner.venueId, f.shiftId)), e => e.code === "42501");
});

test("retries are idempotent and never end a newer check-in", async () => {
  const f = await fixture();
  const receipt = await end(f.owner.userId, f.owner.venueId, f.shiftId);
  const newer = id(serial + 304);
  await db.query("insert into public.shifts(id,dancer_id,venue_id,starts_at,ends_at,timezone,status,shift_source,checked_in_at,location_status,location_verification_expires_at)values($1,$2,$3,now(),now()+interval '6 hours','America/Los_Angeles','posted','nfc_presence',now(),'club_confirmed',now()+interval '6 hours')", [newer, f.dancer.dancerId, f.owner.venueId]);
  assert.deepEqual(await end(f.owner.userId, f.owner.venueId, f.shiftId), { ...receipt, alreadyEnded: true });
  assert.equal((await db.query("select checked_out_at from public.shifts where id=$1", [newer])).rows[0].checked_out_at, null);
  assert.equal((await db.query("select count(*)::int n from public.venue_activity_log where target_id=$1", [f.shiftId])).rows[0].n, 1);
});

test("demo sessions are protected and expired sessions end at expiry without creating commission tracking", async () => {
  const f = await fixture();
  await db.query("update public.shifts set shift_source='demo_locked',nfc_last_tapped_at=null,commission_tracking_started_at=null where id=$1", [f.shiftId]);
  await assert.rejects(end(f.owner.userId, f.owner.venueId, f.shiftId), e => e.code === "22023");
  await db.query("update public.shifts set shift_source='nfc_presence',commission_tracking_started_at=null,checked_in_at=now()-interval '7 hours',starts_at=now()-interval '7 hours',ends_at=now()-interval '1 hour',location_verification_expires_at=now()-interval '1 hour' where id=$1", [f.shiftId]);
  const original = await shift(f);
  await end(f.owner.userId, f.owner.venueId, f.shiftId);
  const ended = await shift(f);
  assert.deepEqual(ended.checked_out_at, original.location_verification_expires_at);
  assert.equal(ended.commission_tracking_stopped_at, null);
});

test("failed checkout or audit rolls back the complete action and preserves approval", async () => {
  const f = await fixture(), original = await shift(f), before = await preserved(f);
  for (const [table, operation] of [["shifts", "update"], ["venue_activity_log", "insert"]]) {
    await db.exec(`create function public.synthetic_stop_checkout()returns trigger language plpgsql as $$begin return null;end$$;create trigger synthetic_stop_checkout before ${operation} on public.${table} for each row execute function public.synthetic_stop_checkout()`);
    try {
      await assert.rejects(end(f.owner.userId, f.owner.venueId, f.shiftId), e => e.code === "40001");
      assert.deepEqual(await shift(f), original);
      assert.deepEqual(await preserved(f), before);
    } finally { await db.exec(`drop trigger synthetic_stop_checkout on public.${table};drop function public.synthetic_stop_checkout()`); }
  }
});

const panel = read("../app/dashboard/VenueNfcTagPanel.tsx");
const checkout = compile(panel.slice(panel.indexOf("  async function endCheckIn("), panel.indexOf("  function startTapTest(")));
function uiFixture({ allowed = true, confirmed = true } = {}) {
  const requests = [], ended = [];
  const context = vm.createContext({
    AbortController, Error, canEndCheckIns: allowed, window: { confirm: () => confirmed },
    readDashboardAccessToken: () => "fixture", mountedRef: { current: true }, savingRef: { current: false },
    actionSequenceRef: { current: 0 }, actionAbortRef: { current: null }, loadSequenceRef: { current: 0 },
    loadAbortRef: { current: new AbortController() }, loadInFlightRef: { current: null },
    setIsLoading: () => {}, setIsSaving: value => { context.saving = value; }, setEndingShiftId: () => {},
    setStatus: value => { context.status = value; }, onCheckInEnded: value => ended.push(value),
    requestDashboardJson: (path, options) => new Promise((resolve, reject) => requests.push({ path, options, resolve, reject })),
  });
  vm.runInContext(checkout, context);
  return { context, requests, ended, run: () => context.endCheckIn({ dancer: { stageName: "Test" } }, { shiftId: id(1), shiftSource: "nfc_presence" }) };
}
test("checkout UI waits for a matching persisted receipt, prevents duplicate actions, and never edits affiliation", async () => {
  const f = uiFixture(), oldLoad = f.context.loadAbortRef.current, action = f.run();
  assert.deepEqual(f.ended, []);
  assert.equal(oldLoad.signal.aborted, true);
  await f.run(); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].path, "/api/venue/check-ins");
  assert.equal(f.requests[0].options.method, "DELETE");
  f.requests[0].resolve({ shiftId: id(1), checkedOutAt: new Date().toISOString() });
  await action;
  assert.deepEqual(f.ended, [id(1)]);
  assert.equal(f.context.saving, false);
});
test("UI failures, wrong receipts, cancelled actions, and stale responses keep Working Now intact", async () => {
  for (const options of [{ allowed: false }, { confirmed: false }]) {
    const f = uiFixture(options); await f.run(); assert.equal(f.requests.length, 0);
  }
  for (const outcome of ["failure", "wrongReceipt", "unmounted"]) {
    const f = uiFixture(), action = f.run();
    if (outcome === "failure") f.requests[0].reject(new Error("Retry"));
    else {
      if (outcome === "unmounted") f.context.mountedRef.current = false;
      f.requests[0].resolve({ shiftId: outcome === "wrongReceipt" ? id(2) : id(1), checkedOutAt: new Date().toISOString() });
    }
    await action; assert.deepEqual(f.ended, []);
  }
});
