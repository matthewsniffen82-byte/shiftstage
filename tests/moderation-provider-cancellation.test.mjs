import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import OpenAI from "openai";
import { PassThrough } from "node:stream";

const root = new URL("../", import.meta.url);
const source = path => readFileSync(new URL(path, root), "utf8");
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const turn = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let step = 0; step < 100; step++) {
    if (predicate()) return;
    await turn();
  }
  assert.ok(predicate(), "Synthetic operation did not reach the expected boundary.");
}

function clock() {
  const pending = new Map();
  let next = 0;
  return {
    pending,
    setTimeout(fn, ms) { const id = ++next; pending.set(id, { fn, ms }); return id; },
    clearTimeout(id) { pending.delete(id); },
    fire() {
      const item = [...pending].sort((a, b) => a[1].ms - b[1].ms)[0];
      assert.ok(item, "Expected an application timer.");
      pending.delete(item[0]);
      item[1].fn();
      return item[1].ms;
    },
  };
}

function compile(text, globals) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Buffer, Error, Promise, AbortController, console: quiet, ...globals });
  return exports;
}

function load(file, functions, timer, client, audioStream = { destroy() {} }) {
  const text = source(file);
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node)
    && [...functions, "withTimeout"].includes(node.name?.text)).map(node => node.getText(ast));
  const helperPath = new URL("src/lib/openai-request.ts", root);
  const helper = existsSync(helperPath)
    ? compile(readFileSync(helperPath, "utf8"), timer).withOpenAIRequestDeadline : undefined;
  const math = Object.create(Math);
  math.random = () => 0;
  return compile(selected.join("\n") + "\nexport { " + functions.join(", ") + " };", {
    ...timer, Math: math, withTimeout: helper, safeErrorMetadata: () => ({}),
    DANCR_IMAGE_MODERATION_MODEL: "omni-moderation-latest",
    VIDEO_TRANSCRIPTION_MODEL: "whisper-1", VIDEO_POLICY_MODEL: "gpt-4.1-mini",
    VIDEO_POLICY_REASON_CODES: ["safe_adult_promotional_content"],
    DANCR_MEDIA_IDENTITY_MODEL: "gpt-4o-mini", MEDIA_IDENTITY_TIMEOUT_MS: 30_000,
    OPENAI_TIMEOUT_MS: 30_000, FRAME_MODERATION_TIMEOUT_MS: 12_000,
    FRAME_MODERATION_RETRY_DELAYS_MS: [350], openAITextDiagnosticPromise: null,
    createReadStream: () => audioStream, createOpenAIClient: async () => client,
    getServerEnv: () => "synthetic-only", openAIRequestFailureDetails: () => ({}),
    parseDancerMediaIdentityAnalysis: value => value,
  });
}

const videoFunctions = ["moderateFrame", "withVideoProviderRetry", "isRetryableVideoProviderError",
  "providerErrorStatus", "providerErrorCode", "delay", "transcribeAudio", "moderateText", "classifyVideoPolicy"];
const cases = [
  ["video frame", "video-moderation.ts", videoFunctions, 2, (f, c) => f.moderateFrame(c, Buffer.from("fixture"), 0)],
  ["video transcript", "video-moderation.ts", videoFunctions, 1, (f, c) => f.transcribeAudio(c, "synthetic")],
  ["video text", "video-moderation.ts", videoFunctions, 1, (f, c) => f.moderateText(c, "fixture")],
  ["video policy", "video-moderation.ts", videoFunctions, 1, (f, c) => f.classifyVideoPolicy(c, [], "fixture", "")],
  ["image moderation", "image-moderation.ts", ["createModeration", "withRetry"], 3, (f, c) => f.createModeration(c, [])],
  ["image diagnostic", "image-moderation.ts", ["runOpenAITextDiagnostic"], 1, (f, c) => f.runOpenAITextDiagnostic(c)],
  ["media identity", "media-identity.ts", ["analyzeDancerMediaIdentity"], 1,
    f => f.analyzeDancerMediaIdentity({ targetImages: [Buffer.from("fixture")], mediaType: "photo" })],
];

