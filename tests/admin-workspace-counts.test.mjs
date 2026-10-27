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
      return (...args) => { if (method === "select") { query.exact = args[1]?.count === "exact"; query.columns = args[0]; } else query.filters.push([method, ...args]); return chain; };
    } });
    return chain;
  } };
}

test("pending club counts use the full queue without duplicating media and profile approval totals", async () => {
  const db = database();
  const operations = await exports.getAdminOperationsCenter(db);
  const query = db.queries.find(query => query.table === "venue_signup_requests");
  assert.equal(query.exact, true);
  assert.deepEqual(query.filters, [["is", "admin_archived_at", null], ["eq", "status", "pending"]]);
  assert.equal(operations.attention.clubRequests, 300);
  assert.equal(operations.attention.total, 300);
  assert.equal(adminWorkspaceCounts(operations).approvals.value, 0);
  assert.equal(adminWorkspaceCounts(operations).clubs.value, 0);
});

test("every workspace displays zero and failed counts stay unavailable", async () => {
  const operations = await exports.getAdminOperationsCenter(database());
  operations.attention.clubRequests = 0;
  operations.attention.total = 0;
  for (const item of Object.values(adminWorkspaceCounts(operations))) assert.equal(adminCountLabel(item.value), "0");
  for (const item of Object.values(adminWorkspaceCounts(null))) assert.equal(adminCountLabel(item.value), "—");
  const failed = await exports.getAdminOperationsCenter(database(true));
  assert.equal(adminWorkspaceCounts(failed).approvals.value, 0);
  assert.equal(adminWorkspaceCounts(failed).home.value, null);
  assert.equal(adminWorkspaceCounts(failed).people.value, 0);
});

test("Home keeps confirmed pending totals when unrelated account or analytics queries fail", async () => {
  const operations = await exports.getAdminOperationsCenter(database());
  for (const section of ['Recent accounts', 'Accounts', 'Profile views (7 days)', 'Admin activity', 'Overdue support', 'Active venues']) {
    operations.warnings = [{section,message:'Unavailable'}];
    assert.equal(adminWorkspaceCounts(operations).home.value,300,section);
    operations.attention.total = 0;
    assert.equal(adminWorkspaceCounts(operations).home.value,0,`${section}: empty queues stay confirmed`);
    operations.attention.total = 300;
  }
  for (const section of ['Dancer approvals','Photo moderation','Video moderation','Social link reviews','Content reports','Copyright cases','Support inbox','Venue setup','Club signup requests','Club deal requests','Club page changes']) {
    operations.warnings = [{section,message:'Unavailable'}];
    assert.equal(adminWorkspaceCounts(operations).home.value,null,`${section}: an incomplete pending total stays unavailable`);
  }
});

test("recent accounts join dancer profiles through account ownership, not venue approval or follows", async () => {
  const db = database();
  await exports.getAdminOperationsCenter(db);
  const query = db.queries.find(query=>query.table==='app_users' && !query.exact);
  assert.match(query.columns,/dancer_profiles!dancer_profiles_user_id_fkey\(/);
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
