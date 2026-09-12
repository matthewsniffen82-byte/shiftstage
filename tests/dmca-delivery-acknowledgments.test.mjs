import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { safeErrorMetadata } from "../src/lib/security/safe-error-metadata.ts";

const caseId = "11111111-1111-4111-8111-111111111111";
const counterId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const stamp = "2026-09-10T04:00:00.000Z";
const privateError = Object.assign(new Error("private legal name, address and email@example.invalid"), { code: "08006" });
const input = {
  legalName: "Synthetic Person", email: "counter@example.invalid", phone: "5555555555",
  address: "123 Synthetic Street", removedMaterialLocation: "https://example.invalid/video",
  signature: "Synthetic Person", mistakeBeliefConfirmed: true, perjuryConfirmed: true,
  jurisdictionConfirmed: true, serviceConfirmed: true,
};
function compile(path) {
  const source = process.env.DMCA_DELIVERY_BASELINE === "1"
    ? execFileSync("git", ["show", "HEAD:" + path], { encoding: "utf8", windowsHide: true })
    : readFileSync(new URL("../" + path, import.meta.url), "utf8");
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
}
const libraryCode = compile("src/lib/dancr/dmca.ts");
const routeCode = compile("app/api/dmca/cases/[id]/route.ts");

function setup({ mode = "success", delivered = true, notification = "success", worker = false } = {}) {
  const events = [], logs = [], exports = {};
  const state = {
    counter: worker ? { id: counterId, case_id: caseId, status: "submitted", forwarded_to_claimant_at: null } : null,
    dmcaCase: { id: caseId, uploader_id: userId, status: worker ? "countered" : "disabled", claimant_name: "Synthetic Claimant", claimant_email: "claimant@example.invalid" },
  };
  const client = { async rpc(name, args) {
    assert.equal(name, "confirm_dmca_counter_forwarding");
    assert.deepEqual({ ...args }, { p_counter_id: counterId, p_case_id: caseId });
    events.push({ op: "rpc", name, args });
    if (["rejected", "withdrawn", "completed"].includes(mode)) state.counter.status = mode;
    if (mode === "already-forwarded") Object.assign(state.counter, { status: "forwarded", forwarded_to_claimant_at: stamp });
    const commit = !["write-error", "write-throw", "read-error", "read-throw", "zero", "wrong-case", "bad-date", "null-date", "rejected", "withdrawn", "completed"].includes(mode);
    if (commit && state.counter.status === "submitted") Object.assign(state.counter, { status: "forwarded", forwarded_to_claimant_at: stamp });
    if (["write-throw", "commit-throw"].includes(mode)) throw privateError;
    if (["write-error", "commit-error", "read-error", "read-throw"].includes(mode)) return { data: null, error: privateError };
    return { data: commit && mode !== "commit-empty" ? { ...state.counter } : null, error: null };
  }, from(table) {
    let op = "select", values, selected = false;
    const filters = [];
    const q = {
      select() { selected = true; return q; },
      insert(row) { op = "insert"; values = row; return q; },
      update(row) { op = "update"; values = row; return q; },
      delete() { assert.fail("A completed submission must not be deleted"); },
      eq(key, value) { filters.push([key, value]); return q; },
      is(key, value) { filters.push([key, value]); return q; },
      order() { return q; }, limit() { return q; },
      single: run, maybeSingle: run,
      then(resolve, reject) { return run().then(resolve, reject); },
    };
    async function run() {
      events.push({ table, op, filters, selected });
      if (table === "notifications") {
        if (notification === "throw") throw privateError;
        return { error: notification === "returned" ? privateError : null, data: null };
      }
      if (table === "dmca_cases") {
        const matches = filters.every(([key, value]) => state.dmcaCase[key] === value);
        if (matches && op === "update") Object.assign(state.dmcaCase, values);
        return { error: null, data: matches ? { ...state.dmcaCase } : null };
      }
      assert.equal(table, "dmca_counter_notices");
      if (op === "insert") {
        state.counter = { id: counterId, forwarded_to_claimant_at: null, ...values };
        return { data: { ...state.counter }, error: null };
      }
      if (op === "select" && filters.some(([key]) => key === "dmca_cases.status")) {
        return { data: [{ ...state.counter, ...input, legal_name: input.legalName, removed_material_location: input.removedMaterialLocation,
          dmca_cases: { ...state.dmcaCase, restore_eligible_at: stamp, restore_deadline_at: stamp },
        }], error: null };
      }
      assert.equal(op, "select", "Forwarding writes use the transaction RPC");
      if (mode === "read-error") return { data: null, error: privateError };
      if (mode === "read-throw") throw privateError;
      if (mode === "zero") return { data: null, error: null };
      if (mode === "wrong-case") return { data: { ...state.counter, case_id: "different-case", status: "forwarded", forwarded_to_claimant_at: stamp }, error: null };
      if (["bad-date", "null-date"].includes(mode)) return { data: { ...state.counter, status: "forwarded", forwarded_to_claimant_at: mode === "bad-date" ? "not-a-date" : null }, error: null };
      return { data: { ...state.counter }, error: null };
    }
    return q;
  } };
  vm.runInNewContext(libraryCode, {
    exports, Error, Date,
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    require(name) {
      if (name.endsWith("dmca-counter-submission")) return { async recordDmcaCounterSubmission() {
        // These cases isolate delivery acknowledgment after a confirmed atomic
        // submission. Native transaction/caller cases cover the actual RPC.
        state.counter = { id: counterId, case_id: caseId, status: "submitted", forwarded_to_claimant_at: null };
        state.dmcaCase.status = "countered";
        return { id: counterId, caseId, status: "submitted", caseStatus: "countered", duplicate: false,
          counterReceivedAt: stamp, restoreEligibleAt: "2026-09-24T04:00:00.000Z", restoreDeadlineAt: "2026-09-30T04:00:00.000Z",
          claimantName: state.dmcaCase.claimant_name, claimantEmail: state.dmcaCase.claimant_email };
      } };
      if (name.endsWith("notification-delivery")) return { async sendTransactionalEmail() { events.push({ op: "email" }); return { delivered }; } };
      if (name.endsWith("safe-error-metadata")) return { safeErrorMetadata };
      return {};
    },
  });
  return { library: exports, client, state, events, logs };
}

