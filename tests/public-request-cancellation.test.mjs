import assert from "node:assert/strict";
import test from "node:test";
import { publicVideoLoaders } from "./helpers/public-video-loaders.mjs";

test("changing TV scope aborts the old request and only the latest response renders", async () => {
  const { context, requests, renders } = publicVideoLoaders();
  const old = context.loadHomeTvFeed("Vegas", "", "");
  context.homeTvFeedCity = "Miami"; context.citySelect.value = "Miami";
  const current = context.loadHomeTvFeed("Miami", "", "");
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].signal.aborted, false);
  requests[0].resolve([{ id: "stale", videoUrl: "/stale", dancer: { stageName: "Old" } }]);
  requests[1].resolve([{ id: "current", videoUrl: "/current", dancer: { stageName: "New" } }]);
  await Promise.all([old, current]);
  assert.equal(requests.length, 2, "cancellation must not retry the stale scope");
  assert.equal(context.homeTvFeedVideos[0].id, "current");
  assert.deepEqual(renders, ["Miami"]);
  assert.equal(context.homeTvFeedAbort, null);
});

test("leaving pending TV cancels it and allows a fresh load on return", async () => {
  const { context, requests, renders } = publicVideoLoaders();
  const pending = context.loadHomeTvFeed("Vegas", "", "");
  context.activeTab = "dancers";
  context.deactivateHomeTvFeed();
  await pending;
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(context.homeTvFeedCity, "");
  assert.equal(context.homeTvFeedStatus, "idle");
  assert.equal(renders.length, 0);
  context.activeTab = "tv"; context.homeTvFeedCity = "Vegas";
  const resumed = context.loadHomeTvFeed("Vegas", "", "");
  requests[1].resolve([]); await resumed;
  assert.equal(context.homeTvFeedStatus, "ready");
  context.deactivateHomeTvFeed();
  assert.equal(context.homeTvFeedCity, "Vegas", "completed scoped data keeps the existing return behavior");
  assert.equal(context.homeTvFeedStatus, "ready");
});

test("pre-aborted public reads never send a request", async () => {
  const { context, requests } = publicVideoLoaders();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(context.fetchJson("/api/public/tv", { signal: controller.signal, retries: 2 }), { name: "AbortError" });
  assert.equal(requests.length, 0);
});

test("reselecting TV preserves its in-flight request", async () => {
  const { context, requests } = publicVideoLoaders();
  const pending = context.loadHomeTvFeed("Vegas", "", "");
  context.deactivateHomeTvFeed(false);
  assert.equal(requests[0].signal.aborted, false);
  assert.equal(context.homeTvFeedCity, "Vegas");
  requests[0].resolve([]); await pending;
  assert.equal(context.homeTvFeedStatus, "ready");
  assert.equal(requests.length, 1);
});

test("cancellation interrupts a stalled response body and releases listeners and timers", async () => {
  const { context } = publicVideoLoaders();
  const controller = new AbortController();
  let listeners = 0, calls = 0;
  const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { listeners++; return add(...args); };
  controller.signal.removeEventListener = (...args) => { listeners--; return remove(...args); };
  const timers = new Set();
  context.window.setTimeout = (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; };
  context.window.clearTimeout = timer => { timers.delete(timer); clearTimeout(timer); };
  context.fetch = async () => { calls++; return { ok: true, json: () => new Promise(() => {}) }; };
  const pending = context.fetchJson("/api/public/tv", { signal: controller.signal, retries: 2 });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1); assert.equal(listeners, 0); assert.equal(timers.size, 0);
});

test("cancellation during retry backoff avoids another request", async () => {
  const { context } = publicVideoLoaders();
  const controller = new AbortController(); let calls = 0;
  context.fetch = async () => { calls++; return { ok: false, status: 503 }; };
  const pending = context.fetchJson("/api/public/tv", { signal: controller.signal, retries: 2 });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
});
