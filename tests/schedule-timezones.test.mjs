import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test, { before, after } from 'node:test';
import vm from 'node:vm';
const require = createRequire(new URL('../package.json',import.meta.url));
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const source = readFileSync(new URL('../src/lib/dancr/schedule.ts', import.meta.url), 'utf8');
const api = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api, Intl, Date });
const { getScheduleDateWindow, getTonightWindow, localDateInTimeZone, isValidScheduleDate, isValidShiftRange } = api;
let pg;
before(async () => { pg = new PGlite(); });
after(async () => { await pg?.close(); });

const unique = [
  ['Australia/Sydney', '2026-10-04', '2026-10-03T14:01:00.000Z', 23],
  ['Australia/Sydney', '2027-04-04', '2027-04-03T13:01:00.000Z', 25],
  ['Australia/Adelaide', '2026-10-04', '2026-10-03T14:31:00.000Z', 23],
  ['Australia/Adelaide', '2027-04-04', '2027-04-03T13:31:00.000Z', 25],
  ['Australia/Lord_Howe', '2026-10-04', '2026-10-03T13:31:00.000Z', 23.5],
  ['Australia/Lord_Howe', '2027-04-04', '2027-04-03T13:01:00.000Z', 24.5],
  ['Pacific/Chatham', '2026-09-27', '2026-09-26T11:16:00.000Z', 23],
  ['Pacific/Chatham', '2027-04-04', '2027-04-03T10:16:00.000Z', 25],
  ['Pacific/Auckland', '2026-09-27', '2026-09-26T12:01:00.000Z', 23],
  ['America/Los_Angeles', '2026-11-01', '2026-11-01T07:01:00.000Z', 25],
  ['America/Los_Angeles', '2027-03-14', '2027-03-14T08:01:00.000Z', 23],
  ['America/New_York', '2026-11-01', '2026-11-01T04:01:00.000Z', 25],
  ['America/St_Johns', '2027-03-14', '2027-03-14T03:31:00.000Z', 23],
  ['Europe/London', '2026-10-25', '2026-10-24T23:01:00.000Z', 25],
  ['Europe/Berlin', '2027-03-28', '2027-03-27T23:01:00.000Z', 23],
  ['Asia/Kathmandu', '2026-10-04', '2026-10-03T18:16:00.000Z', 24],
  ['Asia/Kolkata', '2026-10-04', '2026-10-03T18:31:00.000Z', 24],
  ['Pacific/Kiritimati', '2026-12-31', '2026-12-30T10:01:00.000Z', 24],
  ['Pacific/Pago_Pago', '2026-12-31', '2026-12-31T11:01:00.000Z', 24],
  ['UTC', '2028-02-29', '2028-02-29T00:01:00.000Z', 24],
];
for (const [zone, day, start, hours] of unique) {
  test(`schedule ${zone} ${day} retains its local date across ${hours} hours`, async () => {
    const w = getScheduleDateWindow(day, zone);
    assert.equal(w.startsAt, start);
    assert.equal(w.activeAfter, start);
    assert.equal(w.timeZone, zone);
    assert.equal(Date.parse(w.endsAt) - Date.parse(w.startsAt), hours * 3600_000);
    assert.equal(localDateInTimeZone(zone, new Date(w.startsAt)), day);
    assert.equal(isValidShiftRange(w.startsAt, w.endsAt), true);
    const native = (await pg.query(`select
      (($1::date + time '00:01') at time zone $2)::text as starts,
      (($1::date + 1 + time '00:01') at time zone $2)::text as ends`, [day, zone])).rows[0];
    assert.equal(w.startsAt, new Date(native.starts).toISOString());
    assert.equal(w.endsAt, new Date(native.ends).toISOString());
    const now = new Date(Date.parse(start) + 4 * 3600_000);
    const tonight = getTonightWindow(zone, now);
    assert.equal(tonight.startsAt, w.startsAt);
    assert.equal(tonight.endsAt, w.endsAt);
    assert.equal(tonight.activeAfter, now.toISOString());
  });
}

