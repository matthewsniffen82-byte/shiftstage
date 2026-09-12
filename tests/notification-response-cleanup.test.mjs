import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/dancr/notification-delivery.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const turn = () => new Promise(resolve => setImmediate(resolve));
const input = { to: "synthetic@example.invalid", subject: "Synthetic subject", text: "Synthetic private message" };
const row = { recipient_id: "synthetic-user", notification_type: "approval_status", title: input.subject, body: input.text };
const recipient = { id: row.recipient_id, email: input.to, role: "dancer" };

function load(respond, { configured = true, signal = new AbortController().signal } = {}) {
  const calls = [], logs = [], budgets = [], exports = {};
  vm.runInNewContext(compiled, {
    exports, URLSearchParams, Map, Set, TextDecoder, Uint8Array,
    process: { env: configured ? { RESEND_API_KEY: "synthetic-email-key", EMAIL_FROM: input.to,
      ONESIGNAL_REST_API_KEY: "synthetic-push-key", NEXT_PUBLIC_ONESIGNAL_APP_ID: "synthetic-app" } : {} },
    console: { warn: (...args) => logs.push(args) },
    AbortSignal: { timeout: ms => { budgets.push(ms); return signal; } },
    fetch: async (url, init) => {
      assert.ok(["https://api.resend.com/emails", "https://onesignal.com/api/v1/notifications"].includes(url));
      assert.equal(init.method, "POST"); assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
      calls.push({ url, init });
      return respond(url, init);
    },
    require: name => name === "./public-app-url" ? { publicAppUrl: () => "https://synthetic.invalid" }
      : name === "./customer-notification-preferences" ? { followAlertKey: () => null } : {},
  });
  const client = { from(table) {
    assert.equal(table, "app_users");
    return { select() { return this; }, in() { return this; }, eq() { return Promise.resolve({ data: [recipient], error: null }); } };
  } };
  return { ...exports, calls, logs, budgets, client };
}
function responseFixture(status, cancel = () => {}, text) {
  let cancellations = 0;
  const stream = new ReadableStream({
    start(controller) { if (text !== undefined) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } },
    cancel() { cancellations++; return cancel(); },
  });
  const response = new Response(stream, { status });
  return { response, get cancellations() { return cancellations; }, cleanup: () => response.body.cancel().catch(() => {}) };
}

for (const [status, delivered, reason] of [[202, true, undefined], [429, false, "provider_rejected"]]) {
  test(`transactional HTTP ${status} cancels the unused body and preserves its result`, async () => {
    const body = responseFixture(status), service = load(() => body.response);
    try {
      const result = await service.sendTransactionalEmail(input);
      assert.equal(result.delivered, delivered); assert.equal(result.reason, reason);
      assert.equal(body.cancellations, 1);
      assert.equal(service.calls.length, 1); assert.deepEqual(service.budgets, [10_000]);
      assert.doesNotMatch(JSON.stringify(service.logs), /Synthetic private message|synthetic-email-key/);
    } finally { await body.cleanup(); }
  });
}

test("a body cancellation rejection cannot turn acknowledged HTTP acceptance into failure", async () => {
  const body = responseFixture(202, () => Promise.reject(new Error("Synthetic private cleanup failure")));
  const service = load(() => body.response);
  try {
    assert.equal((await service.sendTransactionalEmail(input)).delivered, true);
    await turn();
    assert.equal(body.cancellations, 1); assert.equal(service.calls.length, 1);
    assert.deepEqual(service.logs, []);
  } finally { await body.cleanup(); }
});

test("stalled body cancellation does not stall or replay an acknowledged notification", async () => {
  let release;
  const body = responseFixture(202, () => new Promise(resolve => { release = resolve; }));
  const service = load(() => body.response);
  let settled = false;
  const pending = service.sendTransactionalEmail(input).then(value => { settled = true; return value; });
  try {
    await turn();
    assert.equal(settled, true); assert.equal(body.cancellations, 1);
    assert.equal((await pending).delivered, true); assert.equal(service.calls.length, 1);
  } finally {
    const cleanup = body.cleanup(); release?.(); await cleanup; await pending;
  }
});

test("a synchronous cleanup failure preserves the already received HTTP status", async () => {
  let cancellations = 0;
  const service = load(() => ({ ok: true, status: 202, body: { cancel() {
    cancellations++; throw new Error("Synthetic private cleanup failure");
  } } }));
  assert.equal((await service.sendTransactionalEmail(input)).delivered, true);
  assert.equal(cancellations, 1); assert.equal(service.calls.length, 1); assert.deepEqual(service.logs, []);
});

