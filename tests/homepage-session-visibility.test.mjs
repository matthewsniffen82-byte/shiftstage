import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const key = "dancrAuthSessionV1";
const original = { accessToken: "synthetic-original", refreshToken: "synthetic-refresh", account: { id: "account-a", role: "admin" } };
const newer = { accessToken: "synthetic-newer", refreshToken: "synthetic-newer-refresh", account: { id: "account-b", role: "customer" } };
function declaration(name) {
  const start = source.indexOf(`    function ${name}(`);
  if (start < 0) return "";
  const end = source.indexOf("\n    }", start);
  assert.ok(end > start);
  return source.slice(start, end + 6);
}
const eventStart = source.lastIndexOf('    window.addEventListener("focus", () => {');
const eventEnd = source.indexOf("    if (isCustomerSession()) loadLiveCustomerDashboardData();", eventStart);
assert.ok(eventStart > 0 && eventEnd > eventStart);

function fixture() {
  const stored = new Map([[key, JSON.stringify(original)]]), listeners = new Map(), reloads = [];
  const body = { inert: false, style: { visibility: "visible" } };
  const context = {
    authSession: original,
    visibleAuthAccountIdentity: JSON.stringify(["admin", "account-a"]),
    localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) },
    document: { body }, window: { location: { reload: () => reloads.push(true) }, addEventListener: (name, fn) => listeners.set(name, fn) },
    PUBLIC_DISCOVERY_REFRESH_KEY: "synthetic-discovery-key",
    loadAuthSession: () => JSON.parse(stored.get(key) || "null"),
    synchronizeAuthSession() { context.authSession = context.loadAuthSession(); },
    refreshVisibleHomeDiscovery() {}, syncDeviceSavedDealPasses() {}, renderCustomerQuickActions() {}, consumePublicDiscoveryRefreshRequest() {}, loadLiveCustomerSaved() {},
    isCustomerSession: () => context.authSession?.account?.role === "customer",
    normalizeAccountEmail: value => String(value || ""), persistAccountEmail() {}, updateCurrentEmailDisplays() {}, clearCustomerPushDevice() {},
  };
  vm.runInNewContext([declaration("browserAccountIdentity"), declaration("refreshBrowserAccountView"), declaration("saveAuthSession"), source.slice(eventStart, eventEnd), "globalThis.save = saveAuthSession;"].join("\n"), context);
  return { stored, body, reloads, context, event: (name, detail = {}) => listeners.get(name)?.(detail) };
}

for (const [event, replacement] of [["storage", newer], ["storage", null], ["pageshow", newer], ["pageshow", null], ["focus", newer]]) {
  test(`homepage ${event} removes the previous private view after ${replacement ? "account switching" : "logout"}`, () => {
    const f = fixture();
    if (replacement) f.stored.set(key, JSON.stringify(replacement)); else f.stored.delete(key);
    f.event(event, { key, persisted: true });
    assert.equal(f.body.inert, true, "old private controls cannot be used during navigation");
    assert.equal(f.body.style.visibility, "hidden", "old private content leaves the display immediately");
    assert.equal(f.reloads.length, 1);
    assert.equal(f.stored.get(key) ?? null, replacement ? JSON.stringify(replacement) : null);
  });
}

test("homepage keeps the view on same-account token rotation", () => {
  const f = fixture();
  f.stored.set(key, JSON.stringify({ ...original, accessToken: "rotated-access", refreshToken: "rotated-refresh" }));
  f.event("storage", { key });
  f.event("focus");
  assert.equal(f.reloads.length, 0);
  assert.equal(f.body.inert, false);
});

test("homepage ignores unrelated storage events", () => {
  const f = fixture();
  f.event("storage", { key: "unrelated-key" });
  assert.equal(f.reloads.length, 0);
});

test("homepage own successful login updates the view identity without a spurious focus reload", () => {
  const f = fixture();
  f.context.save(newer);
  f.event("focus");
  assert.equal(f.reloads.length, 0);
  assert.equal(f.stored.get(key), JSON.stringify(newer));
});
