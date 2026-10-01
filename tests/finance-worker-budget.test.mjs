import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { virtualServerJob } from "./helpers/virtual-server-job.mjs";

function fixture({ ambiguous = false } = {}) {
  const clock = virtualServerJob(), exports = {}, claims = [], finished = [];
  let issued = 0;
  class Ambiguous extends Error {}
  class Rejected extends Error {}
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../src/lib/dancr/nats-commission-sync.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => name === "../server-job" ? clock.api : {
    getNatsRuntimeConfig: () => ({ selected: true, configured: true }),
    NatsAmbiguousDispatchError: Ambiguous, NatsDefiniteRejectionError: Rejected,
    createNatsManualInvoice: async () => { await clock.delay(1000); if (ambiguous) throw new Ambiguous("Uncertain"); return { result: "ok", responseMetadata: {} }; },
  } });
  const client = { rpc: async (name, args) => {
    await clock.delay(1000);
    if (name === "claim_nats_agent_commission_exports") {
      claims.push(args.p_limit);
      return { error: null, data: [{ export_id: String(++issued), login_id: 1, amount_cents: 100, currency: "usd" }] };
    }
    finished.push({ name, args }); return { error: null, data: true };
  } };
  return { clock, claims, finished, run: limit => exports.syncNatsAgentCommissions(client, limit) };
}

test("a slow backlog leaves unclaimed exports pending and settles every claim before 50 seconds", async () => {
  const f = fixture(), result = await f.clock.run(() => f.run(100));
  assert.ok(result.exported > 0 && result.exported < 100);
  assert.ok(f.claims.every(limit => limit === 1));
  assert.equal(f.finished.length, f.claims.length);
  assert.ok(f.clock.performance.now() < 50000);
});
test("an exhausted parent budget cannot claim another financial operation", async () => {
  const f = fixture();
  await f.clock.run(() => f.clock.api.runWithServerJob(() => f.run(100), 29000));
  assert.equal(f.claims.length, 0);
});
test("uncertain provider outcomes retain manual reconciliation and never redispatch the same export", async () => {
  const f = fixture({ ambiguous: true }), result = await f.clock.run(() => f.run(2));
  assert.equal(result.reconciliationRequired, 2);
  assert.equal(new Set(f.finished.map(item => item.args.p_export_id)).size, 2);
  assert.ok(f.finished.every(item => item.args.p_status === "reconciliation_required"));
});
