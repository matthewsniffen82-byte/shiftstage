import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { checkBrowserBoundaries } from "../scripts/check-browser-boundaries.mjs";

for (const challengeAt of [1, 15, 16, 23]) test(`edge challenge on request ${challengeAt} stops remaining verification`, async context => {
  let calls = 0, cancelled = false;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (calls !== challengeAt) return new Response("<html></html>", { status: 403 });
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from("<html></html>")); controller.close(); },
      cancel() { cancelled = true; },
    }), {
      status: 403, headers: { "x-vercel-mitigated": "challenge" },
    });
  });
  const result = await checkBrowserBoundaries();
  assert.equal(result.ok, false); assert.equal(result.requests, challengeAt);
  assert.equal(calls, challengeAt); assert.equal(cancelled, true);
  assert.equal(result.results.at(-1).error, "EDGE_CHALLENGE");
  assert.equal(result.results.at(-1).checks, undefined, "checkpoint HTML is not an application policy result");
});

test("body cancellation failure still stops at the edge challenge", async context => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(Buffer.from("<html></html>")); controller.close(); },
      cancel() { throw new Error("Synthetic cancellation failure"); },
    }), {
      status: 403, headers: { "x-vercel-mitigated": "challenge" },
    });
  });
  const result = await checkBrowserBoundaries();
  assert.equal(calls, 1); assert.equal(result.ok, false);
  assert.equal(result.results[0].error, "EDGE_CHALLENGE");
});

test("ordinary forbidden responses remain failures without an invented edge diagnosis", async context => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; return new Response("<html></html>", { status: 403 }); });
  const result = await checkBrowserBoundaries();
  assert.equal(calls, 23); assert.equal(result.requests, 23); assert.equal(result.ok, false);
  assert.equal(result.results.some(row => row.error === "EDGE_CHALLENGE"), false);
});

test("ordinary transport failures remain failures without an invented edge diagnosis", async context => {
  let calls = 0;
  context.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("Synthetic network failure"); });
  const result = await checkBrowserBoundaries();
  assert.equal(calls, 23); assert.equal(result.ok, false);
  assert.equal(result.results.some(row => row.error === "EDGE_CHALLENGE"), false);
});

test("valid synthetic document and preflight responses still pass every existing check", async context => {
  let calls = 0, nonceNumber = 0;
  const source = "void 0;", hash = createHash("sha256").update(source).digest("base64");
  context.mock.method(globalThis, "fetch", async (url, options = {}) => {
    calls++;
    assert.equal(new URL(url).origin, "https://www.mydancr.com");
    assert.equal(new Headers(options.headers).has("authorization"), false);
    if (options.method === "OPTIONS") return new Response(null, { status: 204 });
    const target = new URL(url);
    if (target.pathname === "/account" && !target.search) return new Response(null, {
      status: 307, headers: { location: "/?auth=login&role=customer" },
    });
    const hashed = ["/", "/auth/callback"].includes(target.pathname);
    const nonce = hashed ? "" : String(++nonceNumber).padStart(32, "A");
    return new Response(`<html><script${nonce ? ` nonce="${nonce}"` : ""}>${source}</script></html>`, { headers: {
      "content-type": "text/html", "cache-control": "private, no-store", "referrer-policy": "no-referrer",
      "x-frame-options": "DENY", "x-content-type-options": "nosniff", "strict-transport-security": "max-age=31536000",
      "content-security-policy": `script-src '${hashed ? `sha256-${hash}` : `nonce-${nonce}`}'; frame-ancestors 'none'; object-src 'none'; script-src-attr 'none'`,
    } });
  });
  const result = await checkBrowserBoundaries();
  assert.equal(calls, 23); assert.equal(result.requests, 23); assert.equal(result.ok, true);
  assert.equal(result.privateDocuments, 11);
});
