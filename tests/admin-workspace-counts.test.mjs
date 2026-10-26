import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { adminWorkspaceCounts, adminCountLabel } from "../app/admin/admin-workspace-counts.ts";

const source = await readFile(new URL("../src/lib/dancr/admin-operations.ts", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports, console: { error() {}, warn() {} }, require: () => ({ safeErrorMetadata: () => ({}), isActiveNfcPresence: () => true }),
});

function database(failRequests = false, dealCount = 0, failDealRequests = false) {
  const queries = [];
  return { queries, from(table) {
    const query = { table, filters: [], exact: false };
    queries.push(query);
    const chain = new Proxy({}, { get(_target, method) {
      if (method === "then") return resolve => resolve({ data: [], count: table === "venue_signup_requests" ? 300 : table === "venue_club_deal_requests" ? dealCount : 0,
        error: (failRequests && table === "venue_signup_requests") || (failDealRequests && table === "venue_club_deal_requests") ? new Error("unavailable") : null });
      return (...args) => { if (method === "select") query.exact = args[1]?.count === "exact"; else query.filters.push([method, ...args]); return chain; };
    } });
    return chain;
  } };
}

test("pending club counts use the full pending queue and contribute to approval totals", async () => {
  const db = database();
  const operations = await exports.getAdminOperationsCenter(db);
  const query = db.queries.find(query => query.table === "venue_signup_requests");
  assert.equal(query.exact, true);
  assert.deepEqual(query.filters, [["is", "admin_archived_at", null], ["eq", "status", "pending"]]);
  assert.equal(operations.attention.clubRequests, 300);
  assert.equal(operations.attention.total, 300);
  assert.equal(adminWorkspaceCounts(operations).approvals.value, 300);
  assert.equal(adminWorkspaceCounts(operations).clubs.value, 0);
});

test("every workspace displays zero and failed counts stay unavailable", async () => {
  const operations = await exports.getAdminOperationsCenter(database());
  operations.attention.clubRequests = 0;
  operations.attention.total = 0;
  for (const item of Object.values(adminWorkspaceCounts(operations))) assert.equal(adminCountLabel(item.value), "0");
  for (const item of Object.values(adminWorkspaceCounts(null))) assert.equal(adminCountLabel(item.value), "—");
  const failed = await exports.getAdminOperationsCenter(database(true));
  assert.equal(adminWorkspaceCounts(failed).approvals.value, null);
  assert.equal(adminWorkspaceCounts(failed).home.value, null);
  assert.equal(adminWorkspaceCounts(failed).people.value, 0);
});

test("open deal requests contribute exact totals without a row limit and page changes are included", async () => {
  const db = database(false, 720), operations = await exports.getAdminOperationsCenter(db);
  const query = db.queries.find(query => query.table === 'venue_club_deal_requests');
  assert.equal(query.exact, true);
  assert.equal(JSON.stringify(query.filters), JSON.stringify([['is', 'admin_archived_at', null], ['in', 'status', ['pending', 'under_review']]]));
  assert.equal(operations.attention.dealRequests, 720);
  assert.equal(operations.attention.total, 1020);
  assert.equal(adminWorkspaceCounts(operations).home.value, 1020);
  assert.ok(db.queries.some(query => query.table === 'venues' && JSON.stringify(query.filters) === JSON.stringify([['is', 'admin_archived_at', null], ['eq', 'page_review_status', 'changes_requested']])));
  const failed = await exports.getAdminOperationsCenter(database(false, 720, true));
  assert.ok(failed.warnings.some(warning => warning.section === 'Club deal requests'));
  assert.equal(adminWorkspaceCounts(failed).home.value, null);
});
