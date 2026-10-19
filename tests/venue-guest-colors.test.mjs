import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import * as theme from "../src/lib/dancr/venue-guest-theme.ts";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function compile(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Request, Response, URL, Date, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return exports;
}
const colors = compile("src/lib/dancr/venue-guest-colors.ts", { "server-only": {}, "../api-error-policy": { PublicApiError }, "./venue-guest-theme": theme });

test("color parsing accepts only hex or explicit resets and chooses readable foregrounds", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(colors.parseVenueGuestColors({ internalAccent: " #ABCDEF ", embedAccent: null }))), { internalAccent: "#abcdef", embedAccent: null });
  for (const value of [{}, [], null, { internalAccent: "red", embedAccent: null }, { internalAccent: "#fff;display:none", embedAccent: null }, { internalAccent: null, embedAccent: null, staffAccent: "#ffffff" }]) assert.throws(() => colors.parseVenueGuestColors(value));
  assert.equal(theme.guestAccentText("#ffffff"), "#050507");
  assert.equal(theme.guestAccentText("#000000"), "#ffffff");
  assert.equal(theme.venueGuestTheme(null), undefined);
  assert.equal(theme.venueGuestTheme("url(https://evil.invalid)"), undefined);
});

test("migration persists independent location colors and denies direct anonymous or staff access", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create table public.venues(id uuid primary key); create table public.app_users(id uuid primary key);");
    await db.exec(read("supabase/migrations/20261019034059_venue_guest_colors.sql"));
    await db.exec(`insert into public.venues values ('${id(1)}'), ('${id(2)}'); insert into public.app_users values ('${id(3)}');`);
    await db.exec(`set role service_role; insert into public.venue_guest_colors(venue_id,internal_accent,embed_accent,updated_by) values ('${id(1)}','#c99842','#123456','${id(3)}'), ('${id(2)}',null,null,'${id(3)}');`);
    assert.deepEqual((await db.query("select internal_accent,embed_accent from public.venue_guest_colors order by venue_id")).rows,
      [{ internal_accent: "#c99842", embed_accent: "#123456" }, { internal_accent: null, embed_accent: null }]);
    await assert.rejects(db.exec(`update public.venue_guest_colors set internal_accent='red' where venue_id='${id(1)}'`), /check constraint/);
    await db.exec(`update public.venue_guest_colors set internal_accent=null where venue_id='${id(1)}'; reset role;`);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select * from public.venue_guest_colors"), /permission denied/);
      await assert.rejects(db.exec(`update public.venue_guest_colors set embed_accent='#ffffff'`), /permission denied/);
      await db.exec("reset role");
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.venue_guest_colors'::regclass")).rows[0].relrowsecurity, true);
    await db.exec(`delete from public.venues where id='${id(2)}'`);
    assert.equal((await db.query("select count(*)::int n from public.venue_guest_colors")).rows[0].n, 1);
  } finally { await db.close(); }
});

function fixture({ role = "admin", signedIn = true, missing = false, fail = false } = {}) {
  const records = new Map(), calls = [];
  const admin = { from(table) {
    let key, write;
    const query = { select() { return query; }, eq(column, value) { key = value; return query; },
      upsert(value) { write = value; key = value.venue_id; return query; },
      async single() { return query.maybeSingle(); }, async maybeSingle() {
        calls.push({ table, key, write });
        if (fail) return { data: null, error: new Error("Offline") };
        if (table === "venues") return { data: missing ? null : { id: key }, error: null };
        if (write) records.set(key, { ...write });
        return { data: records.get(key) || null, error: null };
      } };
    return query;
  } };
  const route = compile("app/api/admin/venues/colors/route.ts", {
    "next/server": { NextResponse: Response },
    "@/src/lib/api": { PublicApiError, apiError: error => { const resolved = resolveApiError(error, "Failed."); return Response.json(resolved.body, { status: resolved.status }); } },
    "@/src/lib/dancr/admin": { requireAdmin: async () => { if (role !== "admin") throw new PublicApiError("FORBIDDEN", "Admin required.", 403); } },
    "@/src/lib/dancr/venue-guest-colors": colors,
    "@/src/lib/bounded-json-body": { readBoundedJsonObject },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => {
      if (!signedIn) throw new PublicApiError("AUTH_REQUIRED", "Sign in.", 401);
      return { client: {}, user: { id: id(99) }, session: { accessToken: "refreshed" } };
    } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => admin },
  });
  return { records, calls, get: (venue = id(1)) => route.GET(new Request(`https://example.invalid/api/admin/venues/colors?venueId=${venue}`)),
    save: (value, venue = id(1)) => route.PATCH(new Request("https://example.invalid/api/admin/venues/colors", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ venueId: venue, colors: value, updatedBy: id(88) }),
    })) };
}
test("admin colors survive reload, reset independently and cannot overwrite another location", async () => {
  const f = fixture();
  const initial = await f.get(); assert.match(initial.headers.get("cache-control"), /private, no-store/);
  assert.equal((await initial.json()).colors.configured, false);
  const saved = await f.save({ internalAccent: "#C99842", embedAccent: "#123456" });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).session.accessToken, "refreshed");
  assert.equal((await (await f.get()).json()).colors.internalAccent, "#c99842");
  assert.equal((await (await f.get(id(2))).json()).colors.internalAccent, null);
  assert.equal(f.records.get(id(1)).updated_by, id(99));
  await f.save({ internalAccent: null, embedAccent: "#123456" });
  assert.equal(f.records.get(id(1)).internal_accent, null);
  assert.equal(f.records.get(id(1)).embed_accent, "#123456");
});
test("only a verified admin can read or save; invalid settings and failures never report success", async () => {
  for (const options of [{ role: "venue" }, { role: "dancer" }, { signedIn: false }]) {
    const f = fixture(options);
    assert.ok([401,403].includes((await f.get()).status));
    assert.ok([401,403].includes((await f.save({ internalAccent: null, embedAccent: null })).status));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.save({ internalAccent: "#fff", embedAccent: null })).status, 400);
  assert.equal((await f.save({ internalAccent: null, embedAccent: null }, "arbitrary")).status, 400);
  assert.equal(f.records.size, 0);
  assert.equal((await fixture({ missing: true }).save({ internalAccent: null, embedAccent: null })).status, 404);
  assert.equal((await fixture({ fail: true }).save({ internalAccent: null, embedAccent: null })).status, 500);
});
