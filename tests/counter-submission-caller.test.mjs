import assert from "node:assert/strict";
import test, { before, beforeEach, after } from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { PublicApiError, resolveApiError } from "../src/lib/api-error-policy.ts";
import { safeErrorMetadata } from "../src/lib/security/safe-error-metadata.ts";
import { createCounterDatabase, seedCounterDatabase, counterSnapshot, submitCounter, counterInput, fixtureId } from "./helpers/counter-submission-database.mjs";

const source = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const actions = {};
vm.runInNewContext(compile(source("src/lib/dancr/dmca-counter-submission.ts")), { exports: actions, Error, require: () => ({ PublicApiError }) });
const libraryCode = compile(process.env.COUNTER_CALLER_BASELINE === "1" ? execFileSync("git", ["show", "HEAD:src/lib/dancr/dmca.ts"], { encoding: "utf8", windowsHide: true }) : source("src/lib/dancr/dmca.ts"));
const routeCode = compile(source("app/api/dmca/cases/[id]/route.ts"));
let pg;
before(async () => { pg = await createCounterDatabase(); });
beforeEach(async () => { await seedCounterDatabase(pg); });
after(async () => { await pg?.close(); });

function setup(options = {}) {
  const calls = [], emails = [], notifications = [], logs = [], acknowledgments = [];
  const client = {
    async rpc(name, args) {
      if (name === "confirm_dmca_counter_forwarding") {
        // These historical submission cases isolate the acknowledgment boundary.
        // The current-function caller fixture executes the real forwarding RPC.
        acknowledgments.push(args);
        if (options.ackFailure) return { data: null, error: { code: "08006", message: "private acknowledgment failure" } };
        const rows = (await pg.query("update public.dmca_counter_notices set status='forwarded',forwarded_to_claimant_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1 and case_id=$2 and status='submitted' and forwarded_to_claimant_at is null returning id,case_id,status,forwarded_to_claimant_at", [args.p_counter_id,args.p_case_id])).rows;
        return { data: rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null, error: null };
      }
      assert.equal(name, "submit_dmca_counter_notice_safely"); calls.push(args);
      if (options.failure) return { data: null, error: options.failure };
      if (options.override) return { data: options.override(), error: null };
      try {
        const data = await submitCounter(pg, { user: args.p_user_id, caseId: args.p_case_id, details: args.p_details });
        if (options.lost) { options.lost = false; return { data: null, error: { code: "08006", message: "private submission data" } }; }
        return { data, error: null };
      } catch (error) { return { data: null, error }; }
    },
    from(table) {
      assert.ok(["dmca_counter_notices", "notifications"].includes(table), "Separate case access is not part of submission");
      let values; const filters = [];
      const query = {
        select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, is(key, value) { filters.push([key, value]); return query; },
        insert(row) { assert.equal(table, "notifications", "Notice insertion must be atomic"); values = row; return query; },
        update() { assert.fail("Acknowledgments must use their checked transaction RPC"); },
        delete() { assert.fail("No compensating delete is permitted"); },
        maybeSingle: run, single: run, then(resolve, reject) { return run().then(resolve, reject); },
      };
      async function run() {
        if (table === "notifications") {
          notifications.push(values); if (options.notificationFailure) throw new Error("private notification failure");
          return { data: null, error: null };
        }
        const id = filters.find(([key]) => key === "id")?.[1], caseId = filters.find(([key]) => key === "case_id")?.[1];
        assert.ok(id && caseId);

        const rows = (await pg.query("select id,case_id,status,forwarded_to_claimant_at from public.dmca_counter_notices where id=$1 and case_id=$2", [id, caseId])).rows;
        return { data: rows[0] ? JSON.parse(JSON.stringify(rows[0])) : null, error: null };
      }
      return query;
    },
  };
  const library = {}, route = {};
  vm.runInNewContext(libraryCode, { exports: library, Error, Date,
    console: { warn: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    require(name) {
      if (name.endsWith("dmca-counter-submission")) return actions;
      if (name.endsWith("notification-delivery")) return { async sendTransactionalEmail(input) {
        emails.push(input); if (options.emailFailure) throw new Error("private email response"); return { delivered: options.delivered !== false };
      } };
      if (name.endsWith("safe-error-metadata")) return { safeErrorMetadata };
      return {};
    },
  });
  vm.runInNewContext(routeCode, { exports: route, Error,
    console: { error: (...args) => logs.push(args) },
    require(name) {
      if (name === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
      if (name.endsWith("/api")) return { PublicApiError, apiError(error, fallback, status) { const result = resolveApiError(error, fallback, status); return Response.json(result.body, { status: result.status }); } };
      if (name.endsWith("/dmca")) return library;
      if (name.endsWith("supabase/admin")) return { createAdminSupabaseClient: () => client };
      if (name.endsWith("supabase/request")) return { createRequestSupabaseContext: async () => {
        if (options.noAuth) throw new Error("Sign in required."); return { user: { id: options.user || fixtureId(1) } };
      } };
      if (name.endsWith("bounded-json-body")) return { readBoundedJsonObject: request => request.json() };
      if (name.endsWith("safe-error-metadata")) return { safeErrorMetadata };
      throw new Error("Unexpected dependency " + name);
    },
  });
  return { client, library, calls, emails, notifications, logs, acknowledgments, async post(input = counterInput) {
    const response = await route.POST(new Request("https://example.invalid/counter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }), { params: Promise.resolve({ id: fixtureId(10) }) });
    return { response, body: await response.json() };
  } };
}
test("the actual endpoint confirms one atomic receipt, then forwards and acknowledges it", async () => {
  const h = setup(), result = await h.post(), state = await counterSnapshot(pg);
  assert.equal(result.response.status, 201); assert.equal(result.body.ok, true); assert.equal(result.body.counterNotice.status, "forwarded");
  assert.equal(h.calls.length, 1); assert.equal(h.emails.length, 1); assert.equal(h.acknowledgments.length, 1); assert.equal(h.notifications.length, 1);
  assert.equal(state.dmca_counter_notices.length, 1); assert.equal(state.dmca_cases[0].status, "countered");
  const receipt = result.body.counterNotice;
  assert.equal(new Date(receipt.counterReceivedAt).toISOString(), state.dmca_cases[0].counter_received_at.toISOString());
  assert.equal(new Date(receipt.restoreEligibleAt).toISOString(), state.dmca_cases[0].restore_eligible_at.toISOString());
  assert.equal(h.emails[0].to, "claimant@example.invalid");
  assert.doesNotMatch(JSON.stringify(result.body), /claimant@|Synthetic Uploader|Synthetic Street/);
});
test("an uncertain committed RPC can be retried without duplicate notice, dates or external work", async () => {
  const h = setup({ lost: true }); assert.equal((await h.post()).response.status, 503);
  const before = await counterSnapshot(pg); assert.equal(before.dmca_counter_notices.length, 1);
  const retry = await h.post(); assert.equal(retry.response.status, 200); assert.equal(retry.body.counterNotice.duplicate, true);
  assert.equal(h.calls.length, 2); assert.equal(h.emails.length, 0); assert.equal(h.notifications.length, 0);
  assert.deepEqual(await counterSnapshot(pg), before);
});
test("repeating a confirmed submission returns its existing forwarded receipt", async () => {
  const h = setup(), first = await h.post(), before = await counterSnapshot(pg), retry = await h.post();
  assert.equal(retry.response.status, 200); assert.match(retry.body.message, /already received/);
  assert.equal(retry.body.counterNotice.id, first.body.counterNotice.id); assert.equal(retry.body.counterNotice.status, "forwarded");
  assert.equal(h.emails.length, 1); assert.equal(h.notifications.length, 1); assert.deepEqual(await counterSnapshot(pg), before);
});
for (const [caseStatus, status] of [["court_hold", "forwarded"], ["closed", "rejected"], ["closed", "withdrawn"], ["restored", "completed"]]) {
  test("endpoint replay preserves " + caseStatus + "/" + status, async () => {
    await submitCounter(pg); await pg.query("update public.dmca_cases set status=$1 where id=$2", [caseStatus, fixtureId(10)]);
    await pg.query("update public.dmca_counter_notices set status=$1", [status]);
    const before = await counterSnapshot(pg), h = setup(), result = await h.post();
    assert.equal(result.response.status, 200); assert.equal(result.body.counterNotice.caseStatus, caseStatus); assert.equal(result.body.counterNotice.status, status);
    assert.deepEqual(await counterSnapshot(pg), before); assert.equal(h.emails.length, 0); assert.equal(h.notifications.length, 0);
  });
}
test("different details cannot overwrite the prior receipt or send another message", async () => {
  const h = setup(); await h.post(); const before = await counterSnapshot(pg);
  assert.equal((await h.post({ ...counterInput, address: "456 Different Street" })).response.status, 409);
  assert.equal(h.emails.length, 1); assert.deepEqual(await counterSnapshot(pg), before);
});
for (const option of ["emailFailure", "notificationFailure", "ackFailure"]) {
  test(option + " after commit preserves the receipt and never retries external work", async () => {
    const h = setup({ [option]: true }), result = await h.post();
    assert.equal(result.response.status, 201); assert.equal(result.body.ok, true);
    assert.equal(result.body.partial, option !== "notificationFailure");
    assert.equal((await counterSnapshot(pg)).dmca_counter_notices.length, 1);
    const replay = await h.post(); assert.equal(replay.response.status, 200); assert.equal(h.emails.length, 1);
    assert.doesNotMatch(JSON.stringify(result.body), /private/); assert.doesNotMatch(JSON.stringify(h.logs), /private/);
  });
}
test("undelivered mail does not claim a forwarded notice", async () => {
  const h = setup({ delivered: false }), result = await h.post();
  assert.equal(result.body.counterNotice.status, "submitted"); assert.equal(h.acknowledgments.length, 0);
});
for (const [code, expected] of [["P0002", 404], ["42501", 404], ["22023", 400], ["23505", 409], ["40001", 503], ["55P03", 503], ["PGRST202", 503], ["08006", 503], ["57014", 503], ["XX000", 500]]) {
  test("RPC " + code + " does not trigger fallback, success or external mail", async () => {
    const before = await counterSnapshot(pg), h = setup({ failure: { code, message: "private database record" } }), result = await h.post();
    assert.equal(result.response.status, expected); assert.equal(result.body.ok, false); assert.equal(h.calls.length, 1);
    assert.equal(h.emails.length, 0); assert.equal(h.notifications.length, 0);
    assert.deepEqual(await counterSnapshot(pg), before); assert.doesNotMatch(JSON.stringify(result.body), /private/);
  });
}
for (const options of [{ noAuth: true }, { user: fixtureId(2) }]) {
  test("authentication/ownership denies " + JSON.stringify(options), async () => {
    const before = await counterSnapshot(pg), h = setup(options), result = await h.post();
    assert.equal(result.response.status, options.noAuth ? 401 : 404); assert.equal(h.emails.length, 0);
    assert.deepEqual(await counterSnapshot(pg), before);
  });
}
test("real case-update failure rolls back its notice before responding", async () => {
  await pg.exec("reset role;create or replace function public.synthetic_failure() returns trigger language plpgsql as $$begin raise exception 'private update failure' using errcode='XX000';end$$;create trigger synthetic_failure before update on public.dmca_cases for each row execute function public.synthetic_failure();set role service_role");
  const before = await counterSnapshot(pg), h = setup(); assert.equal((await h.post()).response.status, 500);
  assert.equal(h.emails.length, 0); assert.deepEqual(await counterSnapshot(pg), before);
});
for (const [label, transform] of [
  ["null", () => null], ["empty", () => ({})], ["duplicate", row => ({ ...row, duplicate: undefined })],
  ["notice id", row => ({ ...row, counter: { ...row.counter, id: "invalid" } })],
  ["notice case", row => ({ ...row, counter: { ...row.counter, case_id: fixtureId(11) } })],
  ["case id", row => ({ ...row, case: { ...row.case, id: fixtureId(11) } })],
  ["notice status", row => ({ ...row, counter: { ...row.counter, status: "approved" } })],
  ["case status", row => ({ ...row, case: { ...row.case, status: "disabled" } })],
  ...["counter_received_at", "restore_eligible_at", "restore_deadline_at"].map(key => [key, row => ({ ...row, case: { ...row.case, [key]: "invalid" } })]),
  ["reversed dates", row => ({ ...row, case: { ...row.case, restore_deadline_at: row.case.counter_received_at } })],
  ["claimant", row => ({ ...row, case: { ...row.case, claimant_email: null } })],
]) {
  test("malformed receipt " + label + " cannot produce success or an email", async () => {
    const valid = await submitCounter(pg), before = await counterSnapshot(pg), h = setup({ override: () => transform(valid) });
    assert.equal((await h.post()).response.status, 503); assert.equal(h.emails.length, 0); assert.deepEqual(await counterSnapshot(pg), before);
  });
}
test("incomplete confirmations fail before the RPC", async () => {
  const h = setup(); assert.equal((await h.post({ ...counterInput, perjuryConfirmed: false })).response.status, 400);
  assert.equal(h.calls.length, 0); assert.equal(h.emails.length, 0);
});

test("the actual form handler retains the database receipt time and later case status", async () => {
  const panel = source("app/dmca/counter/[id]/DmcaCounterForm.tsx"), ast = ts.createSourceFile("form.tsx", panel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler; function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") handler = node.getText(ast); ts.forEachChild(node, visit); } visit(ast); assert.ok(handler);
  const stamp = "2026-01-01T00:00:00.000Z";
  const state = { dmcaCase: { id: fixtureId(10), status: "disabled", counterNotices: [] }, caseId: fixtureId(10),
    submitInFlightRef: { current: false }, submitAbortRef: { current: null }, mountedRef: { current: true },
    readBrowserAccessToken: () => "synthetic", setIsError() {}, setIsSubmitting() {}, setStatus() {},
    setDmcaCase: fn => { state.dmcaCase = fn(state.dmcaCase); }, AbortController, Error,
    FormData: class { get(name) { return typeof counterInput[name] === "boolean" ? "on" : counterInput[name]; } },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, counterNotice: { id: fixtureId(200), caseStatus: "closed", status: "withdrawn", counterReceivedAt: stamp, restoreEligibleAt: "2026-01-15T00:00:00.000Z" } }) }),
  };
  vm.createContext(state); vm.runInContext(compile(handler + "\nglobalThis.run = submit;"), state);
  await state.run({ preventDefault() {}, currentTarget: {} });
  assert.equal(state.dmcaCase.status, "closed"); assert.equal(state.dmcaCase.counterReceivedAt, stamp);
  assert.equal(state.dmcaCase.counterNotices[0].id, fixtureId(200));
});
