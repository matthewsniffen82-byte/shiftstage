import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as preferences from "../src/lib/dancr/dancer-notification-preferences.ts";

const require = createRequire(import.meta.url);
const plain = value => JSON.parse(JSON.stringify(value));
function compile(path, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL("../" + path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console: { warn() {} }, require: name => dependencies[name] ?? (name === "node:crypto" ? require(name) : {}) });
  return exports;
}

const cases = [["followers", "follow", "profile"], ["profileLikes", "like", "profile"], ["photoLikes", "like", "photo"], ["videoLikes", "like", "video"], ["shares", "share", "photo"]];
test("activity defaults on and each preference mutes only its own alert type", () => {
  for (const [key, engagement, target] of cases) {
    assert.equal(preferences.dancerEngagementAlertEnabled(null, engagement, target), true);
    const metadata = preferences.dancerNotificationMetadataPatch({ [key]: false });
    assert.equal(preferences.dancerEngagementAlertEnabled(metadata, engagement, target), false);
    for (const [other, otherEngagement, otherTarget] of cases.filter(item => item[0] !== key)) {
      assert.equal(preferences.dancerEngagementAlertEnabled(metadata, otherEngagement, otherTarget), true, other);
    }
  }
  for (const target of ["profile", "photo", "video"]) assert.equal(preferences.dancerEngagementAlertEnabled(preferences.dancerNotificationMetadataPatch({ shares: false }), "share", target), false);
});

test("settings reject empty, malformed, unknown and non-boolean patches", () => {
  for (const value of [null, [], {}, "off", { role: "admin" }, { emailEnabled: true }, { followers: "false" }, { shares: 0 }]) {
    assert.throws(() => preferences.dancerNotificationMetadataPatch(value));
  }
});

function routeFixture({ denied = false, fail = false } = {}) {
  let metadata = { display_name: "Existing name", ...preferences.dancerNotificationMetadataPatch({ photoLikes: false }) };
  const writes = [];
  const route = compile("app/api/dancer/notification-settings/route.ts", {
    "next/server": { NextResponse: { json: (data, init) => Response.json(data, init) } },
    "@/src/lib/dancr/dancer-notification-preferences": preferences,
    "@/src/lib/bounded-json-body": { readBoundedJsonObject: async (request, options) => { assert.equal(options.maxBytes, 2048); return request.json(); } },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async (_request, access) => {
      assert.equal(access.role, "dancer");
      if (denied) throw Object.assign(new Error("Dancer access required."), { status: 403 });
      return { user: { id: "verified-dancer", user_metadata: metadata }, session: { accessToken: "rotated" } };
    } },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({ auth: { admin: { updateUserById: async (id, update) => {
      writes.push({ id, ...plain(update) });
      if (fail) return { data: { user: null }, error: new Error("Unavailable") };
      metadata = { ...metadata, ...update.user_metadata };
      return { data: { user: { user_metadata: metadata } }, error: null };
    } } } }) },
    "@/src/lib/api": { apiError: error => Response.json({ ok: false }, { status: error.status || 500 }) },
  });
  return { ...route, writes, metadata: () => metadata };
}
const patch = body => new Request("https://example.test/api/dancer/notification-settings", { method: "PATCH", body: JSON.stringify(body) });
test("settings save only the verified dancer's whitelisted keys and reload confirmed values", async () => {
  const f = routeFixture();
  const response = await f.PATCH(patch({ userId: "another-dancer", settings: { followers: false } }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.writes, [{ id: "verified-dancer", user_metadata: { mydancr_dancer_notify_followers: false } }]);
  assert.equal(f.metadata().display_name, "Existing name");
  const saved = await response.json();
  assert.equal(saved.settings.followers, false);
  assert.equal(saved.settings.photoLikes, false);
  assert.equal(saved.session.accessToken, "rotated");
  const loaded = await f.GET(new Request("https://example.test/api/dancer/notification-settings"));
  assert.match(loaded.headers.get("cache-control"), /private.*no-store/);
  assert.deepEqual((await loaded.json()).settings, saved.settings);
});
test("denied, invalid and failed saves cannot report a preference as saved", async () => {
  const denied = routeFixture({ denied: true });
  assert.equal((await denied.PATCH(patch({ settings: { followers: false } }))).status, 403);
  assert.deepEqual(denied.writes, []);
  const invalid = routeFixture();
  assert.equal((await invalid.PATCH(patch({ settings: { role: true } }))).status, 400);
  assert.deepEqual(invalid.writes, []);
  assert.equal((await routeFixture({ fail: true }).PATCH(patch({ settings: { followers: false } }))).status, 500);
});

test("muted activity never creates an inbox row; enabled activity retains deduplication", async () => {
  const helper = compile("src/lib/dancr/engagement-notifications.ts", { "./dancer-notification-preferences": preferences });
  for (const [key, engagementType, targetType] of cases) {
    const inserted = [];
    let metadata = preferences.dancerNotificationMetadataPatch({ [key]: false });
    const client = { auth: { admin: { getUserById: async id => { assert.equal(id, "recipient"); return { data: { user: { user_metadata: metadata } }, error: null }; } } },
      from: table => { assert.equal(table, "notifications"); return { insert: async row => { inserted.push(row); return { error: inserted.length > 1 ? { code: "23505" } : null }; } }; } };
    const recipient = { recipientId: "recipient", dancerId: "dancer", dancerSlug: "synthetic" };
    const input = { engagementType, targetType, targetId: "target", dedupeSubject: "visitor" };
    assert.equal((await helper.createDancerEngagementNotification(client, recipient, input)).created, false);
    assert.deepEqual(inserted, []);
    metadata = preferences.dancerNotificationMetadataPatch({ [key]: true });
    const first = await helper.createDancerEngagementNotification(client, recipient, input);
    assert.equal(first.created, true);
    const repeated = await helper.createDancerEngagementNotification(client, recipient, input);
    assert.equal(repeated.created, false);
    assert.equal(repeated.notificationId, first.notificationId);
  }
});
test("unavailable preferences suppress the alert without failing a completed engagement", async () => {
  const helper = compile("src/lib/dancr/engagement-notifications.ts", { "./dancer-notification-preferences": preferences });
  const client = { auth: { admin: { getUserById: async () => ({ data: { user: null }, error: new Error("Unavailable") }) } }, from() { throw new Error("Must not write"); } };
  const result = await helper.createDancerEngagementNotification(client, { recipientId: "recipient", dancerId: "dancer", dancerSlug: "synthetic" }, { engagementType: "like", targetType: "photo", targetId: "target", dedupeSubject: "visitor" });
  assert.equal(result.created, false);
  client.auth.admin.getUserById = async () => { throw new Error("Network unavailable"); };
  assert.equal((await helper.createDancerEngagementNotification(client, { recipientId: "recipient", dancerId: "dancer", dancerSlug: "synthetic" }, { engagementType: "like", targetType: "photo", targetId: "target", dedupeSubject: "visitor" })).created, false);
});
