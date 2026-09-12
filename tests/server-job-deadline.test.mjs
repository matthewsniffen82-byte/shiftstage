import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import vm from "node:vm";
import ts from "typescript";
import * as jobs from "../src/lib/server-job.ts";
import { createBoundedSupabaseFetch } from "../src/lib/supabase/bounded-fetch.ts";
import { createClient } from "@supabase/supabase-js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test("job expiry cancels the transport and cannot spill into an independent job", async () => {
  let stopped = false;
  const waitingFetch = jobs.withServerJobFetch((_input, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => { stopped = true; reject(signal.reason); }, { once: true });
  }));
  const expired = assert.rejects(jobs.runWithServerJob(() => waitingFetch("https://synthetic.invalid"), 20), jobs.ServerJobTimeoutError);
  const independent = jobs.runWithServerJob(async () => {
    await delay(40);
    jobs.assertServerJobActive();
    return "healthy";
  }, 500);
  await expired;
  assert.equal(stopped, true);
  assert.equal(await independent, "healthy");
  assert.equal(jobs.serverJobSignal(), undefined);
});

test("a nested job cannot renew its parent's time limit", async () => {
  await assert.rejects(jobs.runWithServerJob(async () => {
    await delay(5);
    return jobs.runWithServerJob(() => new Promise(() => {}), 1000);
  }, 20), jobs.ServerJobTimeoutError);
});

test("late uncancellable work cannot start a publication request", async () => {
  const release = deferred();
  const finished = deferred();
  let writes = 0;
  const publish = jobs.withServerJobFetch(async () => { writes++; return Response.json({ ok: true }); });
  await assert.rejects(jobs.runWithServerJob(async () => {
    await release.promise;
    try { await publish("https://synthetic.invalid/rest/v1/publication", { method: "POST" }); }
    finally { finished.resolve(); }
  }, 15), jobs.ServerJobTimeoutError);
  release.resolve();
  await finished.promise;
  assert.equal(writes, 0);
});

test("a late response is discarded and its body released", async () => {
  const release = deferred();
  let cancelled = false;
  const fetcher = jobs.withServerJobFetch(async () => {
    await release.promise;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  await assert.rejects(jobs.runWithServerJob(() => fetcher("https://synthetic.invalid"), 15), jobs.ServerJobTimeoutError);
  release.resolve();
  for (let step = 0; step < 20 && !cancelled; step++) await delay(1);
  assert.equal(cancelled, true);
});

test("completed jobs also fence detached continuations", async () => {
  const release = deferred();
  let continuation;
  let requests = 0;
  const fetcher = jobs.withServerJobFetch(async () => { requests++; return Response.json({}); });
  assert.equal(await jobs.runWithServerJob(async () => {
    continuation = release.promise.then(() => fetcher("https://synthetic.invalid"));
    return "done";
  }), "done");
  const rejected = assert.rejects(continuation, /job has ended/);
  release.resolve();
  await rejected;
  assert.equal(requests, 0);
});

test("outside a job, request options and response semantics are preserved", async () => {
  const options = { method: "GET", headers: { "x-synthetic": "test" } };
  const response = Response.json({ ok: true });
  const fetcher = jobs.withServerJobFetch(async (input, init) => {
    assert.equal(input, "https://synthetic.invalid");
    assert.equal(init, options);
    return response;
  });
  assert.equal(await fetcher("https://synthetic.invalid", options), response);
});

test("the installed Storage SDK cancels a stalled body without issuing later writes", async () => {
  let reads = 0;
  let bodyCancelled = false;
  const transport = createBoundedSupabaseFetch(async () => {
    reads++;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2])); },
      cancel() { bodyCancelled = true; },
    }));
  }, 1000);
  const client = createClient("https://synthetic.supabase.co", "synthetic-anon", {
    global: { fetch: jobs.withServerJobFetch(transport) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await assert.rejects(jobs.runWithServerJob(async () => {
    const result = await client.storage.from("private").download("synthetic.png");
    jobs.assertServerJobActive();
    assert.fail("A cancelled Storage read cannot be accepted: " + Boolean(result.data));
  }, 20), jobs.ServerJobTimeoutError);
  for (let step = 0; step < 20 && !bodyCancelled; step++) await delay(1);
  assert.equal(reads, 1);
  assert.equal(bodyCancelled, true);
});

const processSource = ts.transpileModule(readFileSync(new URL("../src/lib/dancr/media-process.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function processRunner(spawnProcess, clock = { setTimeout, clearTimeout }) {
  const exports = {};
  vm.runInNewContext(processSource, { exports, Error, Promise, ...clock, require(name) {
    if (name === "node:child_process") return { spawn: spawnProcess };
    if (name === "../server-job.ts") return jobs;
    throw new Error(name);
  } });
  return exports.runMediaProcess;
}
const processOptions = { timeoutMs: 1000, timeoutMessage: "Synthetic encoder timed out", failureMessage: "Synthetic encoder failed" };

test("encoder cancellation waits for close before workspace cleanup can run", async () => {
  const child = new EventEmitter();
  child.pid = 123;
  child.stderr = new EventEmitter();
  const kills = [];
  child.kill = signal => { kills.push(signal); return true; };
  let fire;
  const run = processRunner(() => child, { setTimeout(callback) { fire = callback; return 1; }, clearTimeout() {} });
  let settled = false;
  const result = run("synthetic", [], { ...processOptions, allowNoOutput: true });
  const rejected = assert.rejects(result, /timed out/).then(() => { settled = true; });
  fire();
  await Promise.resolve();
  assert.deepEqual(kills, ["SIGKILL"]);
  assert.equal(settled, false);
  child.emit("close", 0);
  await rejected;
  assert.equal(settled, true);
});

test("job expiry terminates a real child process", async () => {
  let child;
  let closed;
  const run = processRunner((...args) => {
    child = spawn(...args);
    closed = new Promise(resolve => child.once("close", resolve));
    return child;
  });
  await assert.rejects(jobs.runWithServerJob(() => run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], processOptions), 100), jobs.ServerJobTimeoutError);
  await closed;
  assert.ok(child.exitCode !== null || child.signalCode !== null);
});
