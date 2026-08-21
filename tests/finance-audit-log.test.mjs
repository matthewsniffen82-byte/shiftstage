import assert from "node:assert/strict";
import test from "node:test";
import { writeFinancialAuditEvent } from "../src/lib/dancr/finance-audit-log.ts";

test("financial audit writes preserve the complete event payload", async () => {
  const calls = [];
  const client = {
    from(table) {
      return {
        async insert(event) {
          calls.push({ table, event });
          return { error: null };
        },
      };
    },
  };
  const event = {
    actor_type: "provider",
    action: "paid_payout_recovery_required",
    target_type: "payout",
    target_id: "batch-123",
  };

  await writeFinancialAuditEvent(client, event);

  assert.deepEqual(calls, [{ table: "financial_audit_events", event }]);
});

test("financial audit writes never hide a database failure", async () => {
  const databaseError = new Error("audit unavailable");
  const client = {
    from() {
      return {
        async insert() {
          return { error: databaseError };
        },
      };
    },
  };

  await assert.rejects(
    writeFinancialAuditEvent(client, { action: "test" }),
    (error) => error === databaseError,
  );
});
