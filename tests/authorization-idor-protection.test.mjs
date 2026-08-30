import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  requirePublicDancersAtVenue,
  requirePublicShiftForDancer,
} from "../src/lib/dancr/resource-authorization.ts";

const [
  favoriteRoute,
  followRoute,
  venueFollowRoute,
  directionRoute,
  eventRoute,
  venueEventRoute,
  tvService,
  notificationService,
  supportService,
  venueTeamService,
  dancerService,
  shiftRoute,
  dmcaService,
] = await Promise.all([
  read("../app/api/customer/favorites/route.ts"),
  read("../app/api/customer/follows/route.ts"),
  read("../app/api/customer/venue-follows/route.ts"),
  read("../app/api/customer/directions/route.ts"),
  read("../app/api/events/route.ts"),
  read("../app/api/public/venue-events/route.ts"),
  read("../src/lib/dancr/tv.ts"),
  read("../src/lib/dancr/notifications.ts"),
  read("../src/lib/dancr/support.ts"),
  read("../src/lib/dancr/venue-team.ts"),
  read("../src/lib/dancr/dancer.ts"),
  read("../app/api/dancer/shifts/route.ts"),
  read("../src/lib/dancr/dmca.ts"),
]);

test("customer resource writes verify server-side public targets before mutating", () => {
  assertGuardBefore(favoriteRoute, "requirePublicDancer(createAdminSupabaseClient(), dancerId)", "await favoriteDancer(client, user.id, dancerId)");
  assertGuardBefore(followRoute, "requirePublicDancer(createAdminSupabaseClient(), dancerId)", "await followDancer(client, user.id, dancerId)");
  assertGuardBefore(venueFollowRoute, "requirePublicVenue(createAdminSupabaseClient(), venueId)", '.from("venue_follows").upsert');
  assertGuardBefore(directionRoute, "requirePublicDancersAtVenue(adminClient, venueId, dancerIds)", "recordDirectionRequest(adminClient, user.id");
});

test("analytics identifiers are checked as related resources before privileged writes", () => {
  assert.match(eventRoute, /if \(shiftId\) await requirePublicShiftForDancer\(client, dancerId, shiftId\)/);
  assert.equal((eventRoute.match(/requirePublicDancersAtVenue\(client, venueId, dancerId \? \[dancerId\] : \[\]\)/g) || []).length, 2);
  assert.match(venueEventRoute, /requirePublicDancersAtVenue\(client, venueId, dancerId \? \[dancerId\] : \[\]\)/);
  assert.match(eventRoute, /\.eq\("verification_status", "approved"\)/);
  assert.match(eventRoute, /\.is\("disabled_at", null\)/);
});

test("dancer-owned video transitions repeat ownership on the final privileged update", () => {
  const submission = tvService.match(/export async function submitMyDancrTvUpload[\s\S]*?function videoModerationErrorCode/)?.[0] || "";
  const removal = tvService.match(/export async function hideOwnMyDancrTvVideo[\s\S]*?export async function getAdminMyDancrTvVideos/)?.[0] || "";
  assert.match(submission, /\.update\([\s\S]*?\.eq\("id", video\.id\)\s*\.eq\("submitted_by", userId\)\s*\.eq\("status", "uploading"\)/);
  assert.match(removal, /\.update\(\{ status: "hidden", venue_featured: false \}\)\s*\.eq\("id", videoId\)\s*\.eq\("submitted_by", userId\)/);
});

test("existing user, dancer, and venue identifier operations remain ownership-scoped", () => {
  assert.match(notificationService, /\.eq\("id", notificationId\)\s*\.eq\("recipient_id", userId\)/);
  assert.match(supportService, /\.eq\("id", threadId\)\s*\.eq\("user_id", input\.userId\)/);
  assert.match(venueTeamService, /\.eq\("id", requiredId\(input\.memberId\)\)\s*\.eq\("venue_id", access\.venueId\)/);
  assert.match(venueTeamService, /\.eq\("id", requiredId\(input\.invitationId\)\)\s*\.eq\("venue_id", access\.venueId\)/);
  assert.match(dancerService, /\.eq\("id", photoId\)\s*\.eq\("dancer_id", profile\.id\)/);
  assert.match(shiftRoute, /\.eq\("id", shiftId\)\s*\.eq\("dancer_id", dancerId\)/);
  assert.match(dmcaService, /\.eq\("id", caseId\)\s*\.eq\("uploader_id", userId\)/);
});

test("batched dancer/venue authorization accepts only public scheduled relationships", async () => {
  const client = fakeClient({
    venues: [{ data: { id: "venue-a" }, error: null }],
    dancer_profiles: [{ data: [{ id: "dancer-a" }, { id: "dancer-b" }], error: null }],
    shifts: [{ data: [{ dancer_id: "dancer-a" }, { dancer_id: "dancer-b" }], error: null }],
  });
  const result = await requirePublicDancersAtVenue(
    client,
    "venue-a",
    ["dancer-a", "dancer-a", "dancer-b"],
    new Date("2026-08-29T12:00:00.000Z"),
  );
  assert.deepEqual(result, ["dancer-a", "dancer-b"]);
  assert.deepEqual(client.calls.filter((call) => call.table === "shifts" && call.method === "eq"), [
    { table: "shifts", method: "eq", args: ["venue_id", "venue-a"] },
    { table: "shifts", method: "eq", args: ["status", "posted"] },
  ]);
});

test("cross-venue and cross-dancer identifiers fail closed", async () => {
  const crossVenueClient = fakeClient({
    venues: [{ data: { id: "venue-a" }, error: null }],
    dancer_profiles: [{ data: [{ id: "dancer-a" }], error: null }],
    shifts: [{ data: [], error: null }],
  });
  await assert.rejects(
    requirePublicDancersAtVenue(crossVenueClient, "venue-a", ["dancer-a"]),
    (error) => error?.code === "NOT_FOUND" && error?.status === 404,
  );

  const crossDancerClient = fakeClient({
    shifts: [{ data: null, error: null }],
  });
  await assert.rejects(
    requirePublicShiftForDancer(crossDancerClient, "dancer-a", "shift-b"),
    (error) => error?.code === "NOT_FOUND" && error?.status === 404,
  );
});

function read(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

function assertGuardBefore(source, guard, mutation) {
  const guardIndex = source.indexOf(guard);
  const mutationIndex = source.indexOf(mutation);
  assert.ok(guardIndex >= 0, `Missing authorization guard: ${guard}`);
  assert.ok(mutationIndex > guardIndex, `Mutation must follow authorization guard: ${mutation}`);
}

function fakeClient(resultsByTable) {
  const calls = [];
  return {
    calls,
    from(table) {
      const result = resultsByTable[table]?.shift() || { data: null, error: null };
      return query(table, result, calls);
    },
  };
}

function query(table, result, calls) {
  const builder = {
    select(...args) { return record("select", args); },
    eq(...args) { return record("eq", args); },
    in(...args) { return record("in", args); },
    is(...args) { return record("is", args); },
    gt(...args) { return record("gt", args); },
    limit(...args) { return record("limit", args); },
    maybeSingle() { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(result); },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  function record(method, args) {
    calls.push({ table, method, args });
    return builder;
  }
  return builder;
}
