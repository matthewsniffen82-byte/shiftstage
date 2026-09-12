import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const instant = Date.parse("2026-09-12T09:00:00.000Z");
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return instant; }
}
function compile(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Date: TestDate, console: { log() {}, warn() {} }, require: name => dependencies[name] || {} });
  return exports;
}
const service = compile("src/lib/dancr/public.ts", {
  "./venue-public-visibility": compile("src/lib/dancr/venue-public-visibility.ts"),
  "./profile-approval": compile("src/lib/dancr/profile-approval.ts"),
  "./shift-presence": compile("src/lib/dancr/shift-presence.ts"),
  "./responsive-image": { responsivePublicImage: () => null },
});
const venue = { id: "venue", name: "Synthetic Venue", slug: "synthetic", is_active: true, has_active_club_deal: true };
const profile = { id: "dancer", slug: "synthetic", stage_name: "Synthetic", city: "Las Vegas",
  status: "approved", verification_status: "approved", is_public: true, disabled_at: null, social_links: [] };
const iso = offset => new Date(instant + offset).toISOString();
const scheduled = (id, offset, overrides = {}) => ({ id, status: "posted", shift_source: "scheduled",
  starts_at: iso(offset), ends_at: iso(offset + 60_000), checked_in_at: null, checked_out_at: null,
  venues: { ...venue }, ...overrides });
const history = () => Array.from({ length: 60 }, (_, i) => scheduled(`past-${i}`, -(i + 1) * 86_400_000));

// A small synthetic response adapter applies the query emitted by the installed
// SDK. It is not a PostgREST server or evidence of hosted query execution.
function split(expression) {
  let level = 0, start = 0; const parts = [];
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === "(") level++;
    if (expression[i] === ")") level--;
    if (expression[i] === "," && level === 0) { parts.push(expression.slice(start, i)); start = i + 1; }
  }
  return [...parts, expression.slice(start)];
}
function matches(row, expression) {
  if (expression.startsWith("and(")) return split(expression.slice(4, -1)).every(part => matches(row, part));
  if (expression.startsWith("or(")) return split(expression.slice(3, -1)).some(part => matches(row, part));
  const [field, ...rest] = expression.split(".");
  let filter = rest.join("."), negate = false;
  if (filter.startsWith("not.")) { negate = true; filter = filter.slice(4); }
  const separator = filter.indexOf("."), op = filter.slice(0, separator), raw = filter.slice(separator + 1);
  const target = raw === "null" ? null : raw === "true" ? true : raw === "false" ? false : raw;
  const value = row[field] ?? null;
  assert.ok(["eq", "is", "gt", "gte"].includes(op), `Unsupported synthetic filter ${op}`);
  const result = op === "eq" || op === "is" ? value === target
    : value !== null && (op === "gt" ? value > target : value >= target);
  return negate ? !result : result;
}
function fixture(shifts, { legacy = false, queryError = null } = {}) {
  const queries = [];
  const client = createClient("https://synthetic.invalid", "sb_publishable_synthetic_query_only", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { async fetch(input, init) {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(url.origin, "https://synthetic.invalid");
      assert.ok(["GET", "HEAD"].includes(init.method));
      if (!url.pathname.endsWith("/dancer_profiles")) {
        return new Response(init.method === "HEAD" ? null : "[]", { headers: { "content-type": "application/json", "content-range": "0-0/0" } });
      }
      const query = url.searchParams; queries.push(Object.fromEntries(query));
      if (queryError) return Response.json(queryError, { status: 400 });
      if (legacy && query.has("is_public")) return Response.json({ code: "42703", message: "column is_public does not exist" }, { status: 400 });
      let rows = structuredClone(shifts);
      for (const [key, value] of query) {
        if (key === "shifts.or") rows = rows.filter(row => split(value.slice(1, -1)).some(part => matches(row, part)));
        else if (key.startsWith("shifts.venues.")) {
          for (const row of rows) if (!row.venues || !matches(row.venues, key.slice(14) + "." + value)) row.venues = null;
        } else if (key.startsWith("shifts.") && !["shifts.limit", "shifts.order"].includes(key)) {
          rows = rows.filter(row => matches(row, key.slice(7) + "." + value));
        }
      }
      if (query.get("select").includes("venues!inner(")) rows = rows.filter(row => row.venues);
      const order = query.get("shifts.order");
      if (order) rows.sort((a, b) => {
        for (const sort of order.split(",")) {
          const [field, direction] = sort.split(".");
          const comparison = String(a[field]).localeCompare(String(b[field]));
          if (comparison) return direction === "desc" ? -comparison : comparison;
        }
        return 0;
      });
      rows = rows.slice(0, Number(query.get("shifts.limit") || rows.length));
      return Response.json([{ ...profile, shifts: rows }]);
    } },
  });
  return { queries, get: () => service.getDancerProfile(client, "synthetic") };
}

