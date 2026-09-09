import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const clockSource = source.slice(source.indexOf("    const cityWallClockFormatters ="), source.indexOf("    function wallDateValue("));
function fixture() {
  let constructions = 0;
  const context = vm.createContext({ Date, Map, Number,
    selectedCity: () => "America/Los_Angeles", cityTimeZone: city => city,
    Intl: { DateTimeFormat: new Proxy(Intl.DateTimeFormat, {
      construct(target, args) { constructions++; return Reflect.construct(target, args); },
    }) },
  });
  vm.runInContext(clockSource, context);
  return { context, count: () => constructions };
}

test("feed grouping reuses formatter configuration while computing every current date", () => {
  const { context, count } = fixture();
  assert.equal(context.cityWallClock(new Date("2026-09-09T06:59:59Z")).toISOString(), "2026-09-08T23:59:59.000Z");
  assert.equal(context.cityWallClock(new Date("2026-09-09T07:00:01Z")).toISOString(), "2026-09-09T00:00:01.000Z");
  for (let i = 0; i < 200; i++) context.cityWallClock(new Date());
  assert.equal(count(), 1);
});

test("cached feed clocks preserve spring/fall DST transitions and timezone separation", () => {
  const { context, count } = fixture();
  for (const [instant, zone, expected] of [
    ["2026-03-08T09:59:59Z", "America/Los_Angeles", "2026-03-08T01:59:59.000Z"],
    ["2026-03-08T10:00:00Z", "America/Los_Angeles", "2026-03-08T03:00:00.000Z"],
    ["2026-11-01T08:59:59Z", "America/Los_Angeles", "2026-11-01T01:59:59.000Z"],
    ["2026-11-01T09:00:00Z", "America/Los_Angeles", "2026-11-01T01:00:00.000Z"],
    ["2026-09-09T12:00:00Z", "America/New_York", "2026-09-09T08:00:00.000Z"],
    ["2026-09-09T12:00:00Z", "Asia/Kolkata", "2026-09-09T17:30:00.000Z"],
  ]) assert.equal(context.cityWallClock(new Date(instant), zone).toISOString(), expected);
  assert.equal(count(), 3);
});

test("formatter cache stays bounded and recreates evicted zones correctly", () => {
  const { context } = fixture();
  for (let i = 0; i < 17; i++) context.cityWallClock(new Date("2026-09-09T12:00:00Z"), `Etc/GMT${i < 12 ? "+" : "-"}${i < 12 ? i : i - 11}`);
  assert.equal(vm.runInContext("cityWallClockFormatters.size", context), 16);
  assert.equal(context.cityWallClock(new Date("2026-09-09T12:00:00Z"), "Etc/GMT+0").toISOString(), "2026-09-09T12:00:00.000Z");
  assert.equal(vm.runInContext("cityWallClockFormatters.size", context), 16);
});
