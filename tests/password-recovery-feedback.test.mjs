import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/live-shell/app/02-record-live-event.js", import.meta.url), "utf8");
const recovery = source.slice(source.indexOf("    let passwordRecoveryRequestVersion = 0;"));

function fixture() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      id, value: "", textContent: "", disabled: false, hidden: true, readOnly: false, dataset: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() {}, querySelector() { return null; },
    });
    return elements.get(id);
  };
  const calls = [], pending = [], toasts = [];
  const context = vm.createContext({
    document: { getElementById: element },
    window: { setTimeout: fn => fn() },
    passwordRecoveryCard: element("passwordRecoveryCard"),
    passwordRecoveryStatus: element("passwordRecoveryStatus"),
    loginRecoveryCard: null,
    showToast: message => toasts.push(message),
    friendlyAuthErrorMessage: message => message,
    savePasswordResetResume: (_role, _email, destination) => destination,
    requestAuth(payload) {
      calls.push(payload);
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    },
  });
  vm.runInContext(recovery, context);
  element("customerEmail").value = "recovery@example.test";
  const open = role => context.openPasswordRecovery({ role, emailInputId: "customerEmail", buttonId: "customerForgotPasswordBtn" });
  open("customer");
  const send = () => context.sendPasswordReset({
    role: element("passwordRecoveryRole").value,
    emailInputId: "passwordRecoveryEmail", buttonId: "passwordRecoverySubmit", statusId: "passwordRecoveryStatus",
  });
  return { element, context, calls, pending, toasts, open, send };
}

test("reset requests show progress, block duplicate submits, and retain a private success confirmation", async () => {
  const f = fixture();
  const button = f.element("passwordRecoverySubmit");
  const request = f.send();
  assert.equal(button.disabled, true);
  assert.equal(button.attributes["aria-busy"], "true");
  assert.match(f.element("passwordRecoverySubmitLabel").textContent, /Sending/);
  assert.equal(f.element("passwordRecoveryEmail").readOnly, true);
  await f.send();
  assert.equal(f.calls.length, 1);
  f.pending[0].resolve({ ok: true });
  await request;
  assert.equal(f.element("passwordRecoveryCard").dataset.state, "success");
  assert.equal(f.element("passwordRecoverySubmitLabel").textContent, "Reset link requested");
  assert.equal(button.disabled, true);
  assert.equal(button.attributes["aria-busy"], "false");
  assert.equal(f.element("passwordRecoveryStatus").hidden, false);
  assert.equal(f.element("passwordRecoveryStatusTitle").hidden, false);
  assert.match(f.element("passwordRecoveryStatusMessage").textContent, /If an account matches this email/);
  assert.equal(f.element("passwordRecoveryEmail").readOnly, false);
  assert.deepEqual(f.toasts, []);
  await f.send();
  assert.equal(f.calls.length, 1);
});

test("a failed reset shows an error, never confirms success, and allows retry", async () => {
  const f = fixture();
  const request = f.send();
  f.pending[0].reject(new Error("Please wait a few minutes, then try again."));
  await request;
  assert.equal(f.element("passwordRecoveryCard").dataset.state, "error");
  assert.equal(f.element("passwordRecoverySubmit").disabled, false);
  assert.equal(f.element("passwordRecoveryStatusTitle").hidden, true);
  assert.match(f.element("passwordRecoveryStatusMessage").textContent, /Please wait/);
  const retry = f.send();
  assert.equal(f.element("passwordRecoveryStatus").hidden, true);
  f.pending[1].resolve({ ok: true });
  await retry;
  assert.equal(f.element("passwordRecoveryCard").dataset.state, "success");
});

test("editing the email clears the prior confirmation and submits the new address", async () => {
  const f = fixture();
  const request = f.send();
  f.pending[0].resolve({ ok: true });
  await request;
  f.element("passwordRecoveryEmail").value = "corrected@example.test";
  f.context.resetPasswordRecoveryFeedback();
  assert.equal(f.element("passwordRecoveryStatus").hidden, true);
  assert.equal(f.element("passwordRecoverySubmit").disabled, false);
  assert.equal(f.element("passwordRecoverySubmitLabel").textContent, "Send reset link");
  const next = f.send();
  assert.equal(f.calls[1].email, "corrected@example.test");
  f.pending[1].resolve({ ok: true });
  await next;
});

for (const outcome of ["resolve", "reject"]) {
  test(`a late ${outcome} cannot overwrite a reopened dialog's new request`, async () => {
    const f = fixture();
    const previous = f.send();
    f.context.closeRecoveryPopover(f.element("passwordRecoveryCard"));
    f.open("dancer");
    const current = f.send();
    f.pending[0][outcome](outcome === "reject" ? new Error("Old failure") : { ok: true });
    await previous;
    assert.equal(f.element("passwordRecoveryCard").dataset.state, "sending");
    assert.equal(f.element("passwordRecoverySubmit").disabled, true);
    f.pending[1].resolve({ ok: true });
    await current;
    assert.equal(f.element("passwordRecoveryCard").dataset.state, "success");
    assert.equal(f.calls[1].role, "dancer");
    assert.equal(f.calls[1].emailRedirectTo, "/dashboard/dancer");
  });
}

test("venue recovery preserves its redirect and an empty email sends no request", async () => {
  const f = fixture();
  f.open("venue");
  f.element("passwordRecoveryEmail").value = " ";
  await f.send();
  assert.equal(f.calls.length, 0);
  assert.equal(f.element("passwordRecoveryCard").dataset.state, "error");
  f.element("passwordRecoveryEmail").value = "venue@example.test";
  const request = f.send();
  assert.equal(f.calls[0].emailRedirectTo, "/dashboard/venue");
  f.pending[0].resolve({ ok: true });
  await request;
});

test("the existing admin reset action retains its label and toast feedback", async () => {
  const f = fixture();
  f.element("adminEmail").value = "admin@example.test";
  f.element("adminForgotPasswordBtn").textContent = "Forgot password?";
  const request = f.context.sendPasswordReset({ role: "admin", emailInputId: "adminEmail", buttonId: "adminForgotPasswordBtn" });
  assert.equal(f.calls[0].emailRedirectTo, "/admin");
  f.pending[0].resolve({ ok: true });
  await request;
  assert.equal(f.element("adminForgotPasswordBtn").disabled, false);
  assert.equal(f.element("adminForgotPasswordBtn").textContent, "Forgot password?");
  assert.equal(f.toasts.length, 1);
});
