import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import { PGlite } from "@electric-sql/pglite";

const instant = Date.parse("2026-09-12T09:00:00.000Z");
let clock = instant;
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : [clock])); }
  static now() { return clock; }
}
function compile(path, dependencies = {}) {
  const exports = {};
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Date: TestDate, console: { log() {}, warn() {} }, require: name => dependencies[name] || {} });
  return exports;
}
const dependencies = Object.fromEntries(["venue-public-visibility", "profile-approval", "shift-presence", "markets"].map(name => [
  `./${name}`, compile(`src/lib/dancr/${name}.ts`),
]));
const service = compile("src/lib/dancr/public.ts", { ...dependencies, "./responsive-image": {
  responsivePublicImage: (_client, _bucket, path) => path ? { imageUrl: `https://synthetic.invalid/${path}` } : null,
} });
const iso = offset => new Date(instant + offset).toISOString();
const venue = { id: "venue", name: "Synthetic Venue", slug: "synthetic", is_active: true, has_active_club_deal: true };
const profile = { id: "dancer", slug: "synthetic", stage_name: "Synthetic", city: "Las Vegas", status: "approved",
  verification_status: "approved", photo_review_status: "approved", approved_at: iso(-86_400_000), disabled_at: null,
  is_public: true, social_links: [], dancer_photos: [] };
const scheduled = (id, offset = 3_600_000, overrides = {}) => ({ id, status: "posted", shift_source: "scheduled",
  starts_at: iso(offset), ends_at: iso(offset + 3_600_000), timezone: "UTC", checked_in_at: null,
  checked_out_at: null, venues: { ...venue }, ...overrides });
const live = (id, overrides = {}) => scheduled(id, -60_000, { shift_source: "nfc", checked_in_at: iso(-60_000),
  location_status: "club_confirmed", location_verification_expires_at: iso(3_600_000), ...overrides });
const history = () => Array.from({ length: 1000 }, (_, i) => scheduled(`past-${i}`, -(i + 1) * 86_400_000));

// Generic small evaluator for the emitted SDK query, not a PostgREST server.
function matches(row, key, filter) {
  let negate = false;
  if (filter.startsWith("not.")) { negate = true; filter = filter.slice(4); }
  const split = filter.indexOf("."), operator = filter.slice(0, split), text = filter.slice(split + 1);
  const expected = text === "null" ? null : text === "true" ? true : text === "false" ? false : text;
  const actual = key.split(".").reduce((value, part) => value?.[part], row) ?? null;
  assert.ok(["eq", "is", "gt", "gte", "lt", "ilike"].includes(operator), `Unsupported synthetic operator ${operator}`);
  const result = operator === "eq" || operator === "is" ? actual === expected
    : operator === "ilike" ? String(actual).toLowerCase() === String(expected).toLowerCase()
    : actual !== null && (operator === "gt" ? actual > expected : operator === "lt" ? actual < expected : actual >= expected);
  return negate ? !result : result;
}
function selectRows(input, query, prefix = "") {
  let rows = structuredClone(input);
  for (const [key, value] of query) {
    if (!key.startsWith(prefix)) continue;
    const field = key.slice(prefix.length);
    if (["select", "limit", "order"].includes(field) || (!prefix && field.includes("."))) continue;
    rows = rows.filter(row => matches(row, field, value));
  }
  const order = query.get(prefix + "order");
  if (order) rows.sort((left, right) => {
    for (const item of order.split(",")) {
      const [field, direction, nulls] = item.split(".");
      if ((left[field] === null) !== (right[field] === null)) return (left[field] === null ? -1 : 1) * (nulls === "nullsfirst" ? 1 : -1);
      const result = String(left[field]).localeCompare(String(right[field]));
      if (result) return direction === "desc" ? -result : result;
    }
    return 0;
  });
  return rows.slice(0, Number(query.get(prefix + "limit") ?? Infinity));
}
function fixture(shifts, { profiles = [profile], queryError = null, elapsedDuringFetch = 0 } = {}) {
  clock = instant;
  const queries = [], queryParameters = [], transfers = [], requests = [];
  const client = createClient("https://synthetic.invalid", "sb_publishable_synthetic_query_only", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { async fetch(input, init) {
      const url = new URL(typeof input === "string" ? input : input.url);
      assert.equal(url.origin, "https://synthetic.invalid"); requests.push(url.pathname);
      if (url.pathname.endsWith("/rpc/get_public_dancer_metric_counts")) {
        assert.equal(init.method, "POST"); return Response.json([]);
      }
      assert.equal(init.method, "GET"); assert.ok(url.pathname.endsWith("/dancer_profiles"));
      const query = url.searchParams; queries.push(Object.fromEntries(query)); queryParameters.push(query);
      if (queryError) return Response.json(queryError, { status: 400 });
      const aliases = Array.from(query.get("select").matchAll(/(?:(\w+):)?shifts(?:!inner)?\(/g), match => match[1] || "shifts");
      assert.ok(aliases.length > 0);
      const rows = selectRows(profiles, query).map(row => {
        const result = { ...row };
        for (const alias of aliases) result[alias] = selectRows(shifts, query, alias + ".");
        result.dancer_photos = selectRows(row.dancer_photos || [], query, "dancer_photos.");
        return result;
      });
      transfers.push({ rowCount: rows.length, children: rows.map(row => aliases.flatMap(alias => row[alias]).length),
        byteLength: Buffer.byteLength(JSON.stringify(rows)), aliases });
      clock += elapsedDuringFetch;
      return Response.json(rows);
    } },
  });
  return { queries, queryParameters, transfers, requests,
    get: city => service.getLiveDancerDiscovery(client, city || "Las Vegas"),
    tonight: () => service.getTonightShifts(client, "Las Vegas"),
  };
}

