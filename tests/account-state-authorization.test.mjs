import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError } from "../src/lib/api-error-policy.ts";

const source = readFileSync(new URL("../src/lib/dancr/auth.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function fixture({ role = "customer", state = "active", metadata = {}, forgedMetadata = {}, venueActive, failAccountUpdate = false, failVenueRestore = false } = {}) {
  const row = { id: "owner", role, display_name: "Synthetic", email: "owner@example.test", account_state: state };
  const appMetadata = { provider: "email", trusted_extra: "preserve", ...metadata };
  const writes = [];
  const venue = venueActive === undefined ? null : { id: "owned-venue", is_active: venueActive };
  const client = {
    from(table) {
      let update = null;
      const filters = [];
      const query = {
        select() { return query; }, eq(...args) { filters.push(args); return query; },
        is(...args) { filters.push(args); return query; },
        update(value) { update = value; return query; },
        async single() { return result(); }, async maybeSingle() { return result(); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      function result() {
        const value = table === "app_users" ? row : table === "venues" ? venue : table === "dancer_profiles" && role === "dancer" ? { id: "owned-profile" } : null;
        if (update) {
          writes.push({ table, update: structuredClone(update), filters });
          if (table === "app_users" && failAccountUpdate) return { data: null, error: new Error("Synthetic write failure") };
          if (table === "venues" && update.is_active === true && failVenueRestore) return { data: null, error: new Error("Synthetic venue restore failure") };
          if (value) Object.assign(value, update);
        }
        return { data: value && structuredClone(value), error: null };
      }
      return query;
    },
    auth: { admin: {
      async getUserById(id) { assert.equal(id, "owner"); return { data: { user: { id, app_metadata: structuredClone(appMetadata), user_metadata: forgedMetadata } }, error: null }; },
      async updateUserById(id, input) {
        assert.equal(id, "owner");
        writes.push({ table: "auth_metadata", update: structuredClone(input.app_metadata) });
        // Supabase merges supplied keys; explicit null deletes a key.
        for (const [key, value] of Object.entries(input.app_metadata)) {
          if (value === null) delete appMetadata[key]; else appMetadata[key] = value;
        }
        return { error: null };
      },
    } },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, Date, Error, require: name => {
    if (name === "../api-error-policy") return { PublicApiError };
    if (name === "./profile-publication") return { transitionDancerPublication: async () => {} };
    if (name === "server-only") return {};
    throw new Error(name);
  } });
  return { row, appMetadata, writes, venue, run: state => exports.setAccountState(client, "owner", state, client) };
}

for (const role of ["customer", "dancer", "venue", "admin"]) {
  for (const target of ["active", "disabled"]) {
    test(`administratively disabled ${role} cannot use self-service ${target}`, async () => {
      const f = fixture({ role, state: "disabled", venueActive: role === "venue" ? false : undefined });
      await assert.rejects(f.run(target), error => error.status === 403);
      assert.equal(f.row.account_state, "disabled");
      assert.equal(f.writes.length, 0);
    });
    test(`deleted ${role} cannot regain access through ${target}`, async () => {
      const f = fixture({ role, state: "deleted", metadata: { mydancr_self_disabled_at: "old-pause" } });
      await assert.rejects(f.run(target), error => error.status === 403);
      assert.equal(f.row.account_state, "deleted");
      assert.equal(f.writes.length, 0);
    });
  }
  test(`active ${role} retains self-disable and reactivation`, async () => {
    const f = fixture({ role, venueActive: role === "venue" ? true : undefined });
    await f.run("disabled");
    assert.equal(f.row.account_state, "disabled");
    assert.ok(f.appMetadata.mydancr_self_disabled_at);
    if (f.venue) assert.equal(f.venue.is_active, false);
    await f.run("active");
    assert.equal(f.row.account_state, "active");
    assert.equal(f.appMetadata.mydancr_self_disabled_at, undefined);
    assert.equal(f.appMetadata.mydancr_venue_was_active, undefined);
    assert.equal(f.appMetadata.trusted_extra, "preserve");
    if (f.venue) assert.equal(f.venue.is_active, true);
    // A later administrative suspension must not inherit the former self-pause permission.
    f.row.account_state = "disabled";
    await assert.rejects(f.run("active"), error => error.status === 403);
  });
}
test("a suspended user cannot manufacture a self-disable marker then reactivate", async () => {
  const f = fixture({ state: "disabled", forgedMetadata: { role: "admin", mydancr_self_disabled_at: "forged" } });
  await assert.rejects(f.run("disabled"), error => error.status === 403);
  await assert.rejects(f.run("active"), error => error.status === 403);
  assert.equal(f.appMetadata.mydancr_self_disabled_at, undefined);
  assert.equal(f.writes.length, 0);
});
test("failed disable rolls back newly added metadata using provider merge semantics", async () => {
  const f = fixture({ failAccountUpdate: true });
  await assert.rejects(f.run("disabled"), /Synthetic write failure/);
  assert.equal(f.row.account_state, "active");
  assert.equal(f.appMetadata.mydancr_self_disabled_at, undefined);
  assert.equal(f.appMetadata.trusted_extra, "preserve");
});
test("a private venue stays private through an authorized pause and resume", async () => {
  const f = fixture({ role: "venue", venueActive: false });
  await f.run("disabled"); await f.run("active");
  assert.equal(f.venue.is_active, false);
});
test("an old active-account marker cannot restore an obsolete public venue state", async () => {
  const f = fixture({ role: "venue", venueActive: false, metadata: { mydancr_self_disabled_at: "old-pause", mydancr_venue_was_active: true } });
  await f.run("disabled");
  assert.notEqual(f.appMetadata.mydancr_self_disabled_at, "old-pause");
  await f.run("active");
  assert.equal(f.venue.is_active, false);
});
test("failed venue reactivation preserves the legitimate self-pause permission for retry", async () => {
  const f = fixture({ role: "venue", state: "disabled", venueActive: false, failVenueRestore: true,
    metadata: { mydancr_self_disabled_at: "original-pause", mydancr_venue_was_active: true } });
  await assert.rejects(f.run("active"), /Synthetic venue restore failure/);
  assert.equal(f.row.account_state, "disabled");
  assert.equal(f.venue.is_active, false);
  assert.equal(f.appMetadata.mydancr_self_disabled_at, "original-pause");
  assert.equal(f.appMetadata.mydancr_venue_was_active, true);
  assert.equal(f.appMetadata.trusted_extra, "preserve");
});
for (const state of ["active", "disabled", "deleted"]) test(`own account deletion remains available from ${state}`, async () => {
  const f = fixture({ state, role: "venue", venueActive: state === "active" });
  const result = await f.run("deleted");
  assert.equal(result.accountState, "deleted");
  assert.equal(f.row.email, null);
  assert.equal(f.row.display_name, null);
  assert.equal(f.venue.is_active, false);
});
