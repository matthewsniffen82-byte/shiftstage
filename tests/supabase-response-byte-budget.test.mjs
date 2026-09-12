import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createBoundedSupabaseFetch } from "../src/lib/supabase/bounded-fetch.ts";

const url = "https://synthetic.invalid/rest/v1/rpc/synthetic_write";
const encoder = new TextEncoder();
function streamResponse(chunks, headers = {}, { close = true, status = 200 } = {}) {
  let cancelled = 0;
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
    cancel() { cancelled++; },
  });
  return { response: new Response(stream, { status, headers }), cancellations: () => cancelled };
}
async function unavailable(response) {
  assert.equal(response.status, 408);
  const result = await response.json();
  assert.equal(result.code, "SUPABASE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(result), /private-body|provider-secret|TOO_LARGE/);
}

for (const headers of [{}, { "content-length": "2" }, { "content-length": "999", "content-encoding": "gzip" }]) {
  test(`actual response bytes are counted despite headers ${JSON.stringify(headers)}`, async () => {
    let calls = 0, signal;
    const fixture = streamResponse(["1234", "5678", "9-private-body"], headers, { close: false });
    const fetcher = createBoundedSupabaseFetch(async (_input, init) => { calls++; signal = init.signal; return fixture.response; }, 500, 8);
    await unavailable(await fetcher(url, { method: "POST" }));
    assert.equal(calls, 1);
    assert.equal(signal.aborted, true);
    assert.equal(fixture.cancellations(), 1);
  });
}

test("an excessive uncompressed length is rejected and cancelled before reading a body", async () => {
  const fixture = streamResponse([], { "content-length": "9" }, { close: false });
  await unavailable(await createBoundedSupabaseFetch(async () => fixture.response, 500, 8)(url));
  assert.equal(fixture.cancellations(), 1);
});

test("exact-limit bytes, status and response headers survive chunk boundaries", async () => {
  const fixture = streamResponse(["1", "2", "", "3", "4", "5", "6", "7", "8"], {
    "content-type": "application/octet-stream", "content-range": "0-7/8",
  }, { status: 201 });
  const response = await createBoundedSupabaseFetch(async () => fixture.response, 500, 8)(url);
  assert.equal(response.status, 201);
  assert.equal(await response.text(), "12345678");
  assert.equal(response.headers.get("content-range"), "0-7/8");
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(fixture.cancellations(), 0);
});

test("compressed response metadata cannot cause double decoding", async () => {
  const fixture = streamResponse(["decoded"], { "content-encoding": "gzip", "content-length": "999" });
  const response = await createBoundedSupabaseFetch(async () => fixture.response, 500, 8)(url);
  assert.equal(await response.text(), "decoded");
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-length"), null);
});

test("Storage retains headroom above accepted TV size while JSON uses the smaller ceiling", async () => {
  // Declared size exercises the default policy without allocating a large object.
  const objectHeaders = { "content-length": String(75 * 1024 * 1024) };
  const fetcher = createBoundedSupabaseFetch(async () => new Response("object", { headers: objectHeaders }), 500);
  await unavailable(await fetcher(url));
  const storage = await fetcher("https://synthetic.invalid/storage/v1/object/authenticated/mydancr-tv-videos/synthetic");
  assert.equal(await storage.text(), "object");
  const excessive = createBoundedSupabaseFetch(async () => new Response("private-body", {
    headers: { "content-length": String(97 * 1024 * 1024) },
  }), 500);
  await unavailable(await excessive("https://synthetic.invalid/storage/v1/object/synthetic"));
});

test("a caller abort cancels a stalled body and returns uncertainty", { timeout: 1500 }, async () => {
  const controller = new AbortController();
  const fixture = streamResponse(["{"], {}, { close: false });
  const pending = createBoundedSupabaseFetch(async () => fixture.response, 1000, 8)(url, { method: "POST", signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await unavailable(await pending);
  assert.equal(fixture.cancellations(), 1);
});

test("the body deadline cancels its reader as well as the request", { timeout: 1500 }, async () => {
  const fixture = streamResponse(["{"], {}, { close: false });
  await unavailable(await createBoundedSupabaseFetch(async () => fixture.response, 15, 8)(url));
  assert.equal(fixture.cancellations(), 1);
});

test("an oversized Auth response cannot activate the installed SDK refresh retry loop", async () => {
  let calls = 0;
  const client = createClient("https://synthetic.invalid", "sb_publishable_synthetic_response_only", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createBoundedSupabaseFetch(async () => { calls++; return Response.json({ error: "provider-secret".repeat(10) }, { status: 400 }); }, 500, 8) },
  });
  const result = await client.auth.refreshSession({ refresh_token: "synthetic-only" });
  assert.equal(result.error.status, 408);
  assert.equal(calls, 1);
});

test("empty successful responses keep their original no-body status", async () => {
  const response = await createBoundedSupabaseFetch(async () => new Response(null, { status: 204 }), 500, 8)(url);
  assert.equal(response.status, 204);
  assert.equal(response.body, null);
});

test("invalid explicit byte budgets cannot silently disable the ceiling", () => {
  for (const limit of [0, -1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createBoundedSupabaseFetch(async () => Response.json({}), 500, limit), RangeError);
  }
});

test("the installed database SDK reports an oversized write result without replaying the write", async () => {
  let calls = 0;
  const client = createClient("https://synthetic.invalid", "sb_publishable_synthetic_response_only", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createBoundedSupabaseFetch(async (input, init) => {
      calls++;
      assert.match(String(input), /\/rest\/v1\/rpc\/synthetic_write$/);
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { operation: "synthetic-only" });
      return Response.json({ private: "private-body".repeat(100) });
    }, 500, 32) },
  });
  const result = await client.rpc("synthetic_write", { operation: "synthetic-only" });
  assert.equal(result.status, 408);
  assert.equal(result.error.code, "SUPABASE_UNAVAILABLE");
  assert.equal(result.data, null);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result.error), /private-body/);
});

