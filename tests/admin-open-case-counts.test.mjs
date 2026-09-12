import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { adminWorkspaceCounts } from "../app/admin/admin-workspace-counts.ts";

const source = readFileSync(new URL("../src/lib/dancr/admin-operations.ts", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText, {
  exports, console: { error() {}, warn() {} },
  require(name) {
    if (name === "../security/safe-error-metadata") return { safeErrorMetadata: () => ({}) };
    if (name === "./shift-presence") return { isActiveNfcPresence: () => false };
    throw new Error("Unexpected fixture dependency: " + name);
  },
});

// These eight statuses are the captured database enum and current admin queue.
const openStatuses = ["submitted", "needs_information", "disabled", "countered", "court_hold"];
const terminalStatuses = ["rejected", "restored", "closed"];
function database(statuses, options = {}) {
  const queries = [];
  return { queries, from(table) {
    const query = { table, filters: [], select: null }; queries.push(query);
    const chain = new Proxy({}, { get(_target, method) {
      if (method === "then") return (resolve, reject) => Promise.resolve().then(() => {
        if (table !== "dmca_cases") return { data: [], count: 0, error: null };
        assert.deepEqual(query.select, ["id", { count: "exact", head: true }]);
        let rows = statuses;
        for (const [operation, column, values] of query.filters) {
          assert.equal(operation, "in", "Count the complete queue without a list limit or unrelated predicate");
          assert.equal(column, "status"); rows = rows.filter(status => values.includes(status));
        }
        return { data: null, count: Object.hasOwn(options, "count") ? options.count : rows.length, error: null };
      }).then(resolve, reject);
      return (...args) => {
        if (method === "select") query.select = JSON.parse(JSON.stringify(args));
        else query.filters.push([method, ...args]);
        return chain;
      };
    } });
    return chain;
  } };
}

for (const status of openStatuses) test(`the open-case badge includes active ${status} cases`, async () => {
  const db = database([status]), result = await exports.getAdminOperationsCenter(db);
  assert.equal(db.queries.filter(query => query.table === "dmca_cases").length, 1);
  assert.equal(result.attention.dmca, 1); assert.equal(result.attention.total, 1);
  assert.equal(adminWorkspaceCounts(result).more.value, 1);
  assert.equal(result.warnings.length, 0);
});

test("terminal copyright cases do not increase the open-case badge", async () => {
  const result = await exports.getAdminOperationsCenter(database(terminalStatuses));
  assert.equal(result.attention.dmca, 0); assert.equal(result.attention.total, 0);
  assert.equal(adminWorkspaceCounts(result).more.value, 0); assert.equal(result.warnings.length, 0);
});

test("the exact open-case count is not capped by the panel's first 100 records", async () => {
  const statuses = Array.from({ length: 125 }, (_, index) => openStatuses[index % openStatuses.length]);
  const result = await exports.getAdminOperationsCenter(database([...statuses, ...terminalStatuses]));
  assert.equal(result.attention.dmca, 125); assert.equal(result.attention.total, 125);
  assert.equal(adminWorkspaceCounts(result).more.value, 125); assert.equal(result.warnings.length, 0);
});

for (const [label, count] of [["missing", undefined], ["null", null], ["negative", -1], ["malformed", "3"]]) {
  test(`an unconfirmed ${label} query count leaves workspace badges unavailable`, async () => {
    const result = await exports.getAdminOperationsCenter(database(["submitted"], { count }));
    assert.equal(result.warnings.length, 1); assert.equal(result.warnings[0].section, "Copyright cases");
    const counts = adminWorkspaceCounts(result);
    assert.equal(counts.home.value, null); assert.equal(counts.more.value, null);
    assert.equal(counts.approvals.value, 0); assert.equal(counts.people.value, 0);
  });
}

test("an acknowledged zero remains a confirmed empty queue", async () => {
  const result = await exports.getAdminOperationsCenter(database([], { count: 0 }));
  assert.equal(result.attention.dmca, 0); assert.equal(result.warnings.length, 0);
  assert.equal(adminWorkspaceCounts(result).home.value, 0); assert.equal(adminWorkspaceCounts(result).more.value, 0);
});
