import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const liveSource = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../src/lib/dancr/customer-deal-saves-client.ts", import.meta.url), "utf8");
const pass = { id: "pass-1", dealId: "deal-1", venueId: "club-1", sourceType: "club_page" };

function liveFunction(name, nextName) {
  const start = liveSource.indexOf(`    ${name}`);
  const end = liveSource.indexOf(`    ${nextName}`, start);
  assert.ok(start >= 0 && end > start);
  return liveSource.slice(start, end);
}

function harness(client, { mode = "success", storageBlocked = false, payload } = {}) {
  const timers = new Map();
  const storage = new Map();
  storage.set("dancrAuthSessionV1", JSON.stringify({ accessToken: "test-session", account: { id: "customer-a", role: "customer" } }));
  const notices = [];
  let requestSignal;
  let timerId = 0;
  const window = {
    setTimeout(callback, delay) {
      assert.equal(delay, 8_000);
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const stalled = (signal) => new Promise((resolve, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  const context = vm.createContext({
    AbortController, window,
    console: { warn() {} },
    fetch: async (url, options) => {
      assert.ok(url.startsWith("/api/customer/deal-saves"));
      requestSignal = options.signal;
      if (mode === "headers-stall") return stalled(options.signal);
      return {
        ok: mode !== "http-error",
        json: () => mode === "body-stall"
          ? stalled(options.signal)
          : Promise.resolve(payload ?? { ok: true, persisted: true, saved: true }),
      };
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        if (storageBlocked) throw new Error("storage blocked");
        storage.set(key, value);
      },
    },
    isCustomerSession: () => true,
    authenticatedRequestHeaders: () => ({ Authorization: "Bearer test-session" }),
    apiRequestError: () => new Error("save failed"),
    applyResponseSession() {},
    customerDashboard: { classList: { contains: () => false } },
    renderDashboard() {},
    renderCustomerQuickActions() {},
    showToast: (message) => notices.push(message),
    recordRevenueDealLifecycle() {},
    savedDealTimestamp: item => Date.parse(item.savedAt) || 0,
  });
  let save, load;
  if (client === "live") {
    vm.runInContext([
      "let savedDealPasses = []; let savedDealPassesStorageKey = savedDealsStorageKey();",
      liveFunction("function savedDealsStorageKey()", "function loadSavedDealPasses()"),
      liveFunction("function syncDeviceSavedDealPasses()", "function venueExperienceHref("),
      liveFunction("function saveSavedDealPasses()", "function savedDealsSeenStorageKey()"),
      liveFunction("async function persistCustomerDealSave(", "async function saveCustomerDealPass("),
      liveFunction("async function saveCustomerDealPass(", "function recordRevenueDealLifecycle("),
    ].join("\n"), context);
    save = () => context.persistCustomerDealSave(pass, true);
  } else {
    const exports = {};
    Object.assign(context, {
      exports, module: { exports },
      require: (name) => {
        assert.equal(name, "./browser-session");
        return {
          readBrowserAuthSession: () => ({ accessToken: "test-session", account: { role: "customer" } }),
          persistRefreshedBrowserAuthSession() {},
        };
      },
    });
    vm.runInContext(ts.transpileModule(clientSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    save = () => exports.setCustomerDealSavedInAccount({ dealId: pass.dealId, saved: true, sourceType: "club_page" });
    load = (signal) => exports.loadCustomerDealSavedState(pass.dealId, signal);
  }
  return {
    save, load, storage, notices, timers,
    savePass: () => context.saveCustomerDealPass(pass),
    savedPasses: () => vm.runInContext("savedDealPasses", context),
    signal: () => requestSignal,
    expire: () => { for (const callback of [...timers.values()]) callback(); },
    switchAccount: id => storage.set("dancrAuthSessionV1", JSON.stringify({ accessToken: "other-session", account: { id, role: "customer" } })),
  };
}

for (const client of ["live", "react"]) {
  for (const mode of ["headers-stall", "body-stall"]) {
    test(`${client} deal saves stop waiting when ${mode} reaches the deadline`, async () => {
      const state = harness(client, { mode });
      const saving = state.save().catch(() => false);
      await Promise.resolve();
      await Promise.resolve();
      state.expire();
      assert.equal(await saving, false);
      assert.equal(state.signal().aborted, true);
      assert.equal(state.timers.size, 0);
    });
  }

  test(`${client} only confirms an explicit persisted save response`, async () => {
    for (const payload of [{}, { ok: true }, { ok: true, persisted: false }, { ok: true, persisted: true, saved: false }]) {
      const state = harness(client, { payload });
      assert.equal(await state.save().catch(() => false), false);
      assert.equal(state.timers.size, 0);
    }
    const state = harness(client);
    assert.equal(await state.save(), true);
    assert.equal(state.timers.size, 0);
  });
}

test("a stalled account save falls back to a real device bookmark", async () => {
  const state = harness("live", { mode: "headers-stall" });
  const saving = state.savePass();
  state.expire();
  assert.equal(await saving, true);
  assert.equal(JSON.parse(state.storage.get("dancrSavedDealPassesV3:account:customer-a"))[0].id, pass.id);
  assert.equal(state.savedPasses()[0].serverSaved, false);
  assert.match(state.notices.at(-1), /Saved on this device/);
});

test("no saved confirmation is returned when both account and device persistence fail", async () => {
  const state = harness("live", { mode: "headers-stall", storageBlocked: true });
  const saving = state.savePass();
  state.expire();
  assert.equal(await saving, false);
  assert.equal(state.savedPasses().length, 0);
  assert.match(state.notices.at(-1), /Browser storage blocked saving/);
});

test("a successful private account save does not leave a device bookmark", async () => {
  const state = harness("live");
  assert.equal(await state.savePass(), true);
  assert.equal(state.savedPasses()[0].serverSaved, true);
  assert.equal(state.storage.get("dancrSavedDealPassesV3:account:customer-a"), "[]");
  assert.match(state.notices.at(-1), /Saved privately to your account/);
});

test("an unavailable account lookup preserves the device's saved-state fallback", async () => {
  const state = harness("react", { payload: { ok: true, persisted: false, saved: false } });
  assert.equal(await state.load(), null);
});

test("unmounting the card still cancels a pending account lookup", async () => {
  const state = harness("react", { mode: "headers-stall" });
  const controller = new AbortController();
  const loading = state.load(controller.signal);
  controller.abort();
  await assert.rejects(loading, /aborted/);
  assert.equal(state.signal().aborted, true);
  assert.equal(state.timers.size, 0);
});

test("an account switch during a stalled save never creates a bookmark in the new account", async () => {
  const state = harness("live", { mode: "headers-stall" });
  const saving = state.savePass();
  state.switchAccount("new-customer");
  state.expire();
  assert.equal(await saving, false);
  assert.equal(state.savedPasses().length, 0);
  assert.equal(state.storage.has("dancrSavedDealPassesV3:account:new-customer"), false);
  assert.equal(state.notices.length, 0);
});
