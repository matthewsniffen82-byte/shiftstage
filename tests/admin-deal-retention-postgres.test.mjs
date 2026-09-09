import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { before, after, beforeEach, afterEach } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { PublicApiError } from "../src/lib/api-error-policy.ts";

const catalog = JSON.parse(readFileSync(new URL("../docs/supabase-reliability/step-01-inventory.json", import.meta.url), "utf8")).catalog;
const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/dancr/venue-deal-actions.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, console, require: () => ({
  PublicApiError, CLUB_DEAL_COLUMNS: "id",
  toClubDeal: row => ({ id: row.id, isActive: row.is_active }),
}) });
const { removeAdminVenueDeal } = exports;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const venueId = id(1), dealId = id(2);
const quote = value => { assert.match(value, /^[a-z_]+$/); return `"${value}"`; };
const retainedTables = ["qr_redemptions", "commission_events", "deal_revenue_events"];
let pg;

before(async () => {
  // An empty in-memory PostgreSQL instance, never a production connection.
  // Only the columns/FKs involved in these relationships are loaded. This is
  // not full historical replay, Auth integration, or an RLS fixture.
  pg = new PGlite();
  await pg.exec(`
    create table venues (id uuid primary key);
    create table club_deals (id uuid primary key, venue_id uuid not null,
      is_active boolean not null, removed_at timestamptz, updated_at timestamptz,
      created_at timestamptz default now(), check (removed_at is null or not is_active));
    create table venue_club_deal_requests (id uuid primary key, target_deal_id uuid, linked_deal_id uuid);
  `);
  for (const table of retainedTables) await pg.exec(`create table ${quote(table)} (id uuid primary key, club_deal_id uuid);`);
  const relevant = catalog.constraints.filter(c => c.schema_name === "public" && c.type === "f" && (
    c.name === "club_deals_venue_id_fkey" || retainedTables.includes(c.table_name) && c.name === `${c.table_name}_club_deal_id_fkey`
    || c.table_name === "venue_club_deal_requests" && ["venue_club_deal_requests_target_deal_id_fkey", "venue_club_deal_requests_linked_deal_id_fkey"].includes(c.name)
  ));
  assert.equal(relevant.length, 6, "load all reviewed retention FKs");
  for (const c of relevant) await pg.exec(`alter table ${quote(c.table_name)} add constraint ${quote(c.name)} ${c.definition};`);
  await pg.query("insert into venues values ($1)", [venueId]);
  await pg.query("insert into club_deals (id,venue_id,is_active) values ($1,$2,true)", [dealId, venueId]);
  for (const table of retainedTables) await pg.query(`insert into ${quote(table)} values ($1,$2)`, [id(3), dealId]);
  await pg.query("insert into venue_club_deal_requests values ($1,$2,$2)", [id(4), dealId]);
});
after(async () => pg?.close());
beforeEach(async () => pg.exec("begin"));
afterEach(async () => pg.exec("rollback"));

function client() {
  const state = { beforeWriteError: null, afterWriteError: null, catalogError: null, confirmError: null, skipWrite: false, changedRows: 0 };
  const db = { from(table) {
    assert.equal(table, "club_deals");
    const filters = [];
    let update = null;
    let isCatalog = false;
    const execute = async () => {
      if (update && state.beforeWriteError) return { data: null, error: state.beforeWriteError };
      if (!update && isCatalog && state.catalogError) return { data: null, error: state.catalogError };
      if (!update && !isCatalog && state.confirmError) return { data: null, error: state.confirmError };
      if (update && state.skipWrite) return { data: [], error: null };
      const params = [];
      const bind = value => { params.push(value); return `$${params.length}`; };
      const start = update ? `update club_deals set ${Object.entries(update).map(([key, value]) => `${quote(key)}=${bind(value)}`).join(",")}` : "select * from club_deals";
      const where = filters.map(([key, value]) => value === null ? `${quote(key)} is null` : `${quote(key)}=${bind(value)}`).join(" and ");
      const result = await pg.query(`${start}${where ? ` where ${where}` : ""}${update ? " returning *" : ""}`, params);
      if (update) {
        state.changedRows += result.rows.length;
        if (state.afterWriteError) return { data: null, error: state.afterWriteError };
      }
      return { data: result.rows, error: null };
    };
    const q = {
      select() { return q; }, order() { return q; },
      eq(key, value) { filters.push([key, value]); return q; },
      is(key, value) { filters.push([key, value]); return q; },
      update(value) { update = value; return q; },
      delete() { assert.fail("The application must not hard-delete the deal"); },
      async maybeSingle() { const r = await execute(); return { ...r, data: r.data?.[0] || null }; },
      async limit() { isCatalog = true; return execute(); },
    };
    return q;
  } };
  return { db, state };
}
const remove = db => removeAdminVenueDeal(db, venueId, dealId);
const archivedRow = async () => (await pg.query("select * from club_deals where id=$1", [dealId])).rows[0];
async function assertHistoryRetained() {
  for (const table of retainedTables) assert.equal((await pg.query(`select count(*)::int as total from ${quote(table)} where club_deal_id=$1`, [dealId])).rows[0].total, 1);
  const row = (await pg.query("select target_deal_id,linked_deal_id from venue_club_deal_requests")).rows[0];
  assert.deepEqual(row, { target_deal_id: dealId, linked_deal_id: dealId });
}

