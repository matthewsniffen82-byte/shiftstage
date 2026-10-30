import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { venueOperatingStatus as savedVenueStatus } from "../src/lib/dancr/venue-operating-status.ts";

import { legacyVenueWeek, formatWeeklyVenueHours } from "../src/lib/dancr/venue-weekly-hours.ts";

function loadFunctions(file, names, globals = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text));
  assert.equal(selected.length, names.length);
  const exports = {};
  const code = selected.map(node => node.getText(ast)).join("\n") + `\nexport { ${names.join(", ")} };`;
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, ...globals });
  return exports;
}

const { formatVenueHours } = loadFunctions("src/lib/dancr/public.ts", ["formatVenueHours", "formatTimeOnly"]);
const { formatVenueReviewHours } = loadFunctions("app/dashboard/DashboardShared.tsx", ["formatVenueReviewHours"], { formatWeeklyVenueHours });
const { parseClockMinutes } = loadFunctions("src/live-shell/app/06-rank-label.js", ["parseClockMinutes"]);
const { displayShiftTime } = loadFunctions("src/live-shell/app/07-shift-window-for-date.js", ["shortMeridiemTime", "displayShiftTime"]);
const { venueOperatingStatus } = loadFunctions("src/live-shell/app/11-post-verified-shift.js", ["venueOperatingStatus"], {
  parseClockMinutes, displayShiftTime,
  // The unchanged city clock supplies a Date whose UTC fields are local wall time.
  cityWallClock: date => date,
});

test("public club hours label equal opening and closing times as 24 hours", () => {
  for (const [opens, closes] of [["00:00:00", "00:00:00"], ["00:00", "00:00:00"], ["08:30:00", "08:30:00"]]) {
    assert.equal(formatVenueHours(opens, closes), "24 hours");
  }
  assert.equal(formatVenueHours("20:00:00", "04:00:00"), "8:00p - 4:00a");
  assert.equal(formatVenueHours(null, "04:00:00"), null);
  assert.equal(formatVenueHours("20:00:00", null), null);
  assert.notEqual(formatVenueHours("25:00:00", "25:00:00"), "24 hours");
});

test("the club dashboard review also labels saved 24-hour opening clearly", () => {
  for (const [opens, closes] of [["00:00:00", "00:00"], ["08:30:00", "08:30:00"]]) {
    assert.equal(formatVenueReviewHours(opens, closes), "24 hours");
  }
  assert.equal(formatVenueReviewHours("20:00:00", "04:00:00"), "8:00 PM – 4:00 AM");
  assert.equal(formatVenueReviewHours(null, null), "");
  assert.equal(formatVenueReviewHours("25:00", "25:00"), "");
  assert.equal(formatVenueReviewHours("08:60", "08:60"), "");
});

test("discovery cards and club profiles show 24-hour clubs open throughout the day", () => {
  const hours = formatVenueHours("00:00:00", "00:00:00");
  for (let hour = 0; hour < 24; hour += 1) {
    const now = new Date(Date.UTC(2026, 9, 24, hour));
    for (const label of [hours, "12:00a - 12:00a", "12:00 AM - 12:00 AM"]) {
      const status = venueOperatingStatus(label, "Las Vegas", now);
      assert.equal(status.state, "open");
      assert.equal(status.label, "Open");
      assert.equal(status.hoursLabel, "24 hours");
    }
  }
});

test("Saved club cards also stay open all day including local midnight", () => {
  const venue = { opensAt: "00:00:00", closesAt: "00:00:00", timezone: "America/Los_Angeles" };
  for (let hour = 0; hour < 24; hour += 1) {
    assert.equal(savedVenueStatus(venue, new Date(Date.UTC(2026, 9, 24, hour))).state, "open");
  }
});

test("ordinary overnight hours still open and close on schedule", () => {
  for (const [hour, state] of [[0, "open"], [3, "open"], [4, "closed"], [12, "closed"], [20, "open"], [23, "open"]]) {
    const status = venueOperatingStatus("8:00p - 4:00a", "Las Vegas", new Date(Date.UTC(2026, 9, 24, hour)));
    assert.equal(status.state, state);
    assert.equal(status.hoursLabel, "8:00p - 4:00a");
  }
});

test("missing or unrecognized club hours remain unavailable", () => {
  for (const hours of [null, "", "Unknown", "24", "24 hours pending", "invalid - invalid"]) {
    assert.equal(venueOperatingStatus(hours, "Las Vegas").state, "unknown");
  }
});

test("selected opening days govern both public and saved clubs, including the overnight boundary", () => {
  const schedules = [
    { days: [5], time: '2026-10-30T03:00:00Z', state: 'closed' },
    { days: [5], time: '2026-10-30T20:00:00Z', state: 'open' },
    { days: [5], time: '2026-10-31T03:59:00Z', state: 'open' },
    { days: [5], time: '2026-10-31T04:00:00Z', state: 'closed' },
    { days: [5], time: '2026-10-31T20:00:00Z', state: 'closed' },
    { days: [5, 6], time: '2026-10-31T20:00:00Z', state: 'open' },
    { days: [0], time: '2026-11-02T02:00:00Z', state: 'open' },
    { days: [6], time: '2026-11-01T02:00:00Z', state: 'open' },
  ];
  for (const { days, time, state } of schedules) {
    const now = new Date(time);
    assert.equal(venueOperatingStatus('8:00p - 4:00a', 'Las Vegas', now, days).state, state, time);
    assert.equal(savedVenueStatus({ opensAt: '20:00', closesAt: '04:00', timezone: 'UTC', openDays: days }, now).state, state, time);
  }
});

