import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("immediate cancellation delivery uses the durable worker with the same request and deadline", async () => {
  const exports = {}, calls = [], client = {};
  const code = ts.transpileModule(readFileSync(new URL("../src/lib/dancr/internal-request-cancellation-push.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => name === "server-only" ? {} : {
    deliverInternalRequestPush: async (...args) => { calls.push(args); return { retry: 1 }; },
  } });
  const result = await exports.deliverInternalCancellationPush(client, "request", { deadline: 45000 });
  assert.equal(result.retry, 1);
  assert.equal(calls[0][0], client);
  assert.equal(calls[0][1], "request");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), { event: "cancelled", deadline: 45000 });
});
