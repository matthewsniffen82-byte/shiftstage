import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as sessions from "../src/lib/dancr/browser-session.ts";

const source = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
const start = source.indexOf("  async function deleteAccount() {");
const end = source.indexOf("\n  }", source.indexOf("  async function signOut() {", start)) + 4;
assert.ok(start > 0 && end > start);
const compiled = ts.transpileModule(source.slice(start, end) + "\nglobalThis.runDelete=deleteAccount;globalThis.runLogout=signOut;", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const key = sessions.BROWSER_AUTH_SESSION_KEY;
const original = { accessToken: "synthetic-a", refreshToken: "synthetic-a-refresh", account: { id: "account-a", role: "dancer" } };
const newer = { accessToken: "synthetic-b", refreshToken: "synthetic-b-refresh", account: { id: "account-b", role: "customer" } };

function fixture() {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const stored = new Map([[key, JSON.stringify(original)]]), navigations = [];
  let settleDelete, settlePush;
  const window = { localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) }, sessionStorage: { setItem() {} }, navigator: {}, alert() {}, location: { replace: path => navigations.push(path), href: "" } };
  globalThis.window = window;
  globalThis.fetch = async () => new Response('{"ok":true}');
  const context = {
    ...sessions, window, deleteConfirmation: "DELETE", PUBLIC_DISCOVERY_REFRESH_KEY: "synthetic-publication-key",
    readSession: sessions.readBrowserAuthSession, clearDashboardSession: sessions.clearBrowserAuthSession, revokeDashboardSession: sessions.revokeBrowserAuthSession,
    requestAccountJson: () => new Promise((resolve, reject) => { settleDelete = { resolve, reject }; }),
    disableCustomerPush: () => new Promise(resolve => { settlePush = resolve; }),
    beginAccountAction: () => ({ requestId: 1, controller: new AbortController() }), isCurrentAccountAction: () => true, finishAccountAction() {}, setStatus() {},
    actionSequenceRef: { current: 0 }, actionAbortRef: { current: null }, actionInFlightRef: { current: false },
  };
  vm.runInNewContext(compiled, context);
  return { stored, navigations, context, settleDelete: () => settleDelete, settlePush: () => settlePush, close() { globalThis.window = previousWindow; globalThis.fetch = previousFetch; } };
}

for (const success of [true, false]) {
  test(`account deletion ${success ? "success" : "failure"} cannot clear a newer account`, async () => {
    const f = fixture();
    try {
      const pending = f.context.runDelete();
      f.stored.set(key, JSON.stringify(newer));
      if (success) f.settleDelete().resolve({ ok: true }); else f.settleDelete().reject(new Error("Synthetic failure"));
      await pending;
      assert.equal(f.stored.get(key), JSON.stringify(newer));
    } finally { f.close(); }
  });
}

for (const rotated of [false, true]) {
  test(`successful deletion clears the deleted account${rotated ? " after token refresh" : ""}`, async () => {
    const f = fixture();
    try {
      const pending = f.context.runDelete();
      if (rotated) f.stored.set(key, JSON.stringify({ ...original, accessToken: "rotated", refreshToken: "rotated-refresh" }));
      f.settleDelete().resolve({ ok: true });
      await pending;
      assert.equal(f.stored.has(key), false);
      assert.equal(f.navigations.at(-1), "/");
    } finally { f.close(); }
  });
}

test("failed deletion still clears the original failed session", async () => {
  const f = fixture();
  try {
    const pending = f.context.runDelete();
    f.settleDelete().reject(new Error("Synthetic failure"));
    await pending;
    assert.equal(f.stored.has(key), false);
  } finally { f.close(); }
});

test("logout clears credentials before slow push cleanup and never revokes a later sign-in", async () => {
  const f = fixture();
  let pending;
  try {
    pending = f.context.runLogout();
    assert.equal(f.stored.has(key), false, "logout must clear credentials immediately");
    f.stored.set(key, JSON.stringify(newer));
    f.settlePush()();
    await pending;
    assert.equal(f.stored.get(key), JSON.stringify(newer));
  } finally { f.settlePush()?.(); await pending; f.close(); }
});
