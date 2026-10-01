import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/lib/dancr/internal-media-delivery.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise(setImmediate);
function fixture({ responses = [], fetcher, signer } = {}) {
  let deadline, released = false, cancelled = 0;
  const exports = {}, calls = [], abort = new AbortController();
  vm.runInNewContext(code, {
    exports, Response, Headers, AbortController, ReadableStream, Error,
    setTimeout(callback, ms) { assert.equal(ms, 240_000); deadline = callback; return { unref() {} }; },
    clearTimeout() { released = true; },
  });
  const response = (status = 200, headers = {}, body = "media") => new Response(body === null ? null : new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(body)); },
    cancel() { cancelled++; },
  }), { status, headers: { "content-type": "image/jpeg", ...headers } });
  const get = (options = {}, init = {}) => exports.serveInternalMedia(new Request("https://app.invalid/api/internal/photo/id", {
    signal: abort.signal, ...init,
  }), {
    kind: "image", path: "approved/photo.w320.webp", fallbackPath: "approved/photo.w320.webp",
    sign: signer || (async path => { calls.push({ sign: path }); return "https://storage.invalid/signed"; }),
    fetch: async (url, options) => {
      calls.push({ url, options });
      return fetcher ? fetcher(url, options) : responses.shift() || new Response("image", { headers: { "content-type": "image/webp" } });
    },
    ...options,
  });
  return { get, calls, response, abort, expire: () => deadline(), released: () => released, cancelled: () => cancelled };
}

test("approved bytes stream privately with redirect rejection and complete cleanup", async () => {
  const f = fixture(), r = await f.get();
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "image");
  for (const header of ["cache-control", "cdn-cache-control", "vercel-cdn-cache-control"]) assert.match(r.headers.get(header), /no-store/);
  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("location"), null);
  assert.equal(f.calls[1].options.redirect, "error");
  assert.equal(f.calls[1].options.cache, "no-store");
  assert.equal(f.released(), true);
});

for (const range of ["bytes=-", "bytes=1-2,3-4", "items=0-1", "bytes=oops"]) test(`malformed range ${range} fails before signing`, async () => {
  const f = fixture();
  assert.equal((await f.get({}, { headers: { range } })).status, 416);
  assert.equal(f.calls.length, 0);
});

