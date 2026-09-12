import assert from "node:assert/strict";
import test from "node:test";
import { getVenueAccess, requireVenueAccess, withVenueAccessReadScope } from "../src/lib/dancr/venue-access.ts";

function fixture(role = "owner") {
  const calls = [];
  const state = { active: true, fail: false };
  const venue = { id: "venue", name: "Test Club", slug: "test-club", is_active: true, owner_user_id: "owner" };
  const client = { from(table) {
    const filters = {};
    return {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; },
      order() { return this; }, limit() { return this; }, maybeSingle() { return this; },
      then(resolve, reject) {
        calls.push({ table, filters });
        const data = table === "app_users" ? { id: filters.id, role: "venue", account_state: state.active ? "active" : "disabled" }
          : table === "venues" ? role === "owner" ? venue : null
          : { role, status: "active", venues: venue };
        return Promise.resolve({ data, error: state.fail ? new Error("Unavailable") : null }).then(resolve, reject);
      },
    };
  } };
  return { client, calls, state };
}

// Matches the route, dashboard, profile, finance, roster and deals call chains.
async function dashboardReads(client, userId) {
  await requireVenueAccess(client, userId, "view_dashboard");
  await Promise.all([
    (async () => { await requireVenueAccess(client, userId); await getVenueAccess(client, userId); await requireVenueAccess(client, userId, "view_deals"); })(),
    requireVenueAccess(client, userId, "view_finance"),
    requireVenueAccess(client, userId, "view_roster"),
  ]);
}

for (const [role, perRead] of [["owner", 2], ["manager", 4]]) {
  test(`${role}: six dashboard access chains become one without skipping service permissions`, async () => {
    const before = fixture(role); await dashboardReads(before.client, "actor");
    assert.equal(before.calls.length, perRead * 6);
    const after = fixture(role);
    await withVenueAccessReadScope(after.client, "actor", () => dashboardReads(after.client, "actor"));
    assert.equal(after.calls.length, perRead);
  });
}

test("permission rejection still applies to a shared staff access result", async () => {
  const f = fixture("staff");
  await withVenueAccessReadScope(f.client, "staff", async () => {
    await requireVenueAccess(f.client, "staff", "view_dashboard");
    await assert.rejects(requireVenueAccess(f.client, "staff", "view_finance"), /does not allow/);
  });
  assert.equal(f.calls.length, 4);
});

test("concurrent requests, users and clients never share authorization", async () => {
  const f = fixture();
  await Promise.all([1, 2].map(() => withVenueAccessReadScope(f.client, "actor", () => dashboardReads(f.client, "actor"))));
  assert.equal(f.calls.length, 4);
  const other = fixture();
  await withVenueAccessReadScope(f.client, "actor", async () => {
    await getVenueAccess(f.client, "actor");
    await getVenueAccess(f.client, "another-actor");
    await getVenueAccess(other.client, "actor");
  });
  assert.equal(f.calls.length, 8); assert.equal(other.calls.length, 2);
});

test("the next request and unscoped mutations recheck revoked access; failures remain fail-closed", async () => {
  const f = fixture();
  await withVenueAccessReadScope(f.client, "actor", () => getVenueAccess(f.client, "actor"));
  f.state.active = false;
  await assert.rejects(withVenueAccessReadScope(f.client, "actor", () => requireVenueAccess(f.client, "actor")), /active venue account/);
  await assert.rejects(requireVenueAccess(f.client, "actor"), /active venue account/);
  f.state.active = true; f.state.fail = true;
  await assert.rejects(withVenueAccessReadScope(f.client, "actor", () => dashboardReads(f.client, "actor")), /Unavailable/);
  f.state.fail = false;
  assert.ok(await withVenueAccessReadScope(f.client, "actor", () => getVenueAccess(f.client, "actor")));
});
