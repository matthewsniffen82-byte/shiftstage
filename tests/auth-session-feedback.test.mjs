import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const [liveShell, accountClient, adminClient, adminSession] = await Promise.all([
  readFile(new URL("../outputs/index.html", import.meta.url), "utf8"),
  readFile(new URL("../app/account/AccountClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminClient.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/admin-session.ts", import.meta.url), "utf8"),
]);

test("the unified login exposes persistent progress, role routing, and error feedback", () => {
  assert.match(liveShell, /id="customerEmail"[^>]*autocomplete="email"[^>]*required/);
  assert.match(liveShell, /id="customerPassword"[^>]*autocomplete="current-password"[^>]*required/);
  assert.match(liveShell, /id="customerAuthStatus"[^>]*role="status"[^>]*aria-live="polite"/);

  const handler = liveShell.match(
    /document\.getElementById\("authForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/,
  )?.[0] || "";
  assert.match(handler, /submit\.textContent = authMode === "signup" \? "Creating account…" : "Signing in…"/);
  assert.match(handler, /submit\.setAttribute\("aria-busy", "true"\)/);
  assert.match(handler, /if \(!result\.session\?\.accessToken\) throw new Error/);
  assert.match(handler, /signedInRole === "dancer"/);
  assert.match(handler, /setCustomerAuthStatus\("Signed in\. Opening your dancer dashboard…"\)/);
  assert.match(handler, /await startRealDancerSession\("Dancer dashboard opened", payload\.email\)/);
  assert.match(handler, /signedInRole === "venue"/);
  assert.match(handler, /await startVenueDashboardSession\("Club dashboard opened"\)/);
});

test("only incorrect credentials offer the account chooser and a retry clears the hint", async () => {
  assert.match(liveShell, /id="customerSignupHint" hidden>[\s\S]*?New to MyDancr\? <button[^>]+type="button">Create an account<\/button>/);
  let selectedMode, focusedTab;
  const status = {}, hint = { hidden: true }, nodes = {
    authForm: { addEventListener: (_, fn) => { nodes.submit = fn; } },
    authSubmit: { setAttribute() {}, removeAttribute() {} },
    customerEmail: { value: "guest@example.test" }, customerPassword: { value: "example" },
    customerAuthStatus: status, customerSignupHint: hint,
    customerCreateAccountFromSignIn: { addEventListener: (_, fn) => { nodes.choose = fn; } },
    authCreateTab: { focus() { focusedTab = "create"; } },
  };
  const context = vm.createContext({
    document: { getElementById: id => nodes[id] }, authMode: "login", citySelect: { value: "" },
    friendlyAuthErrorMessage: text => text, showToast() {},
    setAuthEntryMode: mode => { selectedMode = mode; },
  });
  for (const pattern of [
    /function setCustomerAuthStatus\([\s\S]*?\n    \}/,
    /document\.getElementById\("authForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/,
    /document\.getElementById\("customerCreateAccountFromSignIn"\)\.addEventListener\("click"[\s\S]*?\n    \}\);/,
  ]) vm.runInContext(liveShell.match(pattern)[0], context);

  for (const code of ["INVALID_CREDENTIALS", "UNAVAILABLE"]) {
    context.requestAuth = async () => {
      assert.equal(hint.hidden, true);
      throw Object.assign(new Error("Try again later."), { code });
    };
    await nodes.submit({ preventDefault() {} });
    assert.equal(hint.hidden, code !== "INVALID_CREDENTIALS");
    if (!hint.hidden) {
      assert.equal(status.textContent, "Check your email and password and try again.");
      nodes.choose();
      assert.equal(selectedMode, "create");
      assert.equal(focusedTab, "create");
    }
  }
  assert.equal(status.textContent, "Try again later.");
});

test("an active admin session is explained and safely replaced by dancer login", () => {
  assert.match(
    liveShell,
    /if \(isAdminSession\(\)\) \{[\s\S]*?Signing in here will safely switch to your public account/,
  );
  assert.match(accountClient, /existingSessionRole === "admin"/);
  assert.match(accountClient, /Signing in here will safely switch it to your dancer account/);
  assert.match(accountClient, /persistBrowserAuthSession\(session\)/);
  assert.match(accountClient, /Signing in\.\.\./);
  assert.match(accountClient, /Signed in\. Opening your dancer dashboard\.\.\./);
});

test("both admin dashboards provide a real session logout", () => {
  assert.match(liveShell, /id="adminLogoutBtn"[^>]*hidden>Log out<\/button>/);
  assert.match(liveShell, /function showAdminDashboardPage\(\) \{[\s\S]*?adminLogoutBtn"\)\.hidden = false/);
  assert.match(liveShell, /function showAdminAuthPage[\s\S]*?adminLogoutBtn"\)\.hidden = true/);
  assert.match(liveShell, /function logoutAdminAccount\(\) \{[\s\S]*?void endAuthSession\(\)[\s\S]*?lockAdminDashboard\(\)/);
  assert.match(liveShell, /adminLogoutBtn"\)\.addEventListener\("click", logoutAdminAccount\)/);

  assert.match(adminClient, /className="admin-logout"[^>]*onClick=\{signOut\}/);
  assert.match(adminClient, /function signOut\(\) \{[\s\S]*?void revokeAdminSession\(\)/);
  assert.match(adminSession, /revokeBrowserAuthSession\(\)/);
  assert.match(adminClient, /setState\(\{ authRequired: true, error: "Admin session ended\. Sign in to continue\." \}\)/);
});