const scenarios = [
  { name: "long history retains the next date", rows: [scheduled("next")], chosen: "next", tonight: false },
  { name: "active NFC wins over many eligible scheduled dates", rows: [...Array.from({ length: 70 }, (_, i) => scheduled(`scheduled-${i}`, -120_000 + i, { ends_at: iso(86_400_000) })), live("live")], chosen: "live", tonight: true },
  { name: "active scheduled presence keeps priority", rows: [scheduled("next"), live("active-scheduled", { shift_source: "scheduled" })], chosen: "active-scheduled", tonight: true },
  { name: "checked-out presence is excluded before selection", rows: [live("out", { checked_out_at: iso(-1) }), scheduled("next")], chosen: "next", tonight: false },
  { name: "expired presence is excluded before selection", rows: [live("expired", { location_verification_expires_at: iso(0) }), scheduled("next")], chosen: "next", tonight: false },
  { name: "cancelled presence is excluded before selection", rows: [live("cancelled", { status: "cancelled" }), scheduled("next")], chosen: "next", tonight: false },
  { name: "an inactive venue cannot consume the selected window", rows: [live("hidden", { venues: { ...venue, is_active: false } }), scheduled("next")], chosen: "next", tonight: false },
  { name: "a venue without a live deal cannot consume the selected window", rows: [live("no-deal", { venues: { ...venue, has_active_club_deal: false } }), scheduled("next")], chosen: "next", tonight: false },
];
for (const scenario of scenarios) test(scenario.name, async () => {
  const f = fixture([...history(), ...scenario.rows]);
  const result = await f.get();
  assert.equal(result.dancers[0].shiftId, scenario.chosen);
  assert.equal(result.tonightDancers.length, scenario.tonight ? 1 : 0);
  assert.equal(f.queries.length, 1);
  assert.ok(f.transfers[0].children.every(count => count <= 100), "Transfer bounded live and scheduled candidate windows");
  assert.ok(f.transfers[0].byteLength < 80000, "Historical dates must not inflate this synthetic one-card response");
});

