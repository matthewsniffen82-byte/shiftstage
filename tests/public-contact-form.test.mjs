import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/live-shell/app/15-active-support-role.js", import.meta.url), "utf8");
const submitSource = source.match(/    async function submitPublicContactForm\([\s\S]*?\n    }/)?.[0];
assert.ok(submitSource);

function fixture(values = { name: "", email: "", subject: "Account help", message: "I need help with my account." }) {
  const submitButton = { disabled: false, textContent: "Send message" };
  const status = { textContent: "", dataset: {} };
  const requests = [];
  let finishRequest;
  let resetCount = 0;
  const context = vm.createContext({
    publicContactStatus: status,
    publicContactForm: {
      querySelector: () => submitButton,
      reset: () => { resetCount++; },
    },
    FormData: class { get(key) { return values[key]; } },
    window: { location: { href: "https://www.mydancr.com/" } },
    liveAdminReports: [],
    postOptionalAuthJson: (url, body) => {
      requests.push({ url, body });
      return new Promise((resolve, reject) => { finishRequest = { resolve, reject }; });
    },
  });
  vm.runInContext(submitSource, context);
  return {
    submit: () => context.submitPublicContactForm({ preventDefault() {} }),
    succeed: () => finishRequest.resolve({ report: { id: "contact-test" } }),
    fail: () => finishRequest.reject(new Error("Please try again.")),
    requests, status, submitButton,
    get resetCount() { return resetCount; },
  };
}

test("contact sends without optional identity fields and blocks duplicate submissions while pending", async () => {
  const f = fixture();
  const pending = f.submit();
  assert.equal(f.submitButton.disabled, true);
  assert.equal(f.submitButton.textContent, "Sending…");
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].url, "/api/reports");
  assert.equal(f.requests[0].body.targetType, "contact_message");
  assert.equal(f.requests[0].body.reason, "Account help");
  assert.match(f.requests[0].body.details, /Name: Not provided\nEmail: Not provided/);
  f.succeed();
  await pending;
  assert.equal(f.resetCount, 1);
  assert.equal(f.status.dataset.state, "success");
  assert.equal(f.submitButton.disabled, false);
  assert.equal(f.submitButton.textContent, "Send message");
});

test("failed contact submissions preserve the form and permit retry", async () => {
  const f = fixture();
  const pending = f.submit();
  f.fail();
  await pending;
  assert.equal(f.resetCount, 0);
  assert.equal(f.status.dataset.state, "error");
  assert.equal(f.status.textContent, "Please try again.");
  assert.equal(f.submitButton.disabled, false);
  const retry = f.submit();
  assert.equal(f.requests.length, 2);
  assert.equal(f.status.dataset.state, undefined);
  f.succeed();
  await retry;
  assert.equal(f.resetCount, 1);
});

test("blank required contact fields never send a request", async () => {
  for (const values of [{ subject: " ", message: "Help" }, { subject: "Help", message: " " }]) {
    const f = fixture(values);
    await f.submit();
    assert.equal(f.requests.length, 0);
    assert.equal(f.status.dataset.state, "error");
    assert.equal(f.submitButton.disabled, false);
    assert.equal(f.resetCount, 0);
  }
});
