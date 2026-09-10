import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { createNfcDatabase, seedNfcDatabase, nfcSnapshot, requestNfcSupport, fixtureId, nfcMigration, nfcSchema, nfcSignature, supportSignature, targetTables } from "./helpers/nfc-support-database.mjs";

let pg;
before(async () => { pg = await createNfcDatabase(); });
beforeEach(async () => { await seedNfcDatabase(pg); });
after(async () => { await pg?.close(); });

for (const type of ["damaged", "lost", "relocate", "replacement"]) {
  test(type + " commits one request, linked human message, thread and admin notification together", async () => {
    const before = await nfcSnapshot(pg);
    const result = await requestNfcSupport(pg, { type });
    const after = await nfcSnapshot(pg);
    assert.equal(result.duplicate, false);
    assert.equal(result.request.id, fixtureId(100));
    assert.equal(result.request.request_type, type);
    assert.equal(result.request.status, "open");
    for (const table of targetTables) assert.equal(after[table].length, 1, table);
    const message = after.support_messages[0];
    assert.equal(message.id, result.request.id);
    assert.equal(message.thread_id, result.threadId);
    assert.equal(message.sender_id, fixtureId(1));
    assert.equal(message.sender_kind, "human");
    assert.equal(message.body, `Synthetic venue requested ${type} tap-sticker support.\nSticker: Synthetic sticker (dressing room)\nRequest ID: ${fixtureId(100)}\nNotes: Synthetic details`);
    assert.equal(after.notifications[0].recipient_id, fixtureId(5));
    assert.equal(after.notifications[0].payload.threadId, result.threadId);
    assert.equal(result.notifications[0].id, after.notifications[0].id);
    for (const table of ["app_users", "venues", "nfc_tags", "venue_team_members"]) assert.deepEqual(after[table], before[table]);
  });
}
for (const [n, role] of [[1, "owner"], [2, "manager"], [3, "staff"]]) {
  test("active " + role + " can request support for an unpublished venue", async () => {
    const result = await requestNfcSupport(pg, { user: fixtureId(n) });
    assert.equal(result.request.requested_by_user_id, fixtureId(n));
    assert.equal((await nfcSnapshot(pg)).support_threads[0].user_id, fixtureId(n));
  });
}
for (const status of ["disabled", "revoked"]) {
  test("an assigned " + status + " sticker remains eligible for support", async () => {
    await pg.query("update public.nfc_tags set status=$1 where id=$2", [status, fixtureId(20)]);
    assert.equal((await requestNfcSupport(pg)).request.nfc_tag_id, fixtureId(20));
  });
}
for (const [name, input, code] of [
  ["other venue owner", { user: fixtureId(4) }, "42501"],
  ["administrator actor", { user: fixtureId(5) }, "42501"],
  ["dancer actor", { user: fixtureId(6) }, "42501"],
  ["customer actor", { user: fixtureId(7) }, "42501"],
  ["missing actor", { user: fixtureId(999) }, "42501"],
  ["missing venue", { venue: fixtureId(999) }, "42501"],
  ["missing sticker", { tag: fixtureId(999) }, "P0002"],
  ["another venue sticker", { tag: fixtureId(21) }, "P0002"],
  ["empty type", { type: "" }, "22023"],
  ["unsupported type", { type: "approved" }, "22023"],
  ["oversized notes", { notes: "x".repeat(1001) }, "22023"],
  ...["user", "venue", "tag", "type", "id"].map(key => ["null " + key, { [key]: null }, "22023"]),
]) {
  test("rejects " + name + " without partial records", async () => {
    const before = await nfcSnapshot(pg);
    await assert.rejects(requestNfcSupport(pg, input), { code });
    assert.deepEqual(await nfcSnapshot(pg), before);
  });
}
for (const state of ["disabled", "deleted"]) {
  for (const [user, blocked] of [[1, 1], [2, 1], [2, 2]]) {
    test(`${state} account ${blocked} denies actor ${user} without writing`, async () => {
      await pg.query("update public.app_users set account_state=$1 where id=$2", [state, fixtureId(blocked)]);
      const before = await nfcSnapshot(pg);
      await assert.rejects(requestNfcSupport(pg, { user: fixtureId(user) }), { code: "42501" });
      assert.deepEqual(await nfcSnapshot(pg), before);
    });
  }
}
for (const sql of ["delete from public.venue_team_members", "update public.venue_team_members set status='removed'", "update public.venue_team_members set role='viewer'", "update public.venues set owner_user_id=null"]) {
  test("stale venue access is rechecked: " + sql, async () => {
    await pg.exec(sql);
    const before = await nfcSnapshot(pg);
    await assert.rejects(requestNfcSupport(pg, { user: fixtureId(2) }), { code: "42501" });
    assert.deepEqual(await nfcSnapshot(pg), before);
  });
}
for (const notes of [null, "", "   "]) {
  test("normalizes optional notes " + JSON.stringify(notes), async () => {
    assert.equal((await requestNfcSupport(pg, { notes })).request.notes, null);
    assert.equal((await requestNfcSupport(pg, { notes: null })).duplicate, true);
    assert.match((await nfcSnapshot(pg)).support_messages[0].body, /Notes: None provided\.$/);
  });
}
test("replay after a lost response returns the existing request without duplicate records or notifications", async () => {
  const first = await requestNfcSupport(pg);
  const before = await nfcSnapshot(pg);
  const replay = await requestNfcSupport(pg, { notes: "  Synthetic details  " });
  assert.deepEqual(replay, { ...first, duplicate: true, notifications: [] });
  assert.deepEqual(await nfcSnapshot(pg), before);
});
test("queued same-key requests on one PGlite connection do not duplicate records", async () => {
  const results = await Promise.all([requestNfcSupport(pg), requestNfcSupport(pg)]);
  assert.equal(results.filter(row => row.duplicate).length, 1);
  for (const table of targetTables) assert.equal((await nfcSnapshot(pg))[table].length, 1);
});
test("new intentional request keys produce separate requests", async () => {
  await requestNfcSupport(pg);
  assert.equal((await requestNfcSupport(pg, { id: fixtureId(101) })).duplicate, false);
  for (const table of targetTables) assert.equal((await nfcSnapshot(pg))[table].length, 2);
});
for (const input of [{ notes: "Different notes" }, { type: "lost" }, { user: fixtureId(2) }, { venue: fixtureId(11), tag: fixtureId(21), user: fixtureId(4) }]) {
  test("rejects conflicting reused request identity " + JSON.stringify(input), async () => {
    await requestNfcSupport(pg);
    const before = await nfcSnapshot(pg);
    await assert.rejects(requestNfcSupport(pg, input), { code: "22023" });
    assert.deepEqual(await nfcSnapshot(pg), before);
  });
}
for (const status of ["in_progress", "resolved", "cancelled"]) {
  test("replay preserves " + status + " request and answered support thread", async () => {
    await requestNfcSupport(pg);
    await pg.query("update public.venue_nfc_support_requests set status=$1,resolved_at=now()", [status]);
    await pg.exec("update public.support_threads set status='answered'");
    const before = await nfcSnapshot(pg);
    assert.equal((await requestNfcSupport(pg)).request.status, status);
    assert.deepEqual(await nfcSnapshot(pg), before);
  });
}
test("missing prior message linkage fails without deleting or repairing the existing request", async () => {
  await requestNfcSupport(pg);
  await pg.exec("delete from public.support_messages");
  const before = await nfcSnapshot(pg);
  await assert.rejects(requestNfcSupport(pg), { code: "40001" });
  assert.deepEqual(await nfcSnapshot(pg), before);
});
test("an unrelated existing message key cannot be adopted or overwritten", async () => {
  await pg.query("select public.create_support_message_safely($1,'venue',null,'Existing','Different body',$2)", [fixtureId(1), fixtureId(100)]);
  const before = await nfcSnapshot(pg);
  await assert.rejects(requestNfcSupport(pg), { code: "22023" });
  assert.deepEqual(await nfcSnapshot(pg), before);
});
test("the nested support send limit rolls back the thirteenth new request and allows completed retries", async () => {
  for (let n = 100; n < 112; n++) await requestNfcSupport(pg, { id: fixtureId(n) });
  const before = await nfcSnapshot(pg);
  await assert.rejects(requestNfcSupport(pg, { id: fixtureId(112) }), /rate limit/);
  assert.equal((await requestNfcSupport(pg)).duplicate, true);
  assert.deepEqual(await nfcSnapshot(pg), before);
});
for (const table of targetTables) {
  test(table + " insert failure rolls back every part of the request", async () => {
    const before = await nfcSnapshot(pg);
    await pg.exec(`reset role;create or replace function public.synthetic_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic insert failure';end$$;
      create trigger synthetic_failure before insert on public.${table} for each row execute function public.synthetic_failure();set role service_role`);
    await assert.rejects(requestNfcSupport(pg), /synthetic insert failure/);
    assert.deepEqual(await nfcSnapshot(pg), before);
  });
}
for (const role of ["anon", "authenticated"]) {
  test(role + " cannot invoke either privileged helper", async () => {
    const before = await nfcSnapshot(pg);
    await pg.exec("set role " + role);
    await assert.rejects(requestNfcSupport(pg), { code: "42501" });
    await assert.rejects(pg.query("select public.create_support_message_safely($1,'venue',null,'Synthetic','Synthetic',$2)", [fixtureId(1), fixtureId(100)]), { code: "42501" });
    await pg.exec("set role service_role");
    assert.deepEqual(await nfcSnapshot(pg), before);
  });
}
test("the additive migration retains data, nested helper, RLS and bounded invoker privileges", async () => {
  const isolated = await createNfcDatabase({ migrate: false });
  try {
    await seedNfcDatabase(isolated);
    await isolated.query("select public.create_support_message_safely($1,'venue',null,'Existing','Keep existing content',$2)", [fixtureId(1), fixtureId(100)]);
    const before = await nfcSnapshot(isolated);
    await isolated.exec("reset role");
    const nestedBefore = (await isolated.query("select md5(pg_get_functiondef($1::regprocedure)) as hash", [supportSignature])).rows[0].hash;
    assert.equal(nestedBefore, nfcSchema.support_function.fingerprint);
    await isolated.exec(nfcMigration);
    assert.deepEqual(await nfcSnapshot(isolated), before);
    assert.equal((await isolated.query("select md5(pg_get_functiondef($1::regprocedure)) as hash", [supportSignature])).rows[0].hash, nestedBefore);
    const row = (await isolated.query("select prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [nfcSignature])).rows[0];
    assert.equal(row.prosecdef, false);
    assert.ok(row.proconfig.includes('search_path=""'));
    assert.ok(row.proconfig.includes("lock_timeout=3s"));
    assert.equal((await isolated.query("select count(*)::int as n from pg_class where relnamespace='public'::regnamespace and relrowsecurity")).rows[0].n, 4);
    await assert.rejects(isolated.exec(nfcMigration), { code: "42723" });
    await isolated.exec("rollback");
    assert.deepEqual(await nfcSnapshot(isolated), before);
  } finally { await isolated.close(); }
});