test("a profile without dates remains in the directory", async () => {
  const f = fixture([]); const result = await f.get();
  assert.equal(result.dancers.length, 1); assert.equal(result.dancers[0].shiftId, null);
  assert.equal(result.tonightDancers.length, 0);
  assert.doesNotMatch(f.queries[0].select, /(?:live_shifts|scheduled_shifts):shifts!inner/);
});
test("equal shift starts have a deterministic ID tie-break", async () => {
  const f = fixture([live("z"), live("a"), scheduled("next")]);
  assert.equal((await f.get()).dancers[0].shiftId, "a");
});
test("equal stage names have a deterministic parent ID tie-break", async () => {
  const f = fixture([], { profiles: [{ ...profile, id: "z" }, { ...profile, id: "a" }] });
  assert.deepEqual(Array.from((await f.get()).dancers, card => card.id), ["a", "z"]);
});
for (const [city, limit, cityFilter] of [[" Las Vegas ", "200", "ilike.Las Vegas"], ["All cities", "800", undefined]]) {
  test(`city scope and parent bounds are retained: ${city}`, async () => {
    const f = fixture([]); await f.get(city);
    assert.equal(f.queries[0].limit, limit); assert.equal(f.queries[0].city, cityFilter);
  });
}
test("query uncertainty fails without a legacy request or metrics call", async () => {
  const f = fixture([], { queryError: { code: "42703", message: "Synthetic unavailable visibility column" } });
  await assert.rejects(f.get(), error => error.code === "42703");
  assert.equal(f.requests.length, 1);
});
test("presence that expires in transit is not displayed as active", async () => {
  const f = fixture([live("expiring", { location_verification_expires_at: iso(100) }), scheduled("next")], { elapsedDuringFetch: 101 });
  const result = await f.get();
  assert.equal(result.dancers[0].shiftId, "next"); assert.equal(result.tonightDancers.length, 0);
});
test("both optional aliases have their own bounds and one captured clock", async () => {
  const f = fixture([]); await f.get(); const query = f.queries[0];
  assert.equal(query["live_shifts.limit"], "50"); assert.equal(query["scheduled_shifts.limit"], "50");
  assert.equal(query["live_shifts.order"], "starts_at.asc,id.asc");
  assert.equal(query["scheduled_shifts.order"], "starts_at.asc,id.asc");
  assert.deepEqual(f.queryParameters[0].getAll("live_shifts.location_verification_expires_at"), ["gt." + iso(0), "lt.infinity"]);
  assert.deepEqual(f.queryParameters[0].getAll("scheduled_shifts.ends_at"), ["gte." + iso(0), "lt.infinity"]);
  assert.match(query.select, /live_shifts:shifts\(/); assert.match(query.select, /scheduled_shifts:shifts\(/);
  assert.match(query.select, /venues!inner\(/);
});

test("another live candidate survives an earlier presence expiring in transit", async () => {
  const f = fixture([live("expiring", { starts_at: iso(-120000), location_verification_expires_at: iso(100) }), live("valid"), scheduled("next")], { elapsedDuringFetch: 101 });
  const result = await f.get();
  assert.equal(result.dancers[0].shiftId, "valid");
  assert.equal(result.tonightDancers[0].shiftId, "valid");
});

test("another scheduled candidate survives an earlier end passing in transit", async () => {
  const f = fixture([scheduled("ending", -120000, { ends_at: iso(100) }), scheduled("next")], { elapsedDuringFetch: 101 });
  assert.equal((await f.get()).dancers[0].shiftId, "next");
});

test("non-finite PostgreSQL timestamps cannot fill a window ahead of eligible dates", async () => {
  const nonfinite = Array.from({ length: 60 }, (_, i) => live(`invalid-${i}`, {
    starts_at: iso(-120000 - i), ends_at: "infinity", location_verification_expires_at: "infinity", shift_source: "scheduled",
  }));
  const f = fixture([...nonfinite, live("valid"), scheduled("next")]);
  assert.equal((await f.get()).dancers[0].shiftId, "valid");
  assert.equal(f.transfers[0].children[0], 2);
});

test("exhausted in-transit candidates are hidden without unbounded followup queries", async () => {
  const f = fixture(Array.from({ length: 60 }, (_, i) => live(`expiring-${i}`, {
    starts_at: iso(-120000 + i), location_verification_expires_at: iso(i < 50 ? 100 : 10000),
  })), { elapsedDuringFetch: 101 });
  const result = await f.get();
  assert.equal(result.dancers[0].shiftId, null);
  assert.equal(result.tonightDancers.length, 0);
  assert.equal(f.transfers[0].children[0], 50);
  assert.equal(f.queries.length, 1);
});

test("gallery eligibility and primary/pin ordering precede the bounded photo window", async () => {
  const photo = (id, extra = {}) => ({ id, storage_path: id, review_status: "approved", is_primary: false, is_pinned: false, sort_order: 1, like_count: 0, ...extra });
  const gallery = [
    ...Array.from({ length: 70 }, (_, i) => photo(`hidden-${i}`, { review_status: "rejected", is_primary: true, is_pinned: true })),
    ...Array.from({ length: 70 }, (_, i) => photo(`ordinary-${String(i).padStart(2, "0")}`)),
    photo("primary", { is_primary: true }), photo("pinned", { is_pinned: true }),
  ];
  const f = fixture([], { profiles: [{ ...profile, dancer_photos: gallery }] });
  const result = await f.get();
  const ids = Array.from(result.dancers[0].galleryPhotoIds);
  assert.equal(ids.length, 50);
  assert.deepEqual(ids.slice(0, 3), ["pinned", "primary", "ordinary-00"]);
  assert.equal(ids.some(id => id.startsWith("hidden")), false);
  assert.equal(f.queries[0]["dancer_photos.limit"], "50");
});

test("the dedicated tonight query filters hidden venues before its shift window", async () => {
  const hidden = Array.from({ length: 70 }, (_, i) => live(`hidden-${i}`, { starts_at: iso(-120000 - i), venues: { ...venue, is_active: false } }));
  const f = fixture([...hidden, live("valid")]);
  assert.equal((await f.tonight())[0].shiftId, "valid");
  assert.equal(f.queries[0]["shifts.limit"], "50");
  assert.match(f.queries[0].select, /venues!inner\(/);
});

test("native PostgreSQL excludes infinite expiry/end before taking a directory window", async () => {
  // A timestamp projection establishes PostgreSQL ordering, not hosted RLS or
  // complete business-schema behavior. The query values come from the real SDK.
  const f = fixture([]); await f.get();
  const db = new PGlite();
  try {
    await db.exec(`create table synthetic_dates(id integer, starts_at timestamptz not null, ends_at timestamptz not null, location_verification_expires_at timestamptz,
      check (ends_at > starts_at));
      insert into synthetic_dates select i, '2026-09-12 08:00:00Z'::timestamptz + i * interval '1 second', 'infinity', 'infinity' from generate_series(1,60) i;
      insert into synthetic_dates values (100, '2026-09-12 09:30:00Z', '2026-09-12 12:00:00Z', '2026-09-12 12:00:00Z');`);
    for (const [alias, column] of [["live_shifts", "location_verification_expires_at"], ["scheduled_shifts", "ends_at"]]) {
      const filters = f.queryParameters[0].getAll(`${alias}.${column}`);
      const parameters = [], clauses = [];
      for (const filter of filters) {
        const dot = filter.indexOf("."), operator = filter.slice(0, dot);
        assert.ok(["gt", "gte", "lt"].includes(operator));
        parameters.push(filter.slice(dot + 1));
        clauses.push(`${column} ${{ gt: ">", gte: ">=", lt: "<" }[operator]} $${parameters.length}::timestamptz`);
      }
      const result = await db.query(`select id from synthetic_dates where ${clauses.join(" and ")} order by starts_at,id limit 50`, parameters);
      assert.deepEqual(result.rows, [{ id: 100 }]);
      const withoutFiniteCheck = await db.query(`select id from synthetic_dates where ${column} > $1::timestamptz order by starts_at,id limit 50`, [iso(0)]);
      assert.equal(withoutFiniteCheck.rows.some(row => row.id === 100), false);
    }
  } finally { await db.close(); }
});
