import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError } from "../src/lib/api-error-policy.ts";

const source = readFileSync(new URL("../src/lib/dancr/auth.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
function fixture(role, state, suspended, suspendBeforeWrite = false) {
  const account = {id: "synthetic-owner", role, display_name: "Synthetic", email: "owner@example.invalid",
    account_state: state, dmca_suspended_at: suspended ? "2026-09-12T00:00:00Z" : null};
  const metadata = state === "disabled" ? {mydancr_self_disabled_at: "2026-09-11T00:00:00Z", mydancr_venue_was_active: true} : {};
  const venue = {id: "synthetic-venue", is_active: state === "active"};
  const writes = [];
  const client = {from(table) {
    let columns = [], update;
    const nullFilters = [];
    const query = {select(value) {columns = value.split(",").map(part => part.trim()); return query;},
      eq() {return query;}, is(column, value) {nullFilters.push([column, value]); return query;},
      update(value) {update = value; return query;},
      single: async () => result(), maybeSingle: async () => result(),
      then(resolve, reject) {return Promise.resolve(result()).then(resolve, reject);}};
    function result() {
      const row = table === "app_users" ? account : table === "venues" && role === "venue" ? venue
        : table === "dancer_profiles" && role === "dancer" ? {id: "synthetic-dancer"} : null;
      if (update) {
        if (table === "app_users" && update.account_state === "active" && suspendBeforeWrite) {
          account.account_state = "disabled";
          account.dmca_suspended_at = "2026-09-12T00:01:00Z";
        }
        if (row && nullFilters.some(([column, value]) => row[column] !== value)) {
          return {data: null, error: new Error("Synthetic write ownership changed")};
        }
        writes.push({table, update}); if (row) Object.assign(row, update);
      }
      // Honor the real projection: a guard cannot use a field it did not read.
      return {data: row ? Object.fromEntries(columns.map(column => [column, row[column]])) : null, error: null};
    }
    return query;
  }, auth: {admin: {
    getUserById: async () => ({data: {user: {app_metadata: {...metadata}}}, error: null}),
    updateUserById: async (_id, input) => {writes.push({table: "auth", update: input}); return {error: null};},
  }}};
  const exports = {};
  vm.runInNewContext(code, {exports, Date, Error, require(name) {
    if (name === "server-only") return {};
    if (name === "../api-error-policy") return {PublicApiError};
    if (name === "./profile-publication") return {transitionDancerPublication: async () => {writes.push({table: "publication"});}};
    throw new Error("Unexpected dependency " + name);
  }});
  return {account, writes, run: target => exports.setAccountState(client, account.id, target, client)};
}

for (const role of ["customer", "dancer", "venue", "admin"]) {
  for (const state of ["active", "disabled"]) {
    test(`${role} with an active copyright restriction cannot self-reactivate from ${state}`, async () => {
      const f = fixture(role, state, true);
      await assert.rejects(f.run("active"), error => error instanceof PublicApiError && error.status === 403);
      assert.equal(f.account.account_state, state);
      assert.equal(f.writes.length, 0);
    });
    test(`${role} without an active copyright restriction keeps authorized ${state} reactivation`, async () => {
      const f = fixture(role, state, false);
      const result = await f.run("active");
      assert.equal(result.accountState, "active");
      assert.equal(f.account.account_state, "active");
      assert.equal("dmca_suspended_at" in result, false);
    });
    test(`${role} restriction applied after reading ${state} prevents the account write`, async () => {
      const f = fixture(role, state, false, true);
      await assert.rejects(f.run("active"), /Synthetic write ownership changed/);
      assert.equal(f.account.account_state, "disabled");
      assert.equal(f.account.dmca_suspended_at, "2026-09-12T00:01:00Z");
      assert.equal(f.writes.length, 0);
    });
  }
  test(`${role} retains the existing own-account deletion path during a copyright restriction`, async () => {
    const f = fixture(role, "disabled", true);
    const result = await f.run("deleted");
    assert.equal(result.accountState, "deleted");
    assert.equal(f.account.email, null);
    assert.equal(f.account.display_name, null);
  });
}
