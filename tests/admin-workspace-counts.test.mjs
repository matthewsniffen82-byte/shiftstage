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

function database(failRequests = false, dealCount = 0, failDealRequests = false, batchCount = 0) {
  const queries = [];
  return { queries, from(table) {
    const query = { table, filters: [], exact: false };
    queries.push(query);
    const chain = new Proxy({}, { get(_target, method) {
      if (method === "then") return resolve => resolve({ data: table === "shifts" && query.exact ? Array(30).fill({}) : [], count: table === "shifts" && query.exact ? 45 : table === "venue_signup_requests" ? 300 : table === "venue_club_deal_requests" ? dealCount : table === "dancer_media_batches" ? batchCount : 0,
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

test("live check-in total includes dancers beyond the thirty listed",async()=>{
 const db=database(), operations=await exports.getAdminOperationsCenter(db);
 assert.equal(operations.live.checkedInCount,45);assert.equal(operations.live.checkedInDancers.length,30);
 const live=db.queries.find(query=>query.table==="shifts"&&query.exact);
 assert.ok(live.filters.some(([op,column,value])=>op==="neq"&&column==="status"&&value==="cancelled"));
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
  for (const section of ['Recent accounts', 'Accounts', 'Profile views (7 days)', 'Admin activity', 'Overdue support', 'Active clubs']) {
    operations.warnings = [{section,message:'Unavailable'}];
    assert.equal(adminWorkspaceCounts(operations).home.value,300,section);
    operations.attention.total = 0;
    assert.equal(adminWorkspaceCounts(operations).home.value,0,`${section}: empty queues stay confirmed`);
    operations.attention.total = 300;
  }
  for (const section of ['Media batches','Photo moderation','Video moderation','Content reports','Copyright cases','Support inbox','Club setup','Club signup requests','Club deal requests','Club page changes']) {
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

test('one submitted dancer batch creates one media task regardless of profile or social links', async () => {
  const db=database(false,0,false,1);
  const operations=await exports.getAdminOperationsCenter(db);
  assert.equal(operations.attention.mediaBatches,1);
  assert.equal(adminWorkspaceCounts(operations).approvals.value,1);
  const applicationCounts=db.queries.filter(query=>query.table==='dancer_profiles'&&query.exact&&query.filters.some(filter=>filter[1]==='status'&&filter[2]==='pending_review'));
  assert.equal(applicationCounts.length,0);
  const batchCounts=db.queries.filter(query=>query.table==='dancer_media_batches'&&query.exact);
  assert.equal(batchCounts.length,2);
  assert.ok(batchCounts.every(query=>query.filters.some(filter=>filter[1]==='state'&&filter[2]==='admin')));
  assert.ok(batchCounts.some(query=>query.filters.some(filter=>filter[0]==='lt'&&filter[1]==='club_submitted_at')));
  const standalone=db.queries.filter(query=>query.table==='admin_media_workspace');
  assert.ok(standalone.length===2&&standalone.every(query=>query.filters.some(([op,field,value])=>op==='is'&&field==='dancer_id'&&value===null)));
  assert.ok(!db.queries.some(query=>query.table==="approval_reviews"));
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
