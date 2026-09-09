import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

const live = fs.readFileSync("outputs/index.html", "utf8");
function source(name) {
  const start = live.search(new RegExp(`    (?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  const end = live.indexOf("\n    }", start) + 6;
  return live.slice(start, end);
}

function harness() {
  let session = { accessToken: "token-a", account: { id: "a", role: "dancer" } };
  let confirm;
  let cropOptions;
  const listeners = new Set();
  const requests = [];
  const context = vm.createContext({
    DOMException, AbortController, FormData,
    approvedProfilePhotoAccountIds: new WeakMap(),
    authSession: session,
    localStorage: { getItem: () => JSON.stringify(session) },
    window: {
      addEventListener: (event, handler) => { if (event === "storage") listeners.add(handler); },
      removeEventListener: (event, handler) => { if (event === "storage") listeners.delete(handler); },
      DancrPhotoCrop: {
        crop: (file, options) => {
          cropOptions = options;
          return new Promise((resolve, reject) => {
            confirm = () => resolve(file);
            options.signal?.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
          });
        },
      },
    },
    fetch: async (url, options) => {
      requests.push({ url, account: options.headers.Authorization });
      return { ok: true, json: async () => ({ ok: true, imageDataUrl: "preview" }) };
    },
    normalizedReviewStatus: (value) => value,
    normalizeRequestError: (error, fallback) => error || fallback,
    applyResponseSession: () => {},
  });
  vm.runInContext(["synchronizeAuthSession", "authenticatedRequestHeaders", "isDancerSession", "cropApprovedProfilePhoto", "uploadSetupPhotoFile"].map(source).join("\n"), context);
  return {
    requests, listeners,
    begin: () => context.cropApprovedProfilePhoto(new File(["photo"], "private.jpg")).then((file) => context.uploadSetupPhotoFile(file, true, 0)),
    crop: (file) => context.cropApprovedProfilePhoto(file),
    upload: (file) => context.uploadSetupPhotoFile(file, true, 0),
    confirm: () => confirm(),
    prepare: () => cropOptions.prepare(new File(["photo"], "private.jpg"), new AbortController().signal),
    change: (next, dispatch = true) => {
      session = next;
      if (dispatch) for (const handler of [...listeners]) handler({ key: "dancrAuthSessionV1" });
    },
  };
}

for (const next of [null, { accessToken: "token-b", account: { id: "b", role: "dancer" } }]) {
  test(`an open crop cannot upload after ${next ? "switching dancers" : "signing out"}`, async () => {
    const h = harness();
    const pending = h.begin();
    const rejected = assert.rejects(pending, { name: "AbortError" });
    h.change(next);
    h.confirm();
    await rejected;
    assert.equal(h.requests.length, 0);
    assert.equal(h.listeners.size, 0);
  });
}

test("confirmation checks the account even before the storage event arrives", async () => {
  const h = harness();
  const pending = h.begin();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  h.change({ accessToken: "token-b", account: { id: "b", role: "dancer" } }, false);
  h.confirm();
  await rejected;
  assert.equal(h.requests.length, 0);
  assert.equal(h.listeners.size, 0);
});

test("preview retries cannot send the original photo under a changed account", async () => {
  const h = harness();
  const pending = h.begin();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  h.change({ accessToken: "token-b", account: { id: "b", role: "dancer" } }, false);
  await assert.rejects(h.prepare(), { name: "AbortError" });
  h.confirm();
  await rejected;
  assert.equal(h.requests.length, 0);
});

test("refreshing tokens for the same dancer keeps the crop usable", async () => {
  const h = harness();
  const pending = h.begin();
  h.change({ accessToken: "token-a-refreshed", account: { id: "a", role: "dancer" } });
  await h.prepare();
  h.confirm();
  await pending;
  assert.deepEqual(h.requests.map((request) => request.account), ["Bearer token-a-refreshed", "Bearer token-a-refreshed"]);
  assert.equal(h.listeners.size, 0);
});

test("an account change after confirmation still cannot upload the previous dancer's photo", async () => {
  const h = harness();
  const pending = h.crop(new File(["photo"], "private.jpg"));
  h.confirm();
  const file = await pending;
  h.change({ accessToken: "token-b", account: { id: "b", role: "dancer" } });
  await assert.rejects(h.upload(file), { name: "AbortError" });
  await assert.rejects(h.crop(file), { name: "AbortError" });
  assert.equal(h.requests.length, 0);
});