test("the installed database SDK retains HEAD counts without buffering an advertised representation", async () => {
  let calls = 0;
  const client = createClient("https://synthetic.invalid", "sb_publishable_synthetic_response_only", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: createBoundedSupabaseFetch(async (_input, init) => {
      calls++;
      assert.equal(init.method, "HEAD");
      return new Response(null, { status: 200, headers: {
        "content-range": "*/1234", "content-length": "999999999", "content-type": "application/json",
      } });
    }, 500, 8) },
  });
  const result = await client.from("synthetic_rows").select("id", { head: true, count: "exact" });
  assert.equal(result.error, null);
  assert.equal(result.count, 1234);
  assert.equal(result.data, null);
  assert.equal(calls, 1);
});

test("byte ceilings count UTF-8 bytes and retain a split multibyte character exactly at the limit", async () => {
  const bytes = encoder.encode("é🙂");
  const fetcher = async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
  const result = await createBoundedSupabaseFetch(fetcher, 500, bytes.length)(url);
  assert.equal(await result.text(), "é🙂");
  await unavailable(await createBoundedSupabaseFetch(fetcher, 500, bytes.length - 1)(url));
});

test("caller cancellation settles before a non-cooperative transport returns headers and disposes its late body", { timeout: 2000 }, async () => {
  const controller = new AbortController();
  let release, calls = 0, signal;
  const fixture = streamResponse(["private-body"], {}, { close: false });
  const fetcher = async (_input, init) => {
    calls++; signal = init.signal;
    return new Promise(resolve => { release = () => resolve(fixture.response); });
  };
  const pending = createBoundedSupabaseFetch(fetcher, 1500, 8)(url, { method: "POST", signal: controller.signal });
  const timedOut = Symbol("did not cancel");
  let failureTimer;
  try {
    controller.abort();
    const result = await Promise.race([pending, new Promise(resolve => { failureTimer = setTimeout(() => resolve(timedOut), 100); })]);
    assert.notEqual(result, timedOut);
    await unavailable(result);
    assert.equal(signal.aborted, true);
    assert.equal(calls, 1);
  } finally {
    clearTimeout(failureTimer);
    release();
    await pending;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.equal(fixture.cancellations(), 1);
});
