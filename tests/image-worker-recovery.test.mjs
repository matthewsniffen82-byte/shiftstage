import assert from "node:assert/strict";
import { test, before, beforeEach, after } from "node:test";
import {
  createAvatarDatabase, seedAvatarDatabase, avatarDatabaseClient, readAvatarRecord,
  avatarUser, avatarTemp,
} from "./helpers/avatar-publication-database.mjs";
import { loadAvatarCaller } from "./helpers/avatar-publication-fixture.mjs";

let db;
before(async () => { db = await createAvatarDatabase(); });
beforeEach(async () => { await seedAvatarDatabase(db); });
after(async () => { await db?.close(); });
const stale = "2020-01-01T00:00:00Z";
const cron = () => loadAvatarCaller("app/api/cron/image-moderation/route.ts");

async function seed(overrides = {}) {
  const row = {
    user_id: avatarUser, temporary_storage_path: avatarTemp("worker-recovery"),
    upload_context: "profile_avatar", provider: "openai", provider_model: "synthetic",
    decision: "review", status: "moderating", attempt_count: 1,
    updated_at: stale, locked_at: stale, next_attempt_at: null,
    idempotency_key: "synthetic-worker-recovery", ...overrides,
  };
  const columns = Object.keys(row);
  const result = await db.query(`insert into public.image_moderation_records (${columns.map(name => '"' + name + '"').join(",")})
    select ${columns.map(name => '"' + name + '"').join(",")} from jsonb_populate_record(null::public.image_moderation_records,$1::jsonb)
    returning id`, [JSON.stringify(row)]);
  return readAvatarRecord(db, result.rows[0].id);
}

for (const locked_at of [null, stale]) test(`a stale image worker with ${locked_at ? "an expired" : "no"} lock is claimed with one atomic attempt increment`, async () => {
  const selected = await seed({ locked_at });
  const claimed = await cron().claimRetryRecord(avatarDatabaseClient(db), selected);
  assert.equal(claimed.status, "moderating");
  assert.equal(claimed.attempt_count, 2);
  assert.notEqual(claimed.updated_at, selected.updated_at);
  assert.ok(Date.parse(claimed.locked_at) > Date.parse(stale));
  assert.equal(claimed.updated_at, (await readAvatarRecord(db, selected.id)).updated_at);
});

for (const [name, values] of [
  ["a recent update", () => ({ updated_at: new Date().toISOString() })],
  ["a recent lock", () => ({ locked_at: new Date().toISOString() })],
  ["a future retry", () => ({ status: "moderation_retry", next_attempt_at: new Date(Date.now() + 60000).toISOString() })],
  ["human review", () => ({ status: "pending_review" })],
  ["a final rejection", () => ({ status: "rejected", decision: "rejected" })],
  ["a recorded reviewer decision", () => ({ review_decision: "rejected" })],
]) test(`recovery leaves ${name} unchanged`, async () => {
  const selected = await seed(values());
  assert.equal(await cron().claimRetryRecord(avatarDatabaseClient(db), selected), null);
  assert.deepEqual(await readAvatarRecord(db, selected.id), selected);
});

for (const attempt of [4, 7]) test(`a stale worker at attempt ${attempt} retains its source and goes to human review`, async () => {
  const selected = await seed({ attempt_count: attempt });
  const client = avatarDatabaseClient(db);
  const result = await cron().claimRetryRecord(client, selected);
  assert.equal(result.status, "moderation_error");
  assert.equal(result.attempt_count, attempt);
  assert.equal(result.last_error_code, "automatic_attempts_exhausted");
  assert.equal(result.temporary_storage_path, selected.temporary_storage_path);
  assert.equal(result.locked_at, null);
  assert.equal(client.removed.length, 0);
});

test("two competing claims execute native compare-and-set and only one obtains the next attempt", async () => {
  const selected = await seed();
  const claims = await Promise.all([
    cron().claimRetryRecord(avatarDatabaseClient(db), selected),
    cron().claimRetryRecord(avatarDatabaseClient(db), selected),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await readAvatarRecord(db, selected.id)).attempt_count, 2);
});

test("a reclaimed worker rejects the old worker's later result", async () => {
  const selected = await seed();
  const client = avatarDatabaseClient(db);
  const claimed = await cron().claimRetryRecord(client, selected);
  const caller = loadAvatarCaller("src/lib/dancr/image-moderation.ts");
  await assert.rejects(caller.updateModerationRecord(client, selected.id, {
    decision: "approved", status: "approved",
  }, selected.updated_at), { status: 409 });
  assert.deepEqual(await readAvatarRecord(db, selected.id), claimed);
});

test("a crash after claiming already consumed an attempt", async () => {
  const selected = await seed();
  const claimed = await cron().claimRetryRecord(avatarDatabaseClient(db), selected);
  assert.equal(claimed.attempt_count, 2);
  assert.equal(await cron().claimRetryRecord(avatarDatabaseClient(db), claimed), null);
  assert.equal((await readAvatarRecord(db, selected.id)).attempt_count, 2);
});
