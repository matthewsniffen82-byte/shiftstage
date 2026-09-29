import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/push/web/worker.js", import.meta.url), "utf8");
const origin = "https://www.mydancr.com";

function fixture({ workerOrigin = origin, windows = [], navigateFails = false } = {}) {
  const handlers = {}, notifications = [], navigations = [], opened = [], focused = [];
  const state = new Map([["account", "venue-account"]]);
  const context = vm.createContext({ URL, Date, self: {
    location: { origin: workerOrigin },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    registration: { showNotification: async (title, options) => notifications.push({ title, ...options, close() {} }) },
    clients: {
      matchAll: async () => windows.map((url, index) => ({ url, navigate: async target => {
        navigations.push({ index, target });
        if (navigateFails) throw new Error("Tab closed");
        return { focus: async () => focused.push(index) };
      } })),
      openWindow: async url => opened.push(url),
    },
  } });
  vm.runInContext(source, context);
  // Storage persistence is independent of click routing; keep real worker handlers.
  context.storage = async (operation, key, value) => operation === "get" ? state.get(key) : state.set(key, value);
  const dispatch = async (name, event) => {
    let pending;
    handlers[name]({ ...event, waitUntil: promise => { pending = promise; } });
    await pending;
  };
  return { state, notifications, navigations, opened, focused,
    push: (url, id = "request-notification-1") => dispatch("push", { data: { json: () => ({ id, accountId: "venue-account", title: "MyDancr Internal", body: "Table 1 wants Star.", url, expiresAt: Date.now() + 60000 }) } }),
    click: () => dispatch("notificationclick", { notification: notifications.at(-1) }),
  };
}

for (const hash of ["#table-requests", "#venue-pickups"]) {
  test(`a request notification opens a fresh signed-in dashboard at ${hash}`, async () => {
    const f = fixture();
    await f.push(origin + "/dashboard/venue" + hash);
    await f.click();
    assert.equal(f.opened[0], origin + "/dashboard/venue?notification=request-notification-1" + hash);
  });
}

test("successive alerts reuse the venue dashboard and change its document URL to reload requests", async () => {
  const f = fixture({ windows: [origin + "/", origin + "/dashboard/venue#table-requests"] });
  for (const id of ["first-request", "second-request"]) {
    await f.push(origin + "/dashboard/venue#table-requests", id);
    await f.click();
  }
  assert.deepEqual(f.navigations.map(item => item.index), [1, 1]);
  assert.deepEqual(f.focused, [1, 1]);
  assert.deepEqual(f.opened, []);
  assert.notEqual(new URL(f.navigations[0].target).search, new URL(f.navigations[1].target).search);
  assert.ok(f.navigations.every(item => new URL(item.target).hash === "#table-requests"));
});

test("a closed browser tab falls back to opening the intended inbox in a new window", async () => {
  const f = fixture({ windows: [origin + "/dashboard/venue"], navigateFails: true });
  await f.push(origin + "/dashboard/venue#table-requests");
  await f.click();
  assert.equal(f.opened[0], f.navigations[0].target);
});

test("an older bare-domain install keeps its signed-in origin and the inbox destination", async () => {
  const f = fixture({ workerOrigin: "https://mydancr.com" });
  await f.push(origin + "/dashboard/venue#table-requests");
  await f.click();
  assert.equal(f.opened[0], "https://mydancr.com/dashboard/venue?notification=request-notification-1#table-requests");
});

test("a notification cannot open a former account's dashboard after sign-out or account switch", async () => {
  for (const account of [null, "other-account"]) {
    const f = fixture();
    await f.push(origin + "/dashboard/venue#table-requests");
    f.state.set("account", account);
    await f.click();
    assert.deepEqual(f.opened, []);
    assert.deepEqual(f.navigations, []);
  }
});

test("untrusted notification URLs cannot navigate outside the app", async () => {
  for (const url of ["https://evil.example/dashboard/venue#table-requests", "https://mydancr.com.evil.example/", "https://user:pass@www.mydancr.com/dashboard/venue", "javascript:alert(1)"]) {
    const f = fixture();
    await f.push(url);
    await f.click();
    assert.deepEqual(f.opened, [origin + "/"]);
  }
});

test("other notification destinations retain their query and anchor", async () => {
  const f = fixture();
  const url = origin + "/dashboard/customer?view=alerts#customer-alerts";
  await f.push(url);
  await f.click();
  assert.deepEqual(f.opened, [url]);
});
