import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsonBody from "../src/lib/bounded-json-body.ts";
import { PublicApiError } from "../src/lib/api-error-policy.ts";

const encoder = new TextEncoder();
function fixture({ chunks = ["{"], headers = {}, close = false, cancelHangs = false, signal } = {}) {
  let cancellations = 0, streamController, closed = false;
  const body = new ReadableStream({
    start(controller) {
      streamController = controller;
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) { closed = true; controller.close(); }
    },
    cancel() { cancellations++; closed = true; if (cancelHangs) return new Promise(() => {}); },
  });
  const request = new Request("https://synthetic.invalid/api/body", { method: "POST", headers, body, signal, duplex: "half" });
  return { request, cancellations: () => cancellations,
    enqueue(value) { if (!closed) streamController.enqueue(encoder.encode(value)); },
    release() { if (!closed) { closed = true; streamController.close(); } },
  };
}
async function settles(pending, f) {
  let timer;
  const outcome = pending.then(value => ({ value }), error => ({ error }));
  try {
    const result = await Promise.race([outcome, new Promise(resolve => { timer = setTimeout(() => resolve({ stalled: true }), 250); })]);
    assert.equal(result.stalled, undefined, "The reader must settle inside its request deadline");
    return result;
  } finally {
    clearTimeout(timer); f.release();
  }
}
test("stalled incoming bodies expire and cancel their reader", async () => {
  const f = fixture();
  const result = await settles(jsonBody.readBoundedRequestBytes(f.request, 100, "Too large", 15), f);
  assert.equal(result.error?.status, 408);
  assert.equal(f.cancellations(), 1);
  assert.doesNotMatch(result.error.message, /synthetic|private/);
});
test("slow incoming chunks do not reset the total body deadline", async () => {
  const f = fixture();
  const interval = setInterval(() => f.enqueue(" "), 3);
  try {
    const result = await settles(jsonBody.readBoundedRequestBytes(f.request, 10000, "Too large", 20), f);
    assert.equal(result.error?.status, 408);
    assert.equal(f.cancellations(), 1);
  } finally { clearInterval(interval); }
});
test("caller abort stops a pending body read without waiting for its deadline", async () => {
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal });
  const pending = jsonBody.readBoundedRequestBytes(f.request, 100, "Too large", 2000);
  controller.abort();
  const result = await settles(pending, f);
  assert.equal(result.error?.status, 400);
  assert.equal(f.cancellations(), 1);
});
test("already-aborted requests dispose of their body before decoding it", async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture({ signal: controller.signal, chunks: ["private-body"] });
  const result = await settles(jsonBody.readBoundedRequestBytes(f.request, 100, "Too large", 15), f);
  assert.equal(result.error?.status, 400);
  assert.equal(f.cancellations(), 1);
});
test("a cancellation hook that never settles cannot hold a timed-out request open", async () => {
  const f = fixture({ cancelHangs: true });
  const result = await settles(jsonBody.readBoundedRequestBytes(f.request, 100, "Too large", 15), f);
  assert.equal(result.error?.status, 408);
  assert.equal(f.cancellations(), 1);
});
test("a cancellation hook that never settles cannot hold an oversized request open", async () => {
  const f = fixture({ chunks: ["oversized"], cancelHangs: true });
  const result = await settles(jsonBody.readBoundedRequestBytes(f.request, 3, "Too large", 100), f);
  assert.equal(result.error?.status, 413);
  assert.equal(f.cancellations(), 1);
});
test("successful reads preserve exact bytes and release their timeout and abort listener", async () => {
  const controller = new AbortController();
  const f = fixture({ signal: controller.signal, chunks: ["é", "🙂"], close: true });
  const bytes = await jsonBody.readBoundedRequestBytes(f.request, 6, "Too large", 10);
  assert.equal(new TextDecoder().decode(bytes), "é🙂");
  await new Promise(resolve => setTimeout(resolve, 15));
  controller.abort();
  assert.equal(f.cancellations(), 0);
  assert.equal(f.request.body.locked, false);
});
test("body deadlines cannot be disabled with invalid configuration", async () => {
  for (const timeout of [0, -1, Infinity, NaN, 1.5]) {
    const f = fixture({ close: true });
    await assert.rejects(jsonBody.readBoundedRequestBytes(f.request, 100, "Too large", timeout), /deadline is misconfigured/);
  }
});
test("the real JSON and multipart entry points apply their distinct transfer deadlines", async () => {
  const timers = [];
  function load(name, dependencies) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, Request, Uint8Array, TextDecoder, clearTimeout,
      setTimeout(fn, milliseconds) { timers.push(milliseconds); return setTimeout(fn, 10); },
      require(path) { assert.ok(Object.hasOwn(dependencies, path), path); return dependencies[path]; },
    });
    return exports;
  }
  const json = load("bounded-json-body", { "./api-error-policy.ts": { PublicApiError } });
  const form = load("bounded-form-data", { "./api-error-policy.ts": { PublicApiError }, "./bounded-json-body.ts": json });
  for (const [read, budget, headers] of [
    [json.readBoundedJsonObject, 30000, {}],
    [form.readBoundedFormData, 120000, { "content-type": "multipart/form-data; boundary=synthetic" }],
  ]) {
    const f = fixture({ headers });
    const result = await settles(read(f.request, { maxBytes: 100, invalidMessage: "Invalid", tooLargeMessage: "Too large" }), f);
    assert.equal(result.error?.status, 408);
    assert.equal(timers.at(-1), budget);
    assert.equal(f.cancellations(), 1);
  }
});

test("binary multipart bytes survive many small and empty chunks across buffer growth", async () => {
  const expected = Uint8Array.from({ length: 4096 }, (_, i) => i % 256);
  const body = new ReadableStream({ start(controller) {
    for (let i = 0; i < expected.length; i += 16) {
      controller.enqueue(new Uint8Array());
      controller.enqueue(expected.subarray(i, i + 16));
    }
    controller.close();
  } });
  const request = new Request("https://synthetic.invalid/api/body", { method: "POST", body, duplex: "half" });
  const actual = await jsonBody.readBoundedRequestBytes(request, expected.length, "Too large", 1000);
  assert.deepEqual(actual, expected);
});
