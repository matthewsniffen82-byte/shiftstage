import assert from "node:assert/strict";
import test from "node:test";
import { runVideoReviewChecks } from "../src/lib/dancr/video-review-checks.ts";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("all independent video checks start together and every result is required", async () => {
  const started = [], pending = Object.fromEntries(["frames", "text", "policy", "identity"].map(key => [key, deferred()]));
  let finished = false;
  const task = runVideoReviewChecks(Object.fromEntries(Object.entries(pending).map(([key, check]) => [key, () => { started.push(key); return check.promise; }])));
  task.then(() => { finished = true; });
  await Promise.resolve();
  assert.deepEqual(started, ["frames", "text", "policy", "identity"]);
  pending.frames.resolve(["approved"]); pending.text.resolve("approved"); pending.policy.resolve("approved");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  pending.identity.resolve("rejected");
  assert.deepEqual(await task, { frameResults: ["approved"], textResult: "approved", policyDecision: "approved", identityAnalysis: "rejected" });
});

test("a failed video check waits for the other checks and preserves the failure", async () => {
  const slowIdentity = deferred(), failure = new Error("Review unavailable");
  let finished = false;
  const task = runVideoReviewChecks({ frames: async () => { throw failure; }, text: async () => "approved", policy: async () => "approved", identity: () => slowIdentity.promise });
  const outcome = task.catch(error => { finished = true; return error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  slowIdentity.resolve("approved");
  assert.equal(await outcome, failure);
});
