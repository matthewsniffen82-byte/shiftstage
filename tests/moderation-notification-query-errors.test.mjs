import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import ts from "typescript";
import { safeErrorMetadata } from "../src/lib/security/safe-error-metadata.ts";
const cases = [
  ["automatic", "src/lib/dancr/image-moderation.ts", "createAutoRejectedPhotoNotification", "IMAGE_MODERATION_NOTIFICATION_NOT_SAVED"],
  ["administrator", "app/api/admin/image-moderation/route.ts", "createNeutralNotification", "ADMIN_IMAGE_MODERATION_NOTIFICATION_NOT_SAVED"],
];
for (const [label, path, functionName, event] of cases) {
  const source = process.env.NOTIFICATION_BASELINE === "1"
    ? execFileSync("git", ["show", "HEAD:" + path], { encoding: "utf8", windowsHide: true })
    : readFileSync(new URL("../" + path, import.meta.url), "utf8");
  const code = ts.transpileModule(source + "\nexports.notify = " + functionName + ";", {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [failureLabel, failure, throws] of [
    ["success", null, false],
    ["timeout result", { code: "57014", message: "private recipient@example.invalid", details: "private body" }, false],
    ["permission result", { code: "42501", message: "private data" }, false],
    ["lost response", Object.assign(new Error("private notification response"), { code: "08006" }), true],
    ["untrusted error fields", { code: "private email@example.invalid", requestId: "private bearer token", status: 503 }, false],
  ]) {
    test(label + " notification handles " + failureLabel + " without retrying its completed moderation decision", async () => {
      const warnings = [], inserts = [], exports = {};
      vm.runInNewContext(code, {
        exports, Error, Date, require: () => ({ safeErrorMetadata }),
        console: { warn: (...values) => warnings.push(values) },
      });
      const client = { from(table) {
        assert.equal(table, "notifications", "No moderation or profile mutation is permitted");
        return { async insert(row) {
          inserts.push(row);
          if (throws) throw failure;
          return { data: null, error: failure };
        } };
      } };
      assert.equal(await exports.notify(client, "synthetic-private-recipient", "synthetic-review", []), undefined);
      assert.equal(inserts.length, 1);
      assert.equal(inserts[0].recipient_id, "synthetic-private-recipient");
      assert.equal(inserts[0].notification_type, "approval_status");
      assert.equal(inserts[0].channel, "in_app");
      assert.equal(inserts[0].payload.status, "rejected");
      assert.equal(inserts[0].payload.setupStep, "photos");
      assert.ok(Number.isFinite(Date.parse(inserts[0].sent_at)));
      assert.equal(warnings.length, failure ? 1 : 0);
      if (failure) {
        assert.equal(warnings[0][0], event);
        assert.doesNotMatch(JSON.stringify(warnings), /private|recipient|body|bearer/);
        assert.deepEqual(Object.keys(warnings[0][1]).sort(), Object.keys(safeErrorMetadata(failure)).sort());
      }
    });
  }
}
