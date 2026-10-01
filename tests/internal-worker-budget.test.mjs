import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { virtualServerJob } from "./helpers/virtual-server-job.mjs";

function fixture({ cancellation = false, accepted = 1, failReceipt = false } = {}) {
  const clock = virtualServerJob(), api = {}, claimed = [], finished = [], messages = [];
  let sequence = 0;
  const code = ts.transpileModule(readFileSync(new URL("../src/lib/dancr/internal-request-push.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports: api, performance: clock.performance, console: { warn() {} }, require: name => ({
    "server-only": {}, "../server-job": clock.api,
    "./customer-notification-delivery": { notificationPushDelivery: () => ({ pushAvailable: true }) },
    "./venue-notification-preferences": { venueNotificationSettings: () => ({ alertsEnabled: true, tableRequests: true, pushEnabled: true }) },
    "./notification-delivery": { deliverNotificationRows: async (_client, rows) => { messages.push(...rows); await clock.delay(18000); return { push: accepted }; } },
  }[name]) });
  const client = {
    auth: { admin: { getUserById: async () => { await clock.delay(3000); return { error: null, data: { user: {} } }; } } },
    rpc: async (name, args) => {
      await clock.delay(3000);
      if (name === "claim_internal_request_alerts") {
        const jobs = Array.from({ length: args.p_limit }, () => ({ id: String(++sequence), lease_id: "lease", recipient_id: "staff", table_label: "Table 1", stage_name: "Synthetic", event_kind: cancellation ? "cancelled" : "requested" }));
        claimed.push(...jobs); return { error: null, data: jobs };
      }
      finished.push(args);
      return { error: failReceipt && args.p_id === "1" ? Error("Receipt failed") : null, data: true };
    },
  };
  return { clock, claimed, finished, messages, run: options => api.deliverInternalRequestPush(client, undefined, options) };
}
test("slow push delivery leases one wave and acknowledges all four before the route deadline", async () => {
  const f = fixture(), result = await f.clock.run(() => f.run());
  assert.equal(f.claimed.length, 4);
  assert.equal(f.finished.length, 4);
  assert.equal(result.sent, 4);
  assert.equal(f.clock.performance.now(), 27000);
});
test("time spent in the request handler prevents an unsafe immediate push claim", async () => {
  const f = fixture();
  await f.clock.run(() => f.run({ deadline: 39000 }));
  assert.equal(f.claimed.length, 0);
});
test("zero accepted cancellation pushes remain retryable with the same delivery identity", async () => {
  const f = fixture({ cancellation: true, accepted: 0 }), result = await f.clock.run(() => f.run());
  assert.equal(result.retry, 4);
  assert.ok(f.finished.every(item => item.p_outcome === "retry"));
  assert.ok(f.messages.every(item => item.title === "Table request cancelled" && item.payload.event === "cancelled"));
  assert.deepEqual(f.messages.map(item => item.deliveryId), f.claimed.map(item => item.id));
});
test("one failed acknowledgment does not abandon the other jobs in the wave", async () => {
  const f = fixture({ failReceipt: true });
  await assert.rejects(f.clock.run(() => f.run()), /acknowledgement unavailable/);
  assert.equal(f.finished.length, 4);
});