for (const [name, file, functions, expectedCalls, invoke] of cases) {
  test(`${name} aborts each expired request before an application retry`, async () => {
    const timer = clock(), requests = [], finish = [];
    let active = 0, peak = 0, aborted = 0, settled = false;
    const create = (_input, options) => new Promise((resolve, reject) => {
      active++; peak = Math.max(active, peak); requests.push(options);
      let done = false;
      const end = abort => {
        if (done) return;
        done = true; active--; options?.signal?.removeEventListener("abort", cancel);
        if (abort) { aborted++; reject(new Error("synthetic abort")); }
        else resolve({ results: [{ flagged: false }] });
      };
      const cancel = () => end(true);
      options?.signal?.addEventListener("abort", cancel, { once: true });
      finish.push(() => end(false));
    });
    const client = { moderations: { create }, audio: { transcriptions: { create } },
      chat: { completions: { create } }, responses: { create } };
    const functionsUnderTest = load("src/lib/dancr/" + file, functions, timer, client);
    const promise = invoke(functionsUnderTest, client).then(
      value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    try {
      for (let step = 0; step < 12 && !settled; step++) {
        await until(() => settled || timer.pending.size > 0);
        await turn();
        if (!settled) { timer.fire(); await turn(); }
      }
      assert.equal(settled, true);
      assert.match((await promise).error?.message || "", /timed out|provider_timeout/);
      assert.equal(requests.length, expectedCalls);
      assert.equal(active, 0, "Expired requests must not remain in flight.");
      assert.equal(peak, 1, "A retry must not overlap an expired request.");
      assert.equal(aborted, expectedCalls);
      assert.ok(requests.every(options => options?.maxRetries === 0));
      assert.equal(timer.pending.size, 0);
    } finally {
      finish.forEach(fn => fn());
      await turn();
    }
  });
}

for (const bodyStarted of [false, true]) {
  test(`installed SDK aborts a stalled ${bodyStarted ? "response body" : "connection"}`, async () => {
    const timer = clock();
    let active = 0, aborted = 0, body, finish, requestSignal;
    const client = new OpenAI({ apiKey: "synthetic-only", baseURL: "https://synthetic.invalid/v1",
      fetch: async (url, init) => {
        assert.equal(new URL(url).origin, "https://synthetic.invalid");
        active++; requestSignal = init.signal;
        let done = false;
        if (bodyStarted) {
          const stream = new ReadableStream({ start(controller) { body = controller; } });
          finish = abort => {
            if (done) return;
            done = true; active--; init.signal.removeEventListener("abort", cancel);
            if (abort) { aborted++; body.error(new DOMException("Synthetic abort", "AbortError")); }
            else { body.enqueue(new TextEncoder().encode('{"results":[{"flagged":false}]}')); body.close(); }
          };
          const cancel = () => finish(true);
          init.signal.addEventListener("abort", cancel, { once: true });
          return new Response(stream, { headers: { "content-type": "application/json" } });
        }
        return new Promise((resolve, reject) => {
          finish = abort => {
            if (done) return;
            done = true; active--; init.signal.removeEventListener("abort", cancel);
            if (abort) { aborted++; reject(new DOMException("Synthetic abort", "AbortError")); }
            else resolve(Response.json({ results: [{ flagged: false }] }));
          };
          const cancel = () => finish(true);
          init.signal.addEventListener("abort", cancel, { once: true });
        });
      },
    });
    const functions = load("src/lib/dancr/video-moderation.ts", videoFunctions, timer, client);
    const outcome = functions.moderateText(client, "synthetic text").then(value => ({ value }), error => ({ error }));
    try {
      await until(() => active === 1);
      await turn();
      assert.equal(timer.fire(), 30_000);
      assert.match((await outcome).error?.message || "", /timed out/);
      await turn();
      assert.equal(requestSignal.aborted, true);
      assert.equal(active, 0);
      assert.equal(aborted, 1);
    } finally { finish?.(false); await turn(); }
  });
}

test("a successful SDK response leaves no application timer or aborted signal", async () => {
  const timer = clock();
  let requestSignal;
  const client = new OpenAI({ apiKey: "synthetic-only", baseURL: "https://synthetic.invalid/v1",
    fetch: async (_url, init) => {
      requestSignal = init.signal;
      return Response.json({ results: [{ flagged: false, categories: {} }] });
    },
  });
  const functions = load("src/lib/dancr/video-moderation.ts", videoFunctions, timer, client);
  const result = await functions.moderateText(client, "synthetic text");
  await turn();
  assert.equal(result.flagged, false);
  assert.equal(requestSignal.aborted, false);
  assert.equal(timer.pending.size, 0);
});

test("an SDK server failure is returned once when the application has no retry", async () => {
  const timer = clock();
  let calls = 0;
  const client = new OpenAI({ apiKey: "synthetic-only", baseURL: "https://synthetic.invalid/v1",
    fetch: async () => {
      calls++;
      return Response.json({ error: { message: "Synthetic unavailable", type: "synthetic" } }, { status: 503 });
    },
  });
  const functions = load("src/lib/dancr/video-moderation.ts", videoFunctions, timer, client);
  await assert.rejects(functions.moderateText(client, "synthetic text"), error => error.status === 503);
  await turn();
  assert.equal(calls, 1);
  assert.equal(timer.pending.size, 0);
});

test("a frame rate limit uses only its existing application retry", async () => {
  const timer = clock();
  let calls = 0;
  const client = new OpenAI({ apiKey: "synthetic-only", baseURL: "https://synthetic.invalid/v1",
    fetch: async () => {
      calls++;
      return calls === 1
        ? Response.json({ error: { message: "Synthetic rate limit", type: "synthetic" } }, { status: 429 })
        : Response.json({ results: [{ flagged: false }] });
    },
  });
  const functions = load("src/lib/dancr/video-moderation.ts", videoFunctions, timer, client);
  const pending = functions.moderateFrame(client, Buffer.from("fixture"), 0);
  await until(() => [...timer.pending.values()].some(item => item.ms === 350));
  assert.equal(calls, 1);
  assert.equal(timer.fire(), 350);
  assert.equal((await pending).flagged, false);
  await turn();
  assert.equal(calls, 2);
  assert.equal(timer.pending.size, 0);
});

test("a timed-out transcription closes its input while SDK multipart preparation is waiting", async () => {
  const timer = clock(), audio = new PassThrough();
  let requests = 0;
  const syntheticFetch = async (url) => {
    assert.equal(new URL(url).origin, "https://synthetic.invalid");
    requests++;
    return Response.json({ text: "Synthetic transcript" });
  };
  // Supply the native Response constructor for the SDK's local FormData check.
  syntheticFetch.Response = Response;
  const client = new OpenAI({ apiKey: "synthetic-only", baseURL: "https://synthetic.invalid/v1", fetch: syntheticFetch });
  const functions = load("src/lib/dancr/video-moderation.ts", videoFunctions, timer, client, audio);
  const outcome = functions.transcribeAudio(client, "synthetic.mp3").then(value => ({value}), error => ({error}));
  try {
    await until(() => audio.listenerCount("readable") > 0);
    assert.equal(requests, 0);
    assert.equal(timer.fire(), 30_000);
    assert.match((await outcome).error?.message || "", /timed out/);
    assert.equal(audio.destroyed, true, "An expired upload must close its unfinished input stream.");
    await turn();
    assert.equal(requests, 0);
  } finally { audio.destroy(); await turn(); }
});