test("a bodyless response retains HTTP acceptance", async () => {
  const service = load(() => new Response(null, { status: 204 }));
  assert.equal((await service.sendTransactionalEmail(input)).delivered, true);
  assert.equal(service.calls.length, 1);
});

for (const pushStatus of [202, 400]) {
  test(`push HTTP ${pushStatus} and email consume or discard their response while preserving confirmed channel counts`, async () => {
    const bodies = [];
    const service = load(url => {
      const isPush = url.includes("onesignal");
      const body = responseFixture(isPush ? pushStatus : 202, () => {}, isPush && pushStatus === 202
        ? JSON.stringify({ id: "aabbccdd-1111-4111-8111-aabbccddeeff" }) : undefined);
      bodies.push(body); return body.response;
    });
    try {
      const result = await service.deliverNotificationRows(service.client, [row]);
      assert.equal(result.push, pushStatus === 202 ? 1 : 0); assert.equal(result.email, 1);
      assert.equal(service.calls.length, 2); assert.equal(bodies.length, 2);
      for (const [index, body] of bodies.entries()) assert.equal(body.cancellations, index === 0 && pushStatus === 202 ? 0 : 1);
      assert.equal(bodies[0].response.bodyUsed, true);
      assert.doesNotMatch(JSON.stringify(service.logs), /Synthetic private message|synthetic-email-key|synthetic-push-key/);
    } finally { await Promise.all(bodies.map(body => body.cleanup())); }
  });
}

test("transport uncertainty stays unavailable with no extra request", async () => {
  const service = load(() => { throw new Error("Synthetic private transport failure"); });
  const result = await service.sendTransactionalEmail(input);
  assert.equal(result.delivered, false); assert.equal(result.reason, "provider_unavailable");
  assert.equal(service.calls.length, 1);
  assert.doesNotMatch(JSON.stringify(service.logs), /Synthetic private transport failure/);
});

test("missing configuration sends nothing", async () => {
  const service = load(() => assert.fail("No provider request expected"), { configured: false });
  const result = await service.sendTransactionalEmail(input);
  assert.equal(result.delivered, false); assert.equal(result.reason, "email_not_configured");
  assert.equal(service.calls.length, 0);
});

// Appended to the refreshed cleanup suite; native streams and synthetic fetch only.
const pushId = "aabbccdd-1111-4111-8111-aabbccddeeff";
const pushOnly = { email: false };
const pushJson = value => JSON.stringify(value);

for (const [label, payload] of [
  ["empty id", { id: "", errors: ["synthetic-private-audience"] }],
  ["missing id", { errors: ["synthetic-private-audience"] }],
  ["null id", { id: null }],
  ["numeric id", { id: 12 }],
  ["unstructured id", { id: "synthetic-private-not-an-id" }],
  ["nil id", { id: "00000000-0000-0000-0000-000000000000" }],
  ["invalid variant", { id: "11111111-1111-4111-1111-111111111111" }],
  ["array receipt", [{ id: pushId }]],
  ["null receipt", null],
]) test(`OneSignal HTTP 200 with ${label} cannot count a created message`, async () => {
  const response = Response.json(payload);
  const service = load(() => response);
  try {
    const result = await service.deliverNotificationRows(service.client, [row], pushOnly);
    assert.equal(result.push, 0); assert.equal(result.email, 0);
    assert.equal(service.calls.length, 1); assert.equal(response.bodyUsed, true);
    assert.deepEqual(service.budgets, [10_000]);
    assert.doesNotMatch(JSON.stringify(service.logs), /synthetic-private|synthetic-push-key/);
  } finally { await response.body?.cancel().catch(() => {}); }
});

for (const payload of [{ id: pushId }, {
  id: pushId.toUpperCase(), errors: { invalid_aliases: { external_id: ["synthetic-private-alias"] } },
  warnings: { invalid_external_user_ids: "synthetic-private-warning" },
}]) test(`a valid message id confirms creation despite optional subscription details: ${Object.keys(payload).length}`, async () => {
  const response = Response.json(payload), service = load(() => response);
  try {
    assert.equal((await service.deliverNotificationRows(service.client, [row], pushOnly)).push, 1);
    assert.equal(response.bodyUsed, true); assert.equal(service.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(service.logs), /synthetic-private|aabbccdd/i);
  } finally { await response.body?.cancel().catch(() => {}); }
});

test("malformed success JSON stays unconfirmed without a second provider request", async () => {
  const response = new Response('{"id":"synthetic-private-incomplete'), service = load(() => response);
  try {
    assert.equal((await service.deliverNotificationRows(service.client, [row], pushOnly)).push, 0);
    assert.equal(service.calls.length, 1); assert.equal(response.bodyUsed, true);
    assert.doesNotMatch(JSON.stringify(service.logs), /synthetic-private-incomplete/);
  } finally { await response.body?.cancel().catch(() => {}); }
});