test("PostgreSQL fixture demonstrates why hard deletion loses financial relationships", async () => {
  // Only synthetic rows in this in-memory transaction are removed, then rolled back.
  await pg.query("delete from club_deals where id=$1", [dealId]);
  for (const table of retainedTables) assert.equal((await pg.query(`select count(*)::int as total from ${quote(table)}`)).rows[0].total, 0);
  assert.deepEqual((await pg.query("select target_deal_id,linked_deal_id from venue_club_deal_requests")).rows[0], { target_deal_id: null, linked_deal_id: null });
});

for (const active of [true, false]) test(`admin removal preserves PostgreSQL relationships for a ${active ? "live" : "paused"} offer`, async () => {
  await pg.query("update club_deals set is_active=$1 where id=$2", [active, dealId]);
  const { db } = client();
  assert.equal((await remove(db)).deals.length, 0);
  assert.equal((await archivedRow()).is_active, false);
  assert.ok((await archivedRow()).removed_at);
  await assertHistoryRetained();
});

test("a repeated or queued removal leaves one archived row and its original timestamp", async () => {
  const { db, state } = client();
  await Promise.all([remove(db), remove(db)]);
  const timestamp = (await archivedRow()).removed_at;
  await remove(db);
  assert.equal((await archivedRow()).removed_at.getTime(), timestamp.getTime());
  assert.equal(state.changedRows, 1);
  await assertHistoryRetained();
});

test("a lost response after PostgreSQL commit is recoverable without a second row change", async () => {
  const { db, state } = client();
  const error = { code: "57014" };
  state.afterWriteError = error;
  await assert.rejects(remove(db), e => e === error);
  const timestamp = (await archivedRow()).removed_at;
  state.afterWriteError = null;
  assert.equal((await remove(db)).id, dealId);
  assert.equal(state.changedRows, 1);
  assert.equal((await archivedRow()).removed_at.getTime(), timestamp.getTime());
  await assertHistoryRetained();
});

test("database and post-commit catalog failures can be retried without losing history", async () => {
  const { db, state } = client();
  const error = { code: "08006" };
  state.beforeWriteError = error;
  await assert.rejects(remove(db), e => e === error);
  assert.equal((await archivedRow()).removed_at, null);
  state.beforeWriteError = null;
  state.catalogError = error;
  await assert.rejects(remove(db), e => e === error);
  state.catalogError = null;
  await remove(db);
  assert.equal(state.changedRows, 1);
  await assertHistoryRetained();
});

test("an unconfirmed zero-row write is never treated as a successful removal", async () => {
  const { db, state } = client();
  state.skipWrite = true;
  await assert.rejects(remove(db), e => e instanceof PublicApiError && e.status === 409);
  const error = { code: "57014" };
  state.confirmError = error;
  await assert.rejects(remove(db), e => e === error);
  assert.equal((await archivedRow()).removed_at, null);
});

test("the retry confirmation cannot see a removed offer under another venue", async () => {
  const { db } = client();
  await remove(db);
  await assert.rejects(removeAdminVenueDeal(db, id(9), dealId), e => e.status === 404);
  await assertHistoryRetained();
});