for (const range of ["bytes=0-9", "bytes=10-", "bytes=-10"]) test(`valid video range ${range} retains its representation`, async () => {
  const f = fixture({ responses: [new Response("0123456789", { status: 206, headers: {
    "content-type": "video/webm", "content-length": "10", "content-range": "bytes 0-9/100", "accept-ranges": "bytes",
  } })] });
  const r = await f.get({ kind: "video" }, { headers: { range } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get("content-type"), "video/webm");
  assert.equal(r.headers.get("content-range"), "bytes 0-9/100");
  assert.equal(f.calls[1].options.headers.range, range);
  assert.equal(await r.text(), "0123456789");
});

for (const [kind, headers] of [
  ["image", { "content-type": "text/html" }],
  ["image", { "content-type": "image/svg+xml" }],
  ["video", { "content-type": "image/jpeg" }],
  ["image", { "content-length": String(10 * 1024 * 1024 + 1) }],
  ["video", { "content-type": "video/mp4", "content-length": String(75 * 1024 * 1024 + 1) }],
  ["image", { "content-length": "-1" }],
]) test(`unsafe ${kind} headers are rejected and their body is cancelled: ${JSON.stringify(headers)}`, async () => {
  const responses = [], f = fixture({ responses });
  responses.push(f.response(200, headers));
  assert.equal((await f.get({ kind })).status, 404);
  assert.equal(f.cancelled(), 1);
  assert.equal(f.released(), true);
});

for (const kind of ["image", "video"]) test(`${kind} decoded bytes are capped even when length is missing or dishonest`, async () => {
  for (const length of [null, "1"]) {
    let cancelled = false, sent = 0;
    const maximum = (kind === "image" ? 10 : 75) * 1024 * 1024;
    const chunk = new Uint8Array(1024 * 1024);
    const upstream = new Response(new ReadableStream({
      pull(controller) { controller.enqueue(chunk); }, cancel() { cancelled = true; },
    }), { headers: { "content-type": kind === "image" ? "image/jpeg" : "video/mp4", ...(length ? { "content-length": length } : {}) } });
    const f = fixture({ responses: [upstream] }), response = await f.get({ kind });
    const reader = response.body.getReader();
    await assert.rejects(async () => { for (;;) { const next = await reader.read(); if (next.done) break; sent += next.value.length; } }, /Media stream unavailable/);
    assert.ok(sent <= maximum);
    assert.equal(cancelled, true);
    assert.equal(f.calls[1].options.signal.aborted, true);
    assert.equal(f.released(), true);
  }
});

test("decoded responses do not forward the compressed content length", async () => {
  const f = fixture({ responses: [new Response("decoded", { headers: { "content-type": "image/jpeg", "content-encoding": "gzip", "content-length": "2" } })] });
  const r = await f.get();
  assert.equal(r.headers.get("content-length"), null);
  assert.equal(r.headers.get("content-encoding"), null);
  assert.equal(await r.text(), "decoded");
});

test("a missing derivative is cancelled before the authorized master is requested", async () => {
  const responses = [], f = fixture({ responses }); responses.push(f.response(404));
  const r = await f.get({ fallbackPath: "approved/photo.webp" });
  assert.equal(await r.text(), "image");
  assert.equal(f.cancelled(), 1);
  assert.deepEqual(f.calls.filter(c => c.sign).map(c => c.sign), ["approved/photo.w320.webp", "approved/photo.webp"]);
});

for (const [status, expected] of [[403, 404], [500, 503], [416, 416], [302, 404]]) test(`upstream ${status} releases its body and returns ${expected}`, async () => {
  const responses = [], f = fixture({ responses }); responses.push(f.response(status));
  assert.equal((await f.get()).status, expected);
  assert.equal(f.cancelled(), 1); assert.equal(f.released(), true);
});

test("HEAD validates media without retaining an upstream body", async () => {
  const responses = [], f = fixture({ responses }); responses.push(f.response());
  const r = await f.get({}, { method: "HEAD" });
  assert.equal(r.status, 200); assert.equal(r.body, null);
  assert.equal(f.calls[1].options.method, "HEAD");
  assert.equal(f.cancelled(), 1); assert.equal(f.released(), true);
});

test("a signing stall expires without starting a late storage request", async () => {
  let finish;
  const f = fixture({ signer: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.get(); await tick(); f.expire();
  assert.equal((await pending).status, 503);
  finish("https://storage.invalid/late"); await tick();
  assert.equal(f.calls.length, 0); assert.equal(f.released(), true);
});

test("a header stall expires and disposes of a transport that ignores cancellation", async () => {
  let finish;
  const f = fixture({ fetcher: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.get(); await tick(); f.expire();
  assert.equal((await pending).status, 503);
  assert.equal(f.calls[1].options.signal.aborted, true);
  finish(f.response()); await tick();
  assert.equal(f.cancelled(), 1);
});

for (const reason of ["deadline", "request", "consumer"]) test(`${reason} cancels a stalled body without waiting on its cancellation hook`, async () => {
  let cancelled = false;
  const upstream = new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } }), { headers: { "content-type": "image/jpeg" } });
  const f = fixture({ responses: [upstream] }), r = await f.get(), reader = r.body.getReader();
  const pending = reader.read();
  if (reason === "consumer") { await reader.cancel(); assert.equal((await pending).done, true); }
  else {
    const rejected = assert.rejects(pending, /Media stream unavailable/);
    if (reason === "deadline") f.expire(); else f.abort.abort();
    await rejected;
  }
  assert.equal(cancelled, true); assert.equal(f.released(), true);
  assert.equal(f.calls[1].options.signal.aborted, true);
});

test("an already cancelled request cannot sign or fetch media", async () => {
  const f = fixture(); f.abort.abort();
  assert.equal((await f.get()).status, 503); assert.equal(f.calls.length, 0);
});
