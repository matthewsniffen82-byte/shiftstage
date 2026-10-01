import assert from "node:assert/strict";
import test, { before, beforeEach, afterEach, after } from "node:test";
import { readFileSync } from "node:fs";
import { createInternalRosterDatabase } from "./helpers/internal-roster-database.mjs";
import { fixtureId as id } from "./helpers/dancer-tap-database.mjs";

let pg;
before(async () => {
  pg = await createInternalRosterDatabase();
  for (const file of ["20260928190000_internal_table_request_push.sql", "20261001190000_internal_alert_recovery.sql"]) {
    await pg.exec(readFileSync(new URL("../supabase/migrations/" + file, import.meta.url), "utf8"));
  }
});
beforeEach(async () => pg.exec("begin;set role service_role"));
afterEach(async () => pg.exec("rollback;reset role"));
after(async () => pg?.close());

async function request() {
  await pg.query("select public.register_dancer_channel_tap($1,$2,$3,$4,$5)", [id(30),id(1),id(50),"internal",{}]);
  await pg.query("insert into public.internal_roster_links(id,venue_id,kind,label,token) values($1,$2,'table','Table 12',$3)", [id(70),id(20),id(71)]);
  return (await pg.query("select public.internal_roster_request($1,$2,$3) result", [id(71),id(10),id(80)])).rows[0].result;
}
const cancel = async (requestId, overrides = []) => (await pg.query(
  "select public.cancel_internal_roster_request($1,$2,$3,$4) result", overrides.length ? overrides : [id(20),id(70),id(10),requestId],
)).rows[0].result;
const claims = async () => (await pg.query("select * from public.claim_internal_request_alerts()")).rows;
const jobs = async () => (await pg.query("select * from public.internal_request_push_deliveries where event_kind='cancelled'")).rows;

test("cancellation atomically saves one inbox and recoverable push per currently authorized recipient", async () => {
  await pg.query("insert into public.venue_team_members(venue_id,user_id,status,role) values($1,$2,'active','staff')", [id(20),id(6)]);
  const req = await request();
  for (let retry=0; retry<2; retry++) assert.equal((await cancel(req.id)).status, "cancelled");
  const queued = await jobs(); assert.equal(queued.length, 2);
  assert.deepEqual(queued.map(row => row.recipient_id).sort(), [id(2),id(6)].sort());
  const inbox = (await pg.query("select id,body,payload from public.notifications where payload->>'event'='cancelled'")).rows;
  assert.deepEqual(inbox.map(row => row.id).sort(), queued.map(row => row.id).sort());
  assert.ok(inbox.every(row => row.body === "Table 12 cancelled the request for Synthetic dancer."));
  const delivered = await claims(); assert.equal(delivered.length, 2);
  assert.ok(delivered.every(row => row.event_kind === "cancelled"));
});
test("failed inbox persistence rolls back cancellation and its outbox", async () => {
  const req = await request();
  await pg.exec("reset role;create function public.synthetic_notification_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic failure';end$$;create trigger synthetic_failure before insert on public.notifications for each row execute function public.synthetic_notification_failure();set role service_role;savepoint failure");
  await assert.rejects(cancel(req.id), /synthetic failure/);
  await pg.exec("rollback to failure");
  assert.equal((await pg.query("select status from public.internal_roster_requests where id=$1", [req.id])).rows[0].status, "pending");
  assert.equal((await jobs()).length, 0);
});
test("old workers cannot deliver cancellation events as new requests during rollout", async () => {
  const req = await request(); await cancel(req.id);
  assert.equal((await pg.query("select * from public.claim_internal_request_push()")).rows.length, 0);
  assert.equal((await claims())[0].event_kind, "cancelled");
});
test("interrupted cancellation delivery retains its ID but replaces the expired lease", async () => {
  const req = await request(); await cancel(req.id);
  const [old] = await claims();
  await pg.exec("update public.internal_request_push_deliveries set lease_until=now()-interval '1 second' where event_kind='cancelled'");
  const [next] = await claims(); assert.equal(next.id, old.id); assert.notEqual(next.lease_id, old.lease_id);
  const finish = async lease => (await pg.query("select public.finish_internal_request_push($1,$2,'sent') result", [old.id,lease])).rows[0].result;
  assert.equal(await finish(old.lease_id), false); assert.equal(await finish(next.lease_id), true);
});
for (const change of [
  "update public.internal_roster_links set active=false",
  "update public.app_users set account_state='disabled' where id='" + id(2) + "'",
]) test("revoked access suppresses queued cancellation: " + change, async () => {
  const req = await request(); await cancel(req.id); await pg.exec(change);
  assert.equal((await claims()).length, 0);
  assert.equal((await jobs())[0].state, "skipped");
});
test("completed and foreign requests cannot be cancelled or enqueue alerts", async () => {
  const req = await request();
  for (const args of [[id(21),id(70),id(10),req.id], [id(20),id(70),id(11),req.id]]) {
    await pg.exec("savepoint denied"); await assert.rejects(cancel(req.id,args)); await pg.exec("rollback to denied");
  }
  await pg.exec("update public.internal_roster_requests set status='completed'");
  await pg.exec("savepoint completed"); await assert.rejects(cancel(req.id), { code: "40001" }); await pg.exec("rollback to completed");
  assert.equal((await jobs()).length, 0);
});
for (const role of ["anon","authenticated"]) test(role + " cannot use the new cancellation/claim commands", async () => {
  await pg.exec("set role " + role);
  for (const sql of ["select * from public.claim_internal_request_alerts()", "select public.cancel_internal_roster_request(null,null,null,null)"]) {
    await pg.exec("savepoint denied"); await assert.rejects(pg.exec(sql), { code: "42501" }); await pg.exec("rollback to denied");
  }
});
