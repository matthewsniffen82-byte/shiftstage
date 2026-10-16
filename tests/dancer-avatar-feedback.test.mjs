import assert from "node:assert/strict";
import test from "node:test";
import { avatarUploadPresentation } from "../app/dashboard/avatar-upload-state.ts";
import { DashboardDataRequestError, persistDashboardSession, requestDancerAvatarJson } from "../app/dashboard/dashboard-session.ts";

// Legacy clients can still finish existing avatar reviews. New profiles use the main photo.
test("a rejected replacement does not label the existing approved image as rejected on reopening", () => {
  const ui = avatarUploadPresentation({ upload: null, avatarUrl: "approved.jpg", latestReview: { id: "rejected-replacement", decision: "rejected" } });
  assert.equal(ui.label, "Approved");
  assert.match(ui.message, /New avatar not approved/);
  assert.equal(ui.canRetry, false);
});

test("the avatar request preserves a structured rejection while ordinary 422 errors remain errors", async () => {
  const previousWindow = globalThis.window, previousFetch = globalThis.fetch;
  const stored = new Map();
  globalThis.window = { localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } };
  try {
    persistDashboardSession({ accessToken: "fixture", refreshToken: "fixture-refresh", account: { id: "owner", role: "dancer" } });
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, decision: "rejected", moderationRecordId: "r" }), { status: 422 });
    assert.equal((await requestDancerAvatarJson({ method: "POST" })).decision, "rejected");
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, error: "Choose a clear face photo." }), { status: 422 });
    await assert.rejects(requestDancerAvatarJson({ method: "POST" }), error => error instanceof DashboardDataRequestError && error.status === 422);
  } finally { globalThis.window = previousWindow; globalThis.fetch = previousFetch; }
});