test('a repeated midnight selects its first occurrence and covers both clock passes', () => {
  const w = getScheduleDateWindow('2026-11-01', 'America/Havana');
  assert.equal(w.startsAt, '2026-11-01T04:01:00.000Z');
  assert.equal(w.endsAt, '2026-11-02T05:01:00.000Z');
  for (const utc of ['2026-11-01T04:01:00Z', '2026-11-01T05:01:00Z'])
    assert.equal(localDateInTimeZone('America/Havana', new Date(utc)), '2026-11-01');
});
test('a skipped midnight advances across the gap without using the previous local date', () => {
  const w = getScheduleDateWindow('2026-03-08', 'America/Havana');
  assert.equal(w.startsAt, '2026-03-08T05:01:00.000Z');
  assert.equal(w.endsAt, '2026-03-09T04:01:00.000Z');
  assert.equal(localDateInTimeZone('America/Havana', new Date(w.startsAt)), '2026-03-08');
});
test('a completely skipped local date is rejected, while the preceding day still ends correctly', () => {
  assert.throws(() => getScheduleDateWindow('2011-12-30', 'Pacific/Apia'), /valid shift date/);
  const w = getScheduleDateWindow('2011-12-29', 'Pacific/Apia');
  assert.equal(w.startsAt, '2011-12-29T10:01:00.000Z');
  assert.equal(w.endsAt, '2011-12-30T10:01:00.000Z');
  assert.equal(localDateInTimeZone('Pacific/Apia', new Date(w.endsAt)), '2011-12-31');
});

for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-1-01', '09/12/2026', '2026-09-12T00:00:00Z', 'infinity', '-infinity', '', '2026-09-12\n'])
  test(`invalid calendar input ${JSON.stringify(value)} cannot normalize into a different date`, () => {
    assert.throws(() => getScheduleDateWindow(value, 'UTC'), /valid shift date/);
    assert.equal(isValidScheduleDate(value, 'UTC', new Date('2026-09-12T12:00:00Z')), false);
  });

test('invalid timezone input fails closed at scheduling validation', () => {
  for (const zone of ['', 'Mars/Olympus', 'America/Los Angeles', 'infinity']) {
    assert.throws(() => getScheduleDateWindow('2026-09-12', zone));
    assert.equal(isValidScheduleDate('2026-09-12', zone, new Date('2026-09-12T12:00:00Z')), false);
  }
});
test('schedule eligibility uses the venue local date rather than the server UTC day', () => {
  const now = new Date('2026-09-12T02:00:00Z');
  assert.equal(isValidScheduleDate('2026-09-11', 'America/Los_Angeles', now), true);
  assert.equal(isValidScheduleDate('2026-09-10', 'America/Los_Angeles', now), false);
  assert.equal(isValidScheduleDate('2026-09-11', 'Pacific/Auckland', now), false);
  assert.equal(isValidScheduleDate('2026-09-12', 'Pacific/Auckland', now), true);
  assert.equal(isValidScheduleDate('2027-09-13', 'UTC', now), true);
  assert.equal(isValidScheduleDate('2027-09-14', 'UTC', now), false);
});
test('invalid instants and reversed or equal ranges never become a valid shift', () => {
  for (const [start, end] of [['infinity','infinity'], ['invalid','2026-01-01'], ['2026-01-01','invalid'], ['2026-01-01','2026-01-01'], ['2026-01-02','2026-01-01']])
    assert.equal(isValidShiftRange(start, end), false);
  assert.equal(isValidScheduleDate('2026-09-12', 'UTC', new Date(NaN)), false);
});
test('adjacent scheduled days share a boundary around both Sydney clock changes', () => {
  for (const [first, second] of [['2026-10-03','2026-10-04'], ['2026-10-04','2026-10-05'], ['2027-04-03','2027-04-04'], ['2027-04-04','2027-04-05']])
    assert.equal(getScheduleDateWindow(first, 'Australia/Sydney').endsAt, getScheduleDateWindow(second, 'Australia/Sydney').startsAt);
});
test('the supported historical Gregorian range keeps leading-zero year input valid', () => {
  for (const day of ['0100-01-01', '0999-12-31'])
    assert.equal(getScheduleDateWindow(day, 'UTC').startsAt, day + 'T00:01:00.000Z');
});
