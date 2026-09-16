import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { readBoundedJsonObject } from "../src/lib/bounded-json-body.ts";
import { validateProfilePhotoDeletionInput } from "../src/lib/dancr/profile-photo-input.ts";
import { requestRoleFixture } from "./helpers/request-role-fixture.mjs";

const source = readFileSync(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const auth = requestRoleFixture(options);
  const calls = [], writes = [];
  const original = {
    id: "own-dancer", user_id: auth.user.id, stage_name: "Placeholder", city: "",
    identity_saved_at: null, status: "approved", is_public: true,
    approved_at: "2026-09-01T00:00:00Z", disabled_at: null,
    verification_status: "approved", photo_review_status: "approved",
    dancer_photos: [], social_links: [],
  };
  const profiles = [
    ...(options.missingProfile ? [] : [copy(original)]),
    { ...copy(original), id: "other-dancer", user_id: "other-owner", stage_name: "Other dancer" },
  ];
  const before = copy(profiles);
  const server = { from(table) {
    assert.ok(["dancer_profiles", "dancer_photos", "image_moderation_records"].includes(table));
    const call = { table, filters: [] };
    calls.push(call);
    const query = {
      select(columns) { call.columns = columns; return query; },
      eq(field, value) { call.filters.push([field, value]); return query; },
      neq() { return query; }, in() { return query; },
      order() { return query; }, limit() { return query; },
      update(values) { call.update = copy(values); return query; },
      async maybeSingle() { return execute(true); },
      then(resolve, reject) { return Promise.resolve().then(() => execute(false)).then(resolve, reject); },
    };
    function execute(single) {
      if (table === "dancer_profiles") {
        if (options.profileError) return { data: null, error: options.profileError };
        if (options.legacyVisibility && call.columns.includes("is_public")) {
          return { data: null, error: { code: "42703", message: "column is_public does not exist" } };
        }
        const matched = profiles.filter(row => call.filters.every(([field, value]) => row[field] === value));
        if (call.update) {
          writes.push(copy(call));
          matched.forEach(row => Object.assign(row, call.update));
        }
        return { data: single ? copy(matched[0] || null) : copy(matched), error: null };
      }
      return { data: single ? null : [], error: null };
    }
    return query;
  } };
  const dependencies = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/src/lib/api": {
      PublicApiError,
      apiError(error, fallback) {
        const result = resolveApiError(error, fallback);
        return Response.json(result.body, { status: result.status });
      },
    },
    "@/src/lib/supabase/request": { async createRequestSupabaseContext(request, access) {
      assert.deepEqual(copy(access), { role: "dancer" });
      const context = await auth.createContext(request, access);
      calls.push({ authorized: context.user.id });
      // Private owner/identity columns are unavailable to authenticated browser roles.
      return { ...context, client: { from(table) {
        calls.push({ restrictedRead: table });
        const query = {
          select() { return query; }, eq() { return query; },
          async maybeSingle() { return { data: null, error: { code: "42501", message: "permission denied for table dancer_profiles" } }; },
        };
        return query;
      } } };
    } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient() {
      assert.deepEqual(calls[0], { authorized: auth.user.id });
      calls.push({ server: true });
      return server;
    } },
    "@/src/lib/bounded-json-body": { readBoundedJsonObject },
    "@/src/lib/dancr/profile-photo-input": { validateProfilePhotoDeletionInput },
    "@/src/lib/dancr/media-limits": { MAX_DANCER_PROFILE_PHOTOS: 50 },
    "@/src/lib/dancr/image-moderation-status": { ACTIVE_IMAGE_MODERATION_STATUSES: ["pending_review"] },
    "@/src/lib/dancr/photo-slot": { PROFILE_AVATAR_CONTEXT: "avatar" },
    "@/src/lib/dancr/responsive-image": { responsivePublicImage: () => null },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
  };
  const handlers = {};
  vm.runInNewContext(code, {
    exports: handlers, Error, URL, Buffer, console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      return new Proxy({}, { get(_target, key) {
        if (key === "__esModule") return false;
        return () => assert.fail(`Unexpected dependency: ${name}.${String(key)}`);
      } });
    },
  });
  return {
    auth, calls, writes, profiles, before, original,
    async save(body = { stageName: "KC" }, authenticated = true) {
      return handlers.PATCH(new Request("https://example.test/api/dancer/profile?userId=other-owner&dancerId=other-dancer", {
        method: "PATCH",
        headers: { "content-type": "application/json", ...(authenticated ? { authorization: "Bearer synthetic-token" } : {}) },
        body: JSON.stringify(body),
      }));
    },
  };
}

for (const legacyVisibility of [false, true]) {
  test(`stage-name PATCH saves KC with private owner columns (legacy visibility: ${legacyVisibility})`, async () => {
    const f = fixture({ legacyVisibility });
    const response = await f.save({ stageName: "  KC  ", userId: "other-owner", dancerId: "other-dancer" });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.ok, true);
    assert.equal(body.profile.id, "own-dancer");
    assert.equal(body.profile.stage_name, "KC");
    assert.ok(Number.isFinite(Date.parse(body.profile.identity_saved_at)));
    assert.equal(body.profile.city, "");
    assert.equal(f.writes.length, 1);
    assert.deepEqual(Object.keys(f.writes[0].update).sort(), ["identity_saved_at", "stage_name"]);
    assert.deepEqual(f.writes[0].filters, [["id", "own-dancer"], ["user_id", f.auth.user.id]]);
    assert.deepEqual(f.profiles[1], f.before[1]);
    for (const key of ["status", "is_public", "approved_at", "disabled_at", "verification_status", "photo_review_status", "dancer_photos", "social_links"]) {
      assert.deepEqual(f.profiles[0][key], f.original[key], key);
    }
    assert.ok(f.calls.filter(call => call.table === "dancer_profiles").every(call => call.filters.some(([field, value]) => field === "user_id" && value === f.auth.user.id)));
    assert.ok(!f.calls.some(call => call.restrictedRead));
  });
}

for (const options of [
  { role: "customer" }, { role: "venue" }, { role: "admin" },
  { state: "suspended" }, { state: "deleted" }, { missing: true },
  { accountError: { code: "08006" } }, { authError: { status: 401 } },
]) {
  test(`profile PATCH rejects unauthorized access before creating a server client: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    const response = await f.save();
    assert.ok([401, 403, 503].includes(response.status));
    assert.equal((await response.json()).ok, false);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.profiles, f.before);
  });
}

test("anonymous profile PATCH cannot create a server client", async () => {
  const f = fixture();
  assert.equal((await f.save({ stageName: "KC" }, false)).status, 401);
  assert.deepEqual(f.calls, []);
});

for (const [options, status] of [[{ missingProfile: true }, 404], [{ profileError: { code: "08006", message: "private database detail" } }, 500]]) {
  test(`missing or unavailable owner profile stops all writes: ${JSON.stringify(options)}`, async () => {
    const f = fixture(options);
    const response = await f.save();
    assert.equal(response.status, status);
    assert.doesNotMatch(JSON.stringify(await response.json()), /private database detail|08006/);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.profiles, f.before);
    assert.equal(f.calls.filter(call => call.table).length, 1);
  });
}

test("stage-name validation still rejects a one-character name without writing", async () => {
  const f = fixture();
  const response = await f.save({ stageName: "K" });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /at least 2 characters/);
  assert.deepEqual(f.writes, []);
});
