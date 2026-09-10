import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { createCounterDatabase, seedCounterDatabase, counterSnapshot, submitCounter, counterInput, counterMigration, counterSignature, fixtureId } from "./helpers/counter-submission-database.mjs";

let pg;
before(async () => { pg = await createCounterDatabase(); });
beforeEach(async () => { await seedCounterDatabase(pg); });
after(async () => { await pg?.close(); });
test("submission commits one counter-notice and only the intended case transition", async () => {
  const before = await counterSnapshot(pg), result = await submitCounter(pg), after = await counterSnapshot(pg);
  assert.equal(result.duplicate, false); assert.equal(result.counter.status, "submitted");
  assert.equal(result.case.id, fixtureId(10)); assert.equal(result.case.status, "countered");
  assert.equal(result.counter.case_id, fixtureId(10)); assert.equal(after.dmca_counter_notices.length, 1);
  const counter = after.dmca_counter_notices[0];
  assert.equal(counter.uploader_id, fixtureId(1)); assert.equal(counter.legal_name, counterInput.legalName);
  assert.equal(counter.forwarded_to_claimant_at, null);
  assert.equal(counter.created_at.toISOString(), new Date(result.case.counter_received_at).toISOString());
  const changed = new Set(["status", "counter_received_at", "restore_eligible_at", "restore_deadline_at", "updated_at"]);
  for (const row of after.dmca_cases) {
    const original = before.dmca_cases.find(item => item.id === row.id);
    for (const [key, value] of Object.entries(row)) if (row.id !== fixtureId(10) || !changed.has(key)) assert.deepEqual(value, original[key], key);
  }
  for (const table of ["dmca_strikes", "app_users", "mydancr_tv_videos"]) assert.deepEqual(after[table], before[table]);
  assert.deepEqual(Object.keys(result.counter).sort(), ["id", "case_id", "status", "created_at"].sort());
  assert.equal(result.case.claimant_email, "claimant@example.invalid");
});
for (const timezone of ["UTC", "America/Los_Angeles", "Pacific/Auckland"]) {
  test("stored dates retain ten/fourteen UTC weekdays in " + timezone, async () => {
    await pg.query("select set_config('TimeZone',$1,false)", [timezone]);
    const result = await submitCounter(pg);
    const received = new Date(result.case.counter_received_at);
    for (const [key, expected] of [["restore_eligible_at", 10], ["restore_deadline_at", 14]]) {
      const date = new Date(result.case[key]);
      assert.equal(date.getUTCHours(), received.getUTCHours());
      assert.equal(date.getUTCMinutes(), received.getUTCMinutes());
      const days = Math.round((date - received) / 86400000);
      assert.ok(days >= expected && days <= 20);
      const weekdays = Array.from({ length: days }, (_, n) => new Date(received.valueOf() + (n + 1) * 86400000).getUTCDay()).filter(day => day !== 0 && day !== 6).length;
      assert.equal(weekdays, expected); assert.ok(date.getUTCDay() >= 1 && date.getUTCDay() <= 5);
    }
  });
}
test("disabled-account uploader appeals remain available without restoring the account", async () => {
  await pg.exec("update public.app_users set account_state='disabled',dmca_suspended_at=now()");
  const before = await counterSnapshot(pg);
  assert.equal((await submitCounter(pg)).counter.status, "submitted");
  assert.deepEqual((await counterSnapshot(pg)).app_users, before.app_users);
});
for (const args of [{ user: null }, { caseId: null }, { details: null }, { details: [] }, { details: "invalid" }]) {
  test("rejects invalid request shape " + JSON.stringify(args), async () => {
    const before = await counterSnapshot(pg); await assert.rejects(submitCounter(pg, args), { code: "22023" });
    assert.deepEqual(await counterSnapshot(pg), before);
  });
}
for (const field of ["mistakeBeliefConfirmed", "perjuryConfirmed", "jurisdictionConfirmed", "serviceConfirmed"]) {
  for (const value of [false, "true", null]) {
    test(field + " requires explicit true rather than " + JSON.stringify(value), async () => {
      const before = await counterSnapshot(pg);
      await assert.rejects(submitCounter(pg, { details: { ...counterInput, [field]: value } }), { code: "22023" });
      assert.deepEqual(await counterSnapshot(pg), before);
    });
  }
}
for (const [field, max] of [["legalName", 160], ["email", 320], ["phone", 50], ["address", 1000], ["removedMaterialLocation", 2000], ["signature", 160]]) {
  for (const value of [undefined, 123, "", "x".repeat(max + 1)]) {
    test("invalid " + field + " value " + String(value).slice(0, 15), async () => {
      const before = await counterSnapshot(pg);
      await assert.rejects(submitCounter(pg, { details: { ...counterInput, [field]: value } }), { code: "22023" });
      assert.deepEqual(await counterSnapshot(pg), before);
    });
  }
}
for (const email of ["no-at.example.invalid", "two@@example.invalid", "space name@example.invalid"]) {
  test("rejects malformed email " + email, async () => { await assert.rejects(submitCounter(pg, { details: { ...counterInput, email } }), { code: "22023" }); });
}
for (const args of [{ user: fixtureId(2) }, { user: fixtureId(999) }, { caseId: fixtureId(999) }]) {
  test("missing or other-uploader case is not accessible: " + JSON.stringify(args), async () => {
    const before = await counterSnapshot(pg); await assert.rejects(submitCounter(pg, args), { code: "P0002" });
    assert.deepEqual(await counterSnapshot(pg), before);
  });
}
for (const status of ["submitted", "needs_information", "rejected", "countered", "court_hold", "restored", "closed"]) {
  test("a new notice cannot change a case in " + status + " state", async () => {
    await pg.query("update public.dmca_cases set status=$1 where id=$2", [status, fixtureId(10)]);
    const before = await counterSnapshot(pg); await assert.rejects(submitCounter(pg), { code: "22023" });
    assert.deepEqual(await counterSnapshot(pg), before);
  });
}
test("identical normalized submission replays its original receipt and dates", async () => {
  const first = await submitCounter(pg), before = await counterSnapshot(pg);
  const result = await submitCounter(pg, { details: { ...counterInput, legalName: "  Synthetic Uploader  ", email: "SYNTHETIC@EXAMPLE.INVALID" } });
  assert.deepEqual(result, { ...first, duplicate: true }); assert.deepEqual(await counterSnapshot(pg), before);
});
test("queued same-case requests on one connection keep one notice", async () => {
  const results = await Promise.all([submitCounter(pg), submitCounter(pg)]);
  assert.equal(results.filter(row => row.duplicate).length, 1); assert.equal((await counterSnapshot(pg)).dmca_counter_notices.length, 1);
});
for (const field of ["legalName", "email", "phone", "address", "removedMaterialLocation", "signature"]) {
  test("changed " + field + " cannot overwrite a submitted notice", async () => {
    await submitCounter(pg); const before = await counterSnapshot(pg);
    const value = field === "email" ? "different@example.invalid" : "Different synthetic value";
    await assert.rejects(submitCounter(pg, { details: { ...counterInput, [field]: value } }), { code: "23505" });
    assert.deepEqual(await counterSnapshot(pg), before);
  });
}
for (const [caseStatus, counterStatus] of [["court_hold", "forwarded"], ["closed", "rejected"], ["closed", "withdrawn"], ["restored", "completed"]]) {
  test("replay preserves " + caseStatus + "/" + counterStatus + " decisions", async () => {
    await submitCounter(pg);
    await pg.query("update public.dmca_cases set status=$1,court_filing_received=true,admin_notes='Keep decision' where id=$2", [caseStatus, fixtureId(10)]);
    await pg.query("update public.dmca_counter_notices set status=$1,forwarded_to_claimant_at=now()", [counterStatus]);
    const before = await counterSnapshot(pg), result = await submitCounter(pg);
    assert.equal(result.duplicate, true); assert.equal(result.case.status, caseStatus); assert.equal(result.counter.status, counterStatus);
    assert.deepEqual(await counterSnapshot(pg), before);
  });
}
for (const sql of ["status='disabled'", "counter_received_at=null", "restore_eligible_at=null", "restore_deadline_at=null"]) {
  test("broken prior receipt " + sql + " fails without compensation or overwrite", async () => {
    await submitCounter(pg); await pg.exec("update public.dmca_cases set " + sql);
    const before = await counterSnapshot(pg); await assert.rejects(submitCounter(pg), { code: "40001" });
    assert.deepEqual(await counterSnapshot(pg), before);
  });
}
for (const [table, operation, action] of [["dmca_counter_notices", "insert", "raise exception 'synthetic failure'"], ["dmca_cases", "update", "raise exception 'synthetic failure'"], ["dmca_cases", "update", "return null"]]) {
  test(table + " " + operation + " " + action + " rolls back the entire submission", async () => {
    const before = await counterSnapshot(pg);
    await pg.exec(`reset role;create or replace function public.synthetic_failure() returns trigger language plpgsql as $$begin ${action};end$$;create trigger synthetic_failure before ${operation} on public.${table} for each row execute function public.synthetic_failure();set role service_role`);
    await assert.rejects(submitCounter(pg)); assert.deepEqual(await counterSnapshot(pg), before);
  });
}
for (const role of ["anon", "authenticated"]) {
  test(role + " cannot invoke the privileged submission", async () => {
    const before = await counterSnapshot(pg); await pg.exec("set role " + role);
    await assert.rejects(submitCounter(pg), { code: "42501" }); await pg.exec("set role service_role");
    assert.deepEqual(await counterSnapshot(pg), before);
  });
}
test("unrelated supplied fields cannot alter status, uploader, forwarding or restoration", async () => {
  const result = await submitCounter(pg, { details: { ...counterInput, status: "restored", uploader_id: fixtureId(2), forwarded_to_claimant_at: "2026-01-01Z", restore_eligible_at: "2026-01-01Z" } });
  assert.equal(result.case.status, "countered"); assert.equal(result.counter.status, "submitted");
  assert.equal((await counterSnapshot(pg)).dmca_counter_notices[0].forwarded_to_claimant_at, null);
});
test("the additive migration preserves seeded records, RLS and bounded invoker access", async () => {
  const isolated = await createCounterDatabase({ migrate: false });
  try {
    await seedCounterDatabase(isolated); const before = await counterSnapshot(isolated);
    await isolated.exec("reset role"); await isolated.exec(counterMigration);
    assert.deepEqual(await counterSnapshot(isolated), before);
    const row = (await isolated.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [counterSignature])).rows[0];
    assert.equal(row.prosecdef, false); assert.ok(row.proconfig.includes('search_path=""')); assert.ok(row.proconfig.includes("lock_timeout=3s"));
    assert.equal((await isolated.query("select count(*)::int as n from pg_class where relnamespace='public'::regnamespace and relrowsecurity")).rows[0].n, 3);
    await assert.rejects(isolated.exec(counterMigration), { code: "42723" }); await isolated.exec("rollback");
    assert.deepEqual(await counterSnapshot(isolated), before);
  } finally { await isolated.close(); }
});