test("a complete receipt exactly at the byte ceiling remains readable", async () => {
  const emptyLength = Buffer.byteLength(pushJson({ id: pushId, padding: "" }));
  const text = pushJson({ id: pushId, padding: "x".repeat(64 * 1024 - emptyLength) });
  assert.equal(Buffer.byteLength(text), 64 * 1024);
  const response = new Response(text), service = load(() => response);
  try {
    assert.equal((await service.deliverNotificationRows(service.client, [row], pushOnly)).push, 1);
    assert.equal(service.calls.length, 1);
  } finally { await response.body?.cancel().catch(() => {}); }
});

for (const [label, padding] of [["ASCII", "x".repeat(64 * 1024)], ["multibyte", "😀".repeat(20_000)]]) {
  test(`oversized ${label} receipt ignores a misleading small Content-Length`, async () => {
    const text = pushJson({ id: pushId, padding });
    assert.ok(Buffer.byteLength(text) > 64 * 1024);
    if (label === "multibyte") assert.ok(text.length < 64 * 1024);
    const response = new Response(text, { headers: { "content-length": "1" } }), service = load(() => response);
    try {
      assert.equal((await service.deliverNotificationRows(service.client, [row], pushOnly)).push, 0);
      assert.equal(service.calls.length, 1); assert.equal(response.bodyUsed, true);
      assert.ok(JSON.stringify(service.logs).length < 200);
    } finally { await response.body?.cancel().catch(() => {}); }
  });
}

test("UTF-8 split across native stream chunks preserves a valid message receipt", async () => {
  const bytes = new TextEncoder().encode(pushJson({ id: pushId, warning: "🙂" }));
  const response = new Response(new ReadableStream({ start(controller) {
    for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.subarray(offset, offset + 3));
    controller.close();
  } }));
  const service = load(() => response);
  try {
    assert.equal((await service.deliverNotificationRows(service.client, [row], pushOnly)).push, 1);
    assert.equal(response.bodyUsed, true); assert.equal(service.calls.length, 1);
  } finally { await response.body?.cancel().catch(() => {}); }
});

test("an empty-chunk stream cannot evade finite receipt work", async () => {
  let pulls = 0, cancellations = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (++pulls <= 5000) controller.enqueue(new Uint8Array());
      else { controller.enqueue(new TextEncoder().encode(pushJson({ id: pushId }))); controller.close(); }
    },
    cancel() { cancellations++; },
  }));
  const service = load(() => response);
  try {
    assert.equal((await service.deliverNotificationRows(service.client, [row], pushOnly)).push, 0);
    assert.equal(service.calls.length, 1); assert.equal(cancellations, 1);
    assert.ok(pulls <= 4098, `Stop reading the empty stream within the declared chunk budget: ${pulls}`);
  } finally { await response.body?.cancel().catch(() => {}); }
});

for (const cleanup of ["complete", "reject", "stall"]) test(`aborting a stalled success body settles without retry when cleanup can ${cleanup}`, async () => {
  const controller = new AbortController();
  let release;
  const body = responseFixture(200, () => cleanup === "reject"
    ? Promise.reject(new Error("synthetic-private-cancel"))
    : cleanup === "stall" ? new Promise(resolve => { release = resolve; }) : undefined);
  const service = load(() => body.response, { signal: controller.signal });
  const pending = service.deliverNotificationRows(service.client, [row], pushOnly);
  try {
    await turn(); controller.abort();
    const result = await pending;
    assert.equal(result.push, 0); assert.equal(service.calls.length, 1);
    assert.equal(body.cancellations, 1); assert.deepEqual(service.budgets, [10_000]);
    await turn();
    assert.doesNotMatch(JSON.stringify(service.logs), /synthetic-private-cancel|synthetic-push-key/);
  } finally {
    controller.abort(); const cleanupPromise = body.cleanup(); release?.();
    await cleanupPromise; await pending;
  }
});

test("late headers after abort are discarded and their body is released", async () => {
  const controller = new AbortController(); let respond;
  const body = responseFixture(200, () => {}, pushJson({ id: pushId }));
  const service = load(() => new Promise(resolve => { respond = resolve; }), { signal: controller.signal });
  const pending = service.deliverNotificationRows(service.client, [row], pushOnly);
  try {
    await turn(); controller.abort(); respond(body.response);
    assert.equal((await pending).push, 0);
    assert.equal(body.cancellations, 1); assert.equal(service.calls.length, 1);
  } finally { respond?.(body.response); await pending; await body.cleanup(); }
});
