import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { venueOperatingStatus as savedVenueStatus } from "../src/lib/dancr/venue-operating-status.ts";

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
const { formatVenueReviewHours } = loadFunctions("app/dashboard/DashboardShared.tsx", ["formatVenueReviewHours"]);
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
