import assert from "node:assert/strict";
import test from "node:test";
import { DASHBOARD_SESSION_KEY, requestDashboardJson, requestOptionalDashboardJson } from "../app/dashboard/dashboard-session.ts";

function sessionFixture(t) {
  const stored = new Map([[DASHBOARD_SESSION_KEY, JSON.stringify({ accessToken: "test-access", account: { role: "customer" } })]]);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ ok: true })));
  const previousWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  } };
  t.after(() => { globalThis.window = previousWindow; });
  return stored;
}

test("a stalled saved-activity request ends with a retryable timeout and aborts the network", async (t) => {
  sessionFixture(t);
  let signal;
  globalThis.fetch = async (_path, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  await assert.rejects(requestDashboardJson("/api/customer/saved", { timeoutMs: 10 }),
    (error) => error.status === 408 && /try again/i.test(error.message));
  assert.equal(signal.aborted, true);
});

test("stalled optional panels fall back instead of blocking the dashboard", async (t) => {
  sessionFixture(t);
  t.mock.method(console, "warn", () => {});
  globalThis.fetch = async () => new Promise(() => {});
  assert.deepEqual(await requestOptionalDashboardJson("/api/support", { threads: [] }, { timeoutMs: 10 }), { threads: [] });
});

test("the deadline includes a stalled response body and ignores a late refreshed session", async (t) => {
  const stored = sessionFixture(t);
  let finishBody;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: () => new Promise((resolve) => { finishBody = resolve; }) });
  await assert.rejects(requestDashboardJson("/api/account", { timeoutMs: 10 }), { status: 408 });
  finishBody({ ok: true, session: { accessToken: "late-token" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)).accessToken, "test-access");
});

test("a retry succeeds and persists refreshed credentials", async (t) => {
  const stored = sessionFixture(t);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, saved: { follows: [] }, session: { accessToken: "fresh-token" } }));
  const result = await requestDashboardJson("/api/customer/saved", { timeoutMs: 100 });
  assert.deepEqual(result.saved, { follows: [] });
  assert.equal(JSON.parse(stored.get(DASHBOARD_SESSION_KEY)).accessToken, "fresh-token");
});

test("unmount cancellation still propagates through optional timed requests", async (t) => {
  sessionFixture(t);
  const controller = new AbortController();
  globalThis.fetch = async (_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const pending = requestOptionalDashboardJson("/api/support", {}, { timeoutMs: 100, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
