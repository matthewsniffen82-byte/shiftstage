import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { safeErrorMetadata } from "../src/lib/security/safe-error-metadata.ts";

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const caseId = id(1), userId = id(2), videoId = id(3), adminId = id(4);
const privateError = Object.assign(new Error("private claimant name and mailbox@example.invalid"), { code: "08006" });
function compile(path) {
  const source = process.env.DMCA_ACTION_BASELINE
    ? execFileSync("git", ["-C", process.env.DMCA_ACTION_GIT_ROOT || process.cwd(), "show", process.env.DMCA_ACTION_BASELINE + ":" + path], { encoding: "utf8", windowsHide: true })
    : readFileSync(new URL("../" + path, import.meta.url), "utf8");
  return ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
const code = compile("src/lib/dancr/dmca.ts");
const adminCode = compile("app/api/admin/dmca/route.ts");
const workerCode = compile("app/api/cron/dmca-restoration/route.ts");

function setup({ action = "disable", receipt = value => value, rpc = "success", email = "success", lookup = "success", cases, allowed = true } = {}) {
  const events = [], logs = [], library = {};
  const rows = cases || [{ id: caseId, target_id: videoId, uploader_id: userId, claimant_email: "claimant@example.invalid", status: action === "disable" ? "submitted" : "countered" }];
  const client = {
    from(table) {
      const filters = []; let selected;
      const q = {
        select(columns) { selected = columns; return q; },
        eq(key, value) { filters.push([key, value]); return q; },
        lte(key, value) { filters.push([key, value]); return q; },
        order() { return q; }, limit() { return q; },
        maybeSingle: () => run(true),
        then(resolve, reject) { return run(false).then(resolve, reject); },
      };
      async function run(single) {
        events.push({ type: "select", table, filters, selected });
        if (table === "app_users") {
          if (lookup === "throw") throw privateError;
          if (lookup === "error") return { data: null, error: privateError };
          return { data: lookup === "missing" ? null : { email: "uploader@example.invalid" }, error: null };
        }
        assert.equal(table, "dmca_cases");
        const data = single ? rows.find(row => row.id === filters.find(([key]) => key === "id")?.[1]) || null : rows;
        return { data, error: null };
      }
      return q;
    },
    async rpc(name, args) {
      events.push({ type: "rpc", name, args });
      if (rpc === "throw") throw privateError;
      if (rpc === "error") return { data: null, error: privateError };
      const row = rows.find(row => row.id === args.p_case_id);
      assert.ok(row);
      const value = name === "apply_dmca_takedown"
        ? { caseId: row.id, videoId: row.target_id, uploaderId: row.uploader_id || userId, activeStrikes: 1, repeatInfringerEnforced: false }
        : { caseId: row.id, targetId: row.target_id, uploaderId: row.uploader_id, activeStrikes: 0, status: "restored" };
      return { data: receipt(value), error: null };
    },
  };
  vm.runInNewContext(code, {
    exports: library, Error, Date, Number, console: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    require(name) {
      if (name === "server-only" || name === "./public-request-rate-limit" || name === "./dmca-counter-submission") return {};
      if (name === "node:crypto") return {};
      if (name === "../api-error-policy") return { PublicApiError };
      if (name === "../security/safe-error-metadata") return { safeErrorMetadata };
      if (name === "./public-app-url") return { publicAppUrl: () => "https://example.invalid" };
      if (name === "./notification-delivery") return { async sendTransactionalEmail(input) {
        events.push({ type: "email", input });
        const outcome = typeof email === "function" ? email(input) : email;
        if (outcome === "throw") throw privateError;
        if (outcome === "null") return null;
        if (outcome === "missing") return {};
        return { delivered: outcome === "success" };
      } };
      throw new Error("Unexpected dependency " + name);
    },
  });
  function route(worker) {
    const exports = {};
    vm.runInNewContext(worker ? workerCode : adminCode, {
      exports, Error, console: { error: (...args) => logs.push(args) },
      require(name) {
        if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
        if (name.endsWith("/api")) return { apiError(error, fallback, status) { const r = resolveApiError(error, fallback, status); return Response.json(r.body, { status: r.status }); } };
        if (name.endsWith("bounded-json-body")) return { readBoundedJsonObject: request => request.json() };
        if (name.endsWith("dancr/admin")) return { async requireAdmin(clientArg, actor) { events.push({ type: "guard", actor }); assert.equal(clientArg, client); if (!allowed) throw new Error("Admin access required."); } };
        if (name.endsWith("dancr/dmca")) return { ...library, async forwardPendingDmcaCounterNotices() { return []; } };
        if (name.endsWith("supabase/admin")) return { createAdminSupabaseClient() { events.push({ type: "adminClient" }); return client; } };
        if (name.endsWith("supabase/request")) return { createRequestSupabaseContext: async () => ({ client, user: { id: adminId }, session: null }) };
        if (name.endsWith("dancr/cron-auth")) return { authorizeCronRequest: () => allowed ? null : Response.json({ ok: false }, { status: 401 }) };
        if (name.endsWith("safe-error-metadata")) return { safeErrorMetadata };
        throw new Error("Unexpected route dependency " + name);
      },
    });
    return exports;
  }
  const run = () => action === "worker" ? library.restoreEligibleDmcaCases(client)
    : library.applyDmcaAdminAction(client, adminId, caseId, action, "Synthetic review");
  return { client, library, events, logs, rows, run, route };
}

const faults = [
  ["null", () => null], ["array", () => []], ["string", () => "done"], ["empty", () => ({})],
  ["wrong case", v => ({ ...v, caseId: id(10) })], ["missing case", v => ({ ...v, caseId: undefined })],
  ["wrong target", v => ({ ...v, videoId: id(10), targetId: id(10) })],
  ["missing target", v => ({ ...v, videoId: undefined, targetId: undefined })],
  ["null target", v => ({ ...v, videoId: null, targetId: null })],
  ["wrong uploader", v => ({ ...v, uploaderId: id(10) })],
  ["missing uploader", v => ({ ...v, uploaderId: undefined })],
  ["null uploader", v => ({ ...v, uploaderId: null })],
  ["negative count", v => ({ ...v, activeStrikes: -1 })],
  ["fractional count", v => ({ ...v, activeStrikes: 0.5 })],
  ["string count", v => ({ ...v, activeStrikes: "1" })],
  ["infinite count", v => ({ ...v, activeStrikes: Infinity })],
  ["missing count", v => ({ ...v, activeStrikes: undefined })],
  ["overflow count", v => ({ ...v, activeStrikes: 2147483648 })],
  ["wrong status", v => ({ ...v, status: "closed" })],
];
for (const action of ["disable", "restore", "worker"]) {
  for (const [name, receipt] of faults) {
    test(`${action} refuses unconfirmed receipt: ${name}`, async () => {
      const h = setup({ action, receipt });
      if (action === "worker") {
        const results = await h.run();
        assert.equal(results[0].restored, false);
        assert.match(results[0].error, /could not be confirmed.*Review/);
      } else {
        await assert.rejects(h.run(), error => error instanceof PublicApiError && error.status === 503 && /review its current state/.test(error.message));
      }
      assert.equal(h.events.filter(e => e.type === "rpc").length, 1);
      assert.equal(h.events.filter(e => e.type === "email" || e.table === "app_users").length, 0);
      assert.doesNotMatch(JSON.stringify(h.logs), /private claimant|mailbox@example/);
    });
  }
  for (const rpc of ["error", "throw"]) {
    test(`${action} does not repeat or announce an uncertain ${rpc}`, async () => {
      const h = setup({ action, rpc });
      if (action === "worker") assert.equal((await h.run())[0].restored, false);
      else await assert.rejects(h.run(), e => e.status === 503);
      assert.equal(h.events.filter(e => e.type === "rpc").length, 1);
      assert.equal(h.events.filter(e => e.type === "email").length, 0);
      assert.doesNotMatch(JSON.stringify(h.logs), /private claimant|mailbox@example/);
    });
  }
  for (const email of ["success", "false", "throw", "null", "missing"]) {
    test(`${action} retains completed action with email ${email}`, async () => {
      const h = setup({ action, email });
      const output = await h.run(), result = action === "worker" ? output[0] : output;
      if (action === "worker") assert.equal(result.restored, true);
      else assert.equal(result.status, action === "disable" ? "disabled" : "restored");
      assert.equal(result.deliveryNeedsReview, email !== "success");
      assert.equal(h.events.filter(e => e.type === "rpc").length, 1);
      assert.equal(h.events.filter(e => e.type === "email").length, action === "disable" ? 2 : 1);
      assert.doesNotMatch(JSON.stringify(h.logs), /private claimant|mailbox@example/);
    });
  }
}

for (const receipt of [v => ({ ...v, repeatInfringerEnforced: undefined }), v => ({ ...v, repeatInfringerEnforced: "false" }), v => ({ ...v, repeatInfringerEnforced: true }), v => ({ ...v, activeStrikes: 0 })]) {
  test("disable rejects missing or inconsistent enforcement confirmation", async () => {
    const h = setup({ receipt }); await assert.rejects(h.run(), e => e.status === 503);
    assert.equal(h.events.filter(e => e.type === "email").length, 0);
  });
}
for (const action of ["restore", "worker"]) {
  test(`${action} requires the restored status in the receipt`, async () => {
    const h = setup({ action, receipt: v => ({ ...v, status: undefined }) });
    if (action === "worker") assert.equal((await h.run())[0].restored, false);
    else await assert.rejects(h.run(), e => e.status === 503);
    assert.equal(h.events.filter(e => e.type === "email").length, 0);
  });
}
test("an invalid claimant address retains the action receipt and flags notification review", async () => {
  const h = setup({ action: "restore", cases: [{ id: caseId, target_id: videoId, uploader_id: userId, claimant_email: null }] });
  const result = await h.run(); assert.equal(result.status, "restored"); assert.equal(result.deliveryNeedsReview, true);
  assert.equal(h.events.filter(e => e.type === "email").length, 0);
});
for (const lookup of ["error", "throw", "missing"]) {
  test(`disable preserves receipt and attempts claimant mail after uploader lookup ${lookup}`, async () => {
    const h = setup({ lookup }); const result = await h.run();
    assert.equal(result.status, "disabled"); assert.equal(result.deliveryNeedsReview, true);
    assert.equal(h.events.filter(e => e.type === "email").length, 1);
    assert.equal(h.events.find(e => e.type === "email").input.to, "claimant@example.invalid");
    assert.doesNotMatch(JSON.stringify(h.logs), /private claimant|mailbox@example/);
  });
}
test("disable retains the completed repeat-infringer receipt and notifies both recipients", async () => {
  const h = setup({ receipt: v => ({ ...v, activeStrikes: 3, repeatInfringerEnforced: true, privateExtra: "do not return" }) });
  const result = await h.run();
  assert.equal(result.activeStrikes, 3); assert.equal(result.repeatInfringerEnforced, true);
  assert.equal(result.privateExtra, undefined); assert.equal(result.deliveryNeedsReview, false);
  assert.match(h.events.find(e => e.type === "email").input.text, /account was also suspended/);
});
test("one email failure does not prevent the other recipient attempt or rerun takedown", async () => {
  const h = setup({ email: input => input.to === "uploader@example.invalid" ? "throw" : "success" });
  assert.equal((await h.run()).deliveryNeedsReview, true);
  assert.equal(h.events.filter(e => e.type === "email").length, 2);
  assert.equal(h.events.filter(e => e.type === "rpc").length, 1);
});
test("restoration accepts confirmed retention nulls after account/content deletion", async () => {
  const h = setup({ action: "restore", cases: [{ id: caseId, target_id: null, uploader_id: null, claimant_email: "claimant@example.invalid" }] });
  const result = await h.run(); assert.equal(result.status, "restored"); assert.equal(result.uploaderId, null); assert.equal(result.targetId, null);
});
test("takedown accepts a confirmed uploader resolved by the transaction from a previously unassigned case", async () => {
  const h = setup({ cases: [{ id: caseId, target_id: videoId, uploader_id: null, claimant_email: "claimant@example.invalid" }] });
  assert.equal((await h.run()).uploaderId, userId);
});
test("worker continues other cases while leaving an uncertain restoration unconfirmed", async () => {
  const rows = [1, 5].map(n => ({ id: id(n), target_id: id(n + 10), uploader_id: userId, claimant_email: "claimant@example.invalid" }));
  const h = setup({ action: "worker", cases: rows, receipt: v => v.caseId === caseId ? null : v });
  const results = await h.run();
  assert.deepEqual(Array.from(results, r => r.restored), [false, true]);
  assert.equal(h.events.filter(e => e.type === "rpc").length, 2);
  assert.equal(h.events.filter(e => e.type === "email").length, 1);
  assert.match(h.events[0].selected, /target_id, uploader_id/);
  assert.ok(h.events[0].filters.some(([key, value]) => key === "court_filing_received" && value === false));
});

for (const action of ["disable", "restore"]) {
  for (const outcome of ["success", "email-failure", "unconfirmed"]) {
    test(`administrator HTTP ${action}: ${outcome}`, async () => {
      const h = setup({ action, email: outcome === "email-failure" ? "throw" : "success", receipt: v => outcome === "unconfirmed" ? null : v });
      const request = new Request("https://example.invalid/api/admin/dmca", { method: "PATCH", body: JSON.stringify({ caseId, action, adminId: id(50), userId: id(51) }) });
      const response = await h.route(false).PATCH(request), body = await response.json();
      assert.equal(response.status, outcome === "unconfirmed" ? 503 : 200);
      assert.equal(body.ok, outcome !== "unconfirmed");
      if (outcome === "email-failure") { assert.equal(body.partial, true); assert.match(body.message, /do not repeat the completed action/); }
      if (outcome === "success") assert.equal(body.partial, false);
      if (outcome === "unconfirmed") assert.match(body.error, /review its current state/);
      assert.equal(h.events.find(e => e.type === "rpc").args.p_admin_id, adminId);
      assert.equal(h.events[0].type, "guard");
      assert.doesNotMatch(JSON.stringify(body), /private claimant|mailbox@example/);
    });
  }
}
for (const worker of [false, true]) {
  test((worker ? "worker" : "administrator") + " authorization failure cannot create the privileged client or invoke a mutation", async () => {
    const h = setup({ allowed: false });
    const request = new Request("https://example.invalid/api/dmca", { method: worker ? "GET" : "PATCH", ...(worker ? {} : { body: JSON.stringify({ caseId, action: "disable" }) }) });
    const response = await (worker ? h.route(true).GET(request) : h.route(false).PATCH(request));
    assert.equal(response.status, worker ? 401 : 403);
    assert.equal(h.events.filter(e => ["adminClient", "rpc", "email", "select"].includes(e.type)).length, 0);
  });
}
for (const outcome of ["success", "email-failure", "unconfirmed"]) {
  test(`worker HTTP counts confirmed database restoration independently of email: ${outcome}`, async () => {
    const h = setup({ action: "worker", email: outcome === "email-failure" ? "throw" : "success", receipt: v => outcome === "unconfirmed" ? null : v });
    const response = await h.route(true).GET(new Request("https://example.invalid/api/cron/dmca-restoration")), body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.processed, 1);
    assert.equal(body.restored, outcome === "unconfirmed" ? 0 : 1);
    if (outcome === "email-failure") assert.equal(body.results[0].deliveryNeedsReview, true);
    assert.equal(h.events.find(e => e.type === "rpc").args.p_admin_id, null);
    assert.doesNotMatch(JSON.stringify(body), /private claimant|mailbox@example/);
  });
}