const failures = ["write-error", "write-throw", "read-error", "read-throw", "zero", "rejected", "withdrawn", "completed", "wrong-case", "bad-date", "null-date"];
for (const worker of [false, true]) {
  for (const mode of ["success", "commit-error", "commit-throw", "commit-empty", "already-forwarded", ...failures]) {
    test((worker ? "scheduled" : "submitted") + " counter-notice confirms delivery: " + mode, async () => {
      const h = setup({ mode, worker });
      const call = worker
        ? h.library.forwardPendingDmcaCounterNotices(h.client)
        : h.library.submitDmcaCounterNotice(h.client, userId, caseId, input);
      if (failures.includes(mode) && worker) {
        await assert.rejects(call, /delivery status could not be confirmed/);
      } else {
        const result = await call;
        if (worker) assert.equal(result[0].forwarded, true);
        else {
          assert.equal(result.status, failures.includes(mode) ? "submitted" : "forwarded");
          assert.equal(result.deliveryNeedsReview, failures.includes(mode));
          assert.equal(h.state.dmcaCase.status, "countered");
          assert.equal(h.events.filter(e => e.table === "notifications").length, 1);
        }
      }
      assert.equal(h.events.filter(e => e.op === "email").length, 1, "No email resend during confirmation");
      const writes = h.events.filter(e => e.op === "rpc");
      assert.equal(writes.length, 1);
      assert.equal(writes[0].name, "confirm_dmca_counter_forwarding");
      assert.equal(h.events.filter(e => e.table === "dmca_counter_notices" && e.op === "update").length, 0);
      assert.equal(h.events.filter(e => e.table === "dmca_counter_notices" && e.op === "select" && !e.filters.some(([key]) => key.includes("."))).length, ["success", "already-forwarded"].includes(mode) ? 0 : 1);
      if (["rejected", "withdrawn", "completed"].includes(mode)) assert.equal(h.state.counter.status, mode);
      if (mode === "already-forwarded") assert.equal(h.state.counter.forwarded_to_claimant_at, stamp);
      assert.doesNotMatch(JSON.stringify(h.logs), /private|email@example|Synthetic Person|123 Synthetic/);
    });
  }
  test((worker ? "scheduled" : "submitted") + " counter-notice never records unsuccessful email delivery as forwarded", async () => {
    const h = setup({ worker, delivered: false });
    const result = worker ? await h.library.forwardPendingDmcaCounterNotices(h.client)
      : await h.library.submitDmcaCounterNotice(h.client, userId, caseId, input);
    assert.equal(worker ? result[0].forwarded : result.status, worker ? false : "submitted");
    assert.equal(h.events.filter(e => e.op === "rpc").length, 0);
    assert.equal(h.events.filter(e => e.op === "email").length, 1);
  });
}

for (const notification of ["returned", "throw"]) {
  test("optional counter-notice notification " + notification + " failure preserves submitted/forwarded receipt", async () => {
    const h = setup({ notification });
    const result = await h.library.submitDmcaCounterNotice(h.client, userId, caseId, input);
    assert.equal(result.status, "forwarded");
    assert.equal(result.deliveryNeedsReview, false);
    assert.equal(h.events.filter(e => e.table === "notifications").length, 1);
    assert.equal(h.events.filter(e => e.op === "email").length, 1);
    assert.deepEqual(h.logs[0], ["DMCA_COUNTER_NOTIFICATION_NOT_SAVED", { errorName: "Error", code: "08006" }]);
  });
}

for (const mode of ["success", "write-error"]) {
  test("counter-notice API preserves receipt and displays the delivery outcome: " + mode, async () => {
    const h = setup({ mode }), exports = {};
    class PublicApiError extends Error {}
    vm.runInNewContext(routeCode, {
      exports, Error, console,
      require(name) {
        if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
        if (name.endsWith("/api")) return { PublicApiError, apiError: () => Response.json({ ok: false }, { status: 500 }) };
        if (name.endsWith("/dmca")) return h.library;
        if (name.endsWith("supabase/admin")) return { createAdminSupabaseClient: () => h.client };
        if (name.endsWith("supabase/request")) return { createRequestSupabaseContext: async () => ({ user: { id: userId } }) };
        if (name.endsWith("bounded-json-body")) return { readBoundedJsonObject: async () => input };
        if (name.endsWith("safe-error-metadata")) return { safeErrorMetadata };
        throw new Error("Unexpected dependency: " + name);
      },
    });
    const response = await exports.POST(new Request("https://example.invalid/api/dmca/cases/" + caseId, { method: "POST" }), { params: Promise.resolve({ id: caseId }) });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.partial, mode !== "success");
    assert.equal(body.counterNotice.caseId, caseId);
    assert.equal(body.counterNotice.status, mode === "success" ? "forwarded" : "submitted");
    if (mode !== "success") assert.match(body.message, /received.*delivery status could not be confirmed.*Do not submit it again/);
    assert.doesNotMatch(JSON.stringify(body), /private|email@example|Synthetic Person|123 Synthetic/);
  });
}