for (const legacy of [false, true]) {
  test(`historical rows cannot hide an upcoming date, legacy=${legacy}`, async () => {
    const f = fixture([...history(), scheduled("next", 86_400_000)], { legacy });
    const result = await f.get();
    assert.deepEqual(Array.from(result.upcomingShifts, row => row.id), ["next"]);
    assert.equal(f.queries.length, legacy ? 2 : 1);
    for (const query of f.queries) {
      assert.equal(query["shifts.limit"], "50");
      assert.equal(query["shifts.order"], "starts_at.asc,id.asc");
      assert.doesNotMatch(query.select, /shifts!inner/);
    }
  });

  test(`active NFC remains visible independently of scheduled end, legacy=${legacy}`, async () => {
    const live = scheduled("live", -86_400_000, { shift_source: "nfc", checked_in_at: iso(-60_000),
      location_status: "club_confirmed", location_verification_expires_at: iso(3_600_000) });
    const result = await fixture([...history(), live, scheduled("next", 86_400_000)], { legacy }).get();
    assert.equal(result.shiftId, "live");
    assert.deepEqual(Array.from(result.upcomingShifts, row => row.id), ["live", "next"]);
  });

  test(`unpublished, checked-out and inactive-venue rows cannot consume the window, legacy=${legacy}`, async () => {
    const excluded = [
      { status: "cancelled" }, { checked_out_at: iso(-1) },
      { venues: { ...venue, is_active: false } }, { venues: { ...venue, has_active_club_deal: false } },
      { venues: null }, { shift_source: "nfc", location_status: "club_confirmed", checked_in_at: iso(-60_000), location_verification_expires_at: iso(-1) },
    ].flatMap((overrides, group) => Array.from({ length: 55 }, (_, i) => scheduled(`excluded-${group}-${i}`, 10_000, overrides)));
    const result = await fixture([...excluded, scheduled("visible", 86_400_000)], { legacy }).get();
    assert.deepEqual(Array.from(result.upcomingShifts, row => row.id), ["visible"]);
  });
}

test("a public dancer without visible dates still has a profile", async () => {
  const result = await fixture(history()).get();
  assert.equal(result.id, profile.id);
  assert.equal(result.upcomingShifts.length, 0);
});

test("earliest dates and stable identifiers define the bounded window", async () => {
  const rows = Array.from({ length: 80 }, (_, i) => scheduled(`date-${String(i).padStart(3, "0")}`, Math.floor(i / 2) * 60_000 + 3_600_000)).reverse();
  const result = await fixture(rows).get();
  assert.equal(result.upcomingShifts.length, 50);
  assert.equal(result.upcomingShifts[0].id, "date-000");
  assert.equal(result.upcomingShifts[49].id, "date-049");
});

test("ordinary query failure does not activate a legacy query", async () => {
  const f = fixture([], { queryError: { code: "57014", message: "Synthetic timeout" } });
  await assert.rejects(f.get(), error => error.code === "57014");
  assert.equal(f.queries.length, 1);
});
