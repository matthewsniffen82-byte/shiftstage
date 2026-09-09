import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { before, after, beforeEach } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';
import { PublicApiError } from '../src/lib/api-error-policy.ts';

const migration = readFileSync(new URL('../supabase/migrations/20260909183820_prevent_duplicate_scheduled_dates.sql', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/lib/dancr/shift-lifecycle.ts', import.meta.url), 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, console, require: () => ({ PublicApiError }) });
const { createScheduledDancerShift, updateOwnedDancerShift } = exports;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = {
  dancerId: id(1), venueId: id(2), shiftDate: '2030-06-01',
  startsAt: '2030-06-01T07:00:00Z', endsAt: '2030-06-02T07:00:00Z', timezone: 'America/Los_Angeles',
};
const schema = `
  create type public.shift_status as enum ('draft','posted','cancelled','completed');
  create table public.shifts (
    id uuid primary key default gen_random_uuid(), dancer_id uuid not null,
    venue_id uuid not null, shift_date date not null, shift_source text not null,
    starts_at timestamptz not null, ends_at timestamptz not null, timezone text not null,
    status public.shift_status not null, checked_in_at timestamptz, checked_out_at timestamptz
  );
`;
let pg;
before(async () => { pg = new PGlite(); await pg.exec(schema); await pg.exec(migration); });
after(async () => pg?.close());
beforeEach(async () => pg.exec('truncate public.shifts'));
const quote = value => { assert.match(value, /^[a-z_]+$/); return `"${value}"`; };

function client(forcedError = null) {
  return { from(table) {
    assert.equal(table, 'shifts');
    const filters = [];
    let values, operation;
    const execute = async () => {
      if (forcedError) return { data: null, error: forcedError };
      const params = [];
      const bind = value => { params.push(value); return `$${params.length}`; };
      const sql = operation === 'insert'
        ? `insert into public.shifts (${Object.keys(values).map(quote).join(',')}) values (${Object.values(values).map(bind).join(',')})`
        : `update public.shifts set ${Object.entries(values).map(([key, value]) => `${quote(key)}=${bind(value)}`).join(',')}`;
      const where = filters.map(([key, op, value]) => key === 'active'
        ? '(checked_in_at is null or checked_out_at is not null)' : `${quote(key)}${op}${bind(value)}`).join(' and ');
      try {
        const result = await pg.query(`${sql}${where ? ` where ${where}` : ''} returning id`, params);
        return { data: result.rows[0] || null, error: null };
      } catch (error) { return { data: null, error }; }
    };
    const q = {
      insert(row) { operation = 'insert'; values = row; return q; },
      update(row) { operation = 'update'; values = row; return q; },
      select() { return q; },
      eq(key, value) { filters.push([key, '=', value]); return q; },
      neq(key, value) { filters.push([key, '<>', value]); return q; },
      or(value) { assert.equal(value, 'checked_in_at.is.null,checked_out_at.not.is.null'); filters.push(['active']); return q; },
      single: execute, maybeSingle: execute,
    };
    return q;
  } };
}
const create = (change = {}, db = client()) => createScheduledDancerShift(db, { ...input, ...change });
const count = async () => (await pg.query('select count(*)::int as n from public.shifts')).rows[0].n;
const conflict = error => error instanceof PublicApiError && error.status === 409 && error.code === 'CONFLICT';

test('queued competing date submissions produce one row and a clear conflict', async () => {
  const results = await Promise.allSettled([create(), create()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.ok(conflict(results.find(result => result.status === 'rejected').reason));
  assert.equal(await count(), 1);
});

test('retry after a lost response cannot duplicate or overwrite a posted date', async () => {
  const row = await create();
  const original = (await pg.query('select * from public.shifts')).rows;
  await assert.rejects(create(), conflict);
  assert.deepEqual((await pg.query('select * from public.shifts')).rows, original);
  assert.equal(original[0].id, row.id);
});

test('editing into an existing posted date fails without changing either row', async () => {
  await create();
  const next = await create({ shiftDate: '2030-06-02' });
  const original = (await pg.query('select * from public.shifts order by id')).rows;
  await assert.rejects(updateOwnedDancerShift(client(), input.dancerId, next.id, { shift_date: input.shiftDate }), conflict);
  assert.deepEqual((await pg.query('select * from public.shifts order by id')).rows, original);
});

test('different dancers, clubs and dates remain independent', async () => {
  await create();
  await create({ dancerId: id(3) });
  await create({ venueId: id(4) });
  await create({ shiftDate: '2030-06-02' });
  assert.equal(await count(), 4);
});

test('cancelled dates can be reposted without deleting their history', async () => {
  const previous = await create();
  await updateOwnedDancerShift(client(), input.dancerId, previous.id, { status: 'cancelled' });
  const next = await create();
  assert.notEqual(previous.id, next.id);
  assert.equal(await count(), 2);
});

test('drafts, completed dates, NFC presence and demo assignments retain their separate semantics', async () => {
  const first = await create();
  for (const [status, sourceType] of [['draft','scheduled'], ['completed','scheduled'], ['posted','nfc_presence'], ['posted','demo_locked']]) {
    await pg.query(`insert into public.shifts (dancer_id,venue_id,shift_date,shift_source,starts_at,ends_at,timezone,status)
      select dancer_id,venue_id,shift_date,$1,starts_at,ends_at,timezone,$2::public.shift_status from public.shifts where id=$3`, [sourceType, status, first.id]);
  }
  assert.equal(await count(), 5);
});

test('unrelated database failures are not mislabeled as date conflicts or retried', async () => {
  for (const error of [{ code: '08006', message: 'connection lost' }, { code: '23505', message: 'duplicate key violates "shifts_pkey"' }]) {
    await assert.rejects(create({}, client(error)), caught => caught === error);
  }
  assert.equal(await count(), 0);
});

test('migration rejects pre-existing duplicates atomically and preserves every row', async () => {
  const isolated = new PGlite();
  try {
    await isolated.exec(schema);
    for (let n = 0; n < 2; n++) await isolated.query(`insert into public.shifts
      (dancer_id,venue_id,shift_date,shift_source,starts_at,ends_at,timezone,status)
      values ($1,$2,$3,'scheduled',$4,$5,$6,'posted')`, [input.dancerId,input.venueId,input.shiftDate,input.startsAt,input.endsAt,input.timezone]);
    const beforeRows = (await isolated.query('select * from public.shifts order by id')).rows;
    await assert.rejects(isolated.exec(migration), error => error.code === '23505');
    await isolated.exec('rollback');
    assert.deepEqual((await isolated.query('select * from public.shifts order by id')).rows, beforeRows);
    assert.equal((await isolated.query("select count(*)::int as n from pg_indexes where indexname='shifts_one_posted_scheduled_date_idx'")).rows[0].n, 0);
  } finally { await isolated.close(); }
});