test("daytime and 24-hour schedules close on unselected days", () => {
  for (const [time, state] of [['2026-10-30T10:00:00Z', 'open'], ['2026-10-31T10:00:00Z', 'closed']]) {
    for (const [hours, opensAt, closesAt] of [['24 hours', '00:00', '00:00'], ['9:00a - 6:00p', '09:00', '18:00']]) {
      assert.equal(venueOperatingStatus(hours, 'Las Vegas', new Date(time), [5]).state, state);
      assert.equal(savedVenueStatus({ opensAt, closesAt, timezone: 'UTC', openDays: [5] }, new Date(time)).state, state);
    }
  }
  const hours = { opensAt: '00:00', closesAt: '00:00', timezone: 'America/Los_Angeles', openDays: [5] };
  assert.equal(savedVenueStatus(hours, new Date('2026-10-31T06:59:00Z')).state, 'open', 'Friday locally even though UTC is Saturday');
  assert.equal(savedVenueStatus(hours, new Date('2026-10-31T07:00:00Z')).state, 'closed', 'Saturday local midnight');
});

test("selected days are visible in public, saved and club review hours", () => {
  assert.equal(venueOperatingStatus('8:00p - 4:00a', 'Las Vegas', new Date('2026-10-30T22:00:00Z'), [5, 6]).hoursLabel, 'Fri, Sat · 8:00p - 4:00a');
  assert.equal(formatVenueHours('00:00', '00:00', [5, 6]), 'Fri, Sat · 24 hours');
  assert.equal(formatVenueReviewHours('20:00', '04:00', [5, 6]), 'Fri, Sat · 8:00 PM – 4:00 AM');
});

test('different daily hours agree across public and saved cards at overnight, week, and closing boundaries', () => {
 const week=legacyVenueWeek('20:00','02:00',[1,2,3,4]);
 week[5]={mode:'custom',opensAt:'22:00',closesAt:'04:00'};
 week[6]={mode:'custom',opensAt:'21:00',closesAt:'06:00'};
 const cases=[['2026-10-30T01:59:00Z','open'],['2026-10-30T02:00:00Z','closed'],['2026-10-30T21:59:00Z','closed'],['2026-10-30T22:00:00Z','open'],['2026-10-31T03:59:00Z','open'],['2026-10-31T04:00:00Z','closed'],['2026-10-31T20:59:00Z','closed'],['2026-10-31T21:00:00Z','open'],['2026-11-01T05:59:00Z','open'],['2026-11-01T06:00:00Z','closed'],['2026-11-01T22:00:00Z','closed']];
 for(const [time,state] of cases){
  const now=new Date(time), live=venueOperatingStatus('', 'Las Vegas', now, [], week);
  const saved=savedVenueStatus({weeklyHours:week,timezone:'UTC'},now);
  assert.equal(live.state,state,time); assert.equal(saved.state,state,time);
  assert.equal(live.hoursLabel,saved.hoursLabel,time);
 }
 assert.equal(venueOperatingStatus('', 'Las Vegas',new Date('2026-10-31T03:00:00Z'),[],week).hoursLabel,'Fri · 10:00 PM – 4:00 AM');
 assert.equal(venueOperatingStatus('', 'Las Vegas',new Date('2026-11-01T06:00:00Z'),[],week).hoursLabel,'Sun · Closed');
 assert.equal(formatVenueReviewHours(null,null,null,week),'Mon–Thu: 8:00 PM – 2:00 AM; Fri: 10:00 PM – 4:00 AM; Sat: 9:00 PM – 6:00 AM; Sun: Closed');
});

test('24-hour days end at local midnight and weekly schedules respect the venue time zone during DST', () => {
 const week=legacyVenueWeek('00:00','00:00',[5]);
 for(const [time,state] of [['2026-10-31T06:59:00Z','open'],['2026-10-31T07:00:00Z','closed']]) {
  assert.equal(savedVenueStatus({weeklyHours:week,timezone:'America/Los_Angeles'},new Date(time)).state,state);
 }
 week[5]={mode:'closed'};week[6]={mode:'custom',opensAt:'20:00',closesAt:'02:00'};
 for(const [time,state] of [['2026-11-01T08:30:00Z','open'],['2026-11-01T09:30:00Z','open'],['2026-11-01T10:00:00Z','closed']]) {
  assert.equal(savedVenueStatus({weeklyHours:week,timezone:'America/Los_Angeles'},new Date(time)).state,state);
 }
 const closed=legacyVenueWeek('','');
 assert.equal(savedVenueStatus({weeklyHours:closed,timezone:'UTC'}).state,'closed');
});
