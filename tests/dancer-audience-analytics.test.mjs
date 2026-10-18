import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as scoring from "../src/lib/dancr/venue-dancer-scores.ts";

const require = createRequire(import.meta.url);
function compile(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => dependencies[name] || require(name), Date, Map, Set, URL, Request, Response });
  return exports;
}
const service = compile("../src/lib/dancr/dancer-audience-analytics.ts", {
  "./schedule.ts": compile("../src/lib/dancr/schedule.ts"),
  "./media-delivery-url.ts": {
    dancerPhotoDeliveryUrl: path => "/photo?path=" + path,
    dancerVideoDeliveryUrl: id => "/video?id=" + id,
  },
});
const { DancerAnalyticsPanel } = compile("../app/dashboard/DancerAnalyticsPanel.tsx", { "./dashboard-session": {},
  "./DancerRequestDialog": compile("../app/dashboard/DancerRequestDialog.tsx", {"./dashboard-session":{}}),
  "./DancerResultsTrend": compile("../app/dashboard/DancerResultsTrend.tsx"),
  "./dancer-results.css": {},
  "./DancerDiscoveryBoosts": compile("../app/dashboard/DancerDiscoveryBoosts.tsx", {"./dashboard-session":{},"@/src/lib/dancr/venue-dancer-scores":scoring}) });
const now = new Date("2026-09-23T12:00:00Z");
const daysAgo = days => new Date(now.getTime() - days * 86400000).toISOString();
function fixture() {
  return {
    dancer_profiles: [{ id: "mine", user_id: "owner", created_at: daysAgo(90) }, { id: "other", user_id: "someone-else", created_at: daysAgo(90) }],
    profile_views: [0, 1, 7, 8, 14, 30, 60].map((day, i) => ({ id: i, dancer_id: "mine", viewed_at: daysAgo(day) })).concat({ dancer_id: "other", viewed_at: daysAgo(1) }),
    social_clicks: [1, 1, 3, 8].map(day => ({ dancer_id: "mine", clicked_at: daysAgo(day) })),
    follows: [{ dancer_id: "mine", created_at: daysAgo(2), notifications_enabled: true }, { dancer_id: "mine", created_at: daysAgo(40), notifications_enabled: false }, { dancer_id: "other", created_at: daysAgo(1), notifications_enabled: true }],
    dancer_photos: [{ id: "photo-1", dancer_id: "mine", storage_path: "mine/photo.jpg" }, { id: "private-photo", dancer_id: "other", storage_path: "other/photo.jpg" }],
    mydancr_tv_videos: [{ id: "video-1", dancer_id: "mine", caption: "Friday night", moderation_details: { posterStoragePath: "poster.jpg" } }],
    media_likes: [
      ...Array.from({ length: 1005 }, (_, i) => ({ id: `like-${String(i).padStart(5, "0")}`, photo_id: "photo-1", created_at: daysAgo(1) })),
      { id: "older", photo_id: "photo-1", created_at: daysAgo(8) },
      { id: "video-like", video_id: "video-1", created_at: daysAgo(1) },
      { id: "private", photo_id: "private-photo", created_at: daysAgo(1) },
    ],
    mydancr_tv_events: [
      { id: "view-1", video_id: "video-1", event_type: "engaged_view", occurred_at: daysAgo(1) },
      { id: "view-2", video_id: "video-1", event_type: "impression", occurred_at: daysAgo(1) },
      { id: "view-3", video_id: "video-1", event_type: "engaged_view", occurred_at: daysAgo(8) },
    ],
    trending_scores: [{ dancer_id: "mine", rank: 4 }],
  };
}
function database(rows, failTable) {
  const calls = [];
  return { calls, async rpc(name, params) {
    calls.push({ table: name, params, fields: "" });
    if (name === "get_dancer_activity_trend") {
      assert.equal(params.p_dancer_id, "mine");
      if (failTable === name) return { error: new Error("trend unavailable") };
      return { data: [{ start: params.p_since, end: params.p_until, views: 2, followers: 1, requests: 0 }] };
    }
    assert.equal(name, "get_dancer_performance_analytics"); assert.equal(params.p_dancer_id, "mine");
    if (failTable === name) return { error: new Error("performance unavailable") };
    const counts = Object.fromEntries(["tableRequests","tablePending","tableAcknowledged","tableCompleted","tableCancelled","vipRequests","vipPending","vipConfirmed","vipDeclined","vipCancelled","repeatVips"].map(key=>[key,0]));
    return { data: { current: counts, previous: { ...counts }, external: { claims: 0, admissions: 0 },
      alerts: { total: rows.follows?.length ? 1 : 0, vip: 0 }, clubs: rows.performanceClubs || [], shifts: rows.performanceShifts || [], workTrackingStartedAt: null } };
  }, from(table) {
    const call = { table, filters: [], fields: "", options: {}, offset: 0, end: 999, single: false };
    calls.push(call);
    const query = {
      select(fields, options = {}) { call.fields = fields; call.options = options; return query; },
      eq(key, value) { call.filters.push([key, "eq", value]); return query; },
      is(key, value) { call.filters.push([key, "eq", value]); return query; },
      neq(key, value) { call.filters.push([key, "neq", value]); return query; },
      gt(key, value) { call.filters.push([key, "gt", value]); return query; },
      lte(key, value) { call.filters.push([key, "lte", value]); return query; },
      ilike(key, value) { call.filters.push([key, "ilike", value]); return query; },
      gte(key, value) { call.filters.push([key, "gte", value]); return query; },
      lt(key, value) { call.filters.push([key, "lt", value]); return query; },
      range(offset, end) { call.offset = offset; call.end = end; return query; },
      limit(value) { call.end = value - 1; return query; },
      order(key, {ascending=true}={}) { call.order = key; call.ascending=ascending; return query; },
      maybeSingle() { call.single = true; return query; },
      then(resolve, reject) {
        if (table === failTable) return Promise.resolve({ error: new Error("database unavailable") }).then(resolve, reject);
        let data = (rows[table] || []).filter(row => call.filters.every(([key, op, value]) => {
          let actual = row[key];
          if (key.includes(".")) {
            const [parent, field] = key.split(".");
            const foreignKey = parent === "dancer_photos" ? "photo_id" : "video_id";
            actual = rows[parent]?.find(item => item.id === row[foreignKey])?.[field];
          }
          return op === "ilike" ? String(actual).toLowerCase() === value.toLowerCase() : op === "eq" ? actual === value : op === "neq" ? actual !== value : op === "gt" ? actual > value : op === "lte" ? actual != null && actual <= value : op === "gte" ? actual >= value : actual < value;
        }));
        const count = data.length;
        if (call.order) data = [...data].sort((a, b) => (call.ascending ? 1 : -1) * String(a[call.order]).localeCompare(String(b[call.order])));
        data = data.slice(call.offset, call.end + 1);
        return Promise.resolve({ data: call.options.head ? null : call.single ? data[0] || null : data, count, error: null }).then(resolve, reject);
      },
    };
    return query;
  } };
}

test("7-day analytics scope every metric to the owner, use disjoint periods, and page likes beyond 1,000", async () => {
  const db = database(fixture());
  const result = await service.getOwnDancerAudienceAnalytics(db, "owner", "7d", now);
  assert.equal(result.profileViews.value, 2); // Day 7 included, end instant excluded.
  assert.equal(result.profileViews.previous, 2); // Day 14 included, day 7 excluded.
  assert.equal(result.socialLinkTaps.value, 3);
  assert.equal(result.socialLinkTaps.previous, 1);
  assert.equal(result.newFollowers.value, 1);
  assert.equal(result.contentLikes.value, 1006);
  assert.equal(result.contentLikes.previous, null);
  assert.equal(result.newFollowers.previous, null);
  assert.equal(result.audience.totalFollowers, 2);
  assert.equal(result.audience.workingNowSubscribers, 1);
  assert.equal(result.currentRank, 4);
  assert.equal(result.topContent.find(item => item.kind === "video").views, 1);
  assert.equal(result.topContent.find(item => item.kind === "photo").likes, 1005);
  assert.ok(db.calls.some(call => call.table === "media_likes" && call.offset === 1000));
  assert.ok(db.calls.every(call => !/visitor|session|viewer/.test(call.fields)));
  assert.ok(!JSON.stringify(result).includes("private-photo"));
  assert.ok(!JSON.stringify(result).includes("other/photo"));
});

test("30-day analytics use a matching prior 30 days and update content rankings", async () => {
  const result = await service.getOwnDancerAudienceAnalytics(database(fixture()), "owner", "30d", now);
  assert.equal(result.periodStart, daysAgo(30));
  assert.equal(result.profileViews.value, 5);
  assert.equal(result.profileViews.previous, 1);
  assert.equal(result.contentLikes.value, 1007);
  assert.equal(result.topContent.find(item => item.kind === "video").views, 2);
});

test("Tonight scopes activity and the performance RPC to the dancer's local window through now", async () => {
  const rows = fixture();
  rows.dancer_profiles[0].city = "New York";
  rows.venues = [{ name: "Other city", city: "Las Vegas", timezone: "America/Los_Angeles", is_active: true },
    { name: "Closed", city: "New York", timezone: "UTC", is_active: false },
    { name: "Local club", city: "new york", timezone: "America/New_York", is_active: true }];
  const start = "2026-09-23T04:01:00.000Z";
  rows.profile_views = ["2026-09-23T04:00:59.999Z", start, "2026-09-23T06:00:00.000Z", now.toISOString()]
    .map(viewed_at => ({ dancer_id: "mine", viewed_at })).concat({ dancer_id: "other", viewed_at: start });
  rows.social_clicks.push({ dancer_id: "mine", clicked_at: start });
  rows.follows.push({ dancer_id: "mine", created_at: start });
  rows.media_likes.push({ id: "tonight-photo", photo_id: "photo-1", created_at: start });
  rows.mydancr_tv_events.push({ id: "tonight-video", video_id: "video-1", event_type: "engaged_view", occurred_at: start });
  const db = database(rows);
  const result = await service.getOwnDancerAudienceAnalytics(db, "owner", "tonight", now);
  assert.equal(result.period, "tonight");
  assert.equal(result.periodStart, start);
  assert.equal(result.periodEnd, now.toISOString());
  assert.equal(result.profileViews.value, 2);
  assert.equal(result.socialLinkTaps.value, 1);
  assert.equal(result.newFollowers.value, 1);
  assert.equal(result.contentLikes.value, 1);
  assert.equal(result.topContent.find(item => item.kind === "video").views, 1);
  assert.equal(result.profileViews.previous, null);
  assert.equal(result.performance.previous, null);
  const params = db.calls.find(call => call.table === "get_dancer_performance_analytics").params;
  assert.deepEqual({ ...params }, { p_dancer_id: "mine", p_since: start, p_until: now.toISOString() });
  assert.equal(db.calls.filter(call => call.table === "profile_views").length, 1);
});

test("Tonight handles timezone fallbacks, the local rollover, and daylight saving changes", async () => {
  for (const [timestamp, expected] of [
    ["2026-09-23T06:00:00Z", "2026-09-22T07:01:00.000Z"],
    ["2026-09-23T07:00:30Z", "2026-09-22T07:01:00.000Z"],
    ["2026-09-23T07:01:00Z", "2026-09-22T07:01:00.000Z"],
    ["2026-09-23T07:01:01Z", "2026-09-23T07:01:00.000Z"],
    ["2026-11-01T12:00:00Z", "2026-11-01T07:01:00.000Z"],
    ["2026-03-08T12:00:00Z", "2026-03-08T08:01:00.000Z"],
  ]) {
    const result = await service.getOwnDancerAudienceAnalytics(database(fixture()), "owner", "tonight", new Date(timestamp));
    assert.equal(result.periodStart, expected, timestamp);
    assert.ok(result.periodStart < result.periodEnd);
  }
  const rows = fixture(); rows.dancer_profiles[0].city = "No clubs yet";
  const result = await service.getOwnDancerAudienceAnalytics(database(rows), "owner", "tonight", now);
  assert.equal(result.periodStart, "2026-09-23T07:01:00.000Z");
  await assert.rejects(service.getOwnDancerAudienceAnalytics(database(rows, "venues"), "owner", "tonight", now), /database unavailable/);
});

test("a new account does not compare against time before the profile existed", async () => {
  const rows = fixture(); rows.dancer_profiles[0].created_at = daysAgo(10);
  const result = await service.getOwnDancerAudienceAnalytics(database(rows), "owner", "7d", now);
  assert.equal(result.profileViews.previous, null);
  assert.equal(result.socialLinkTaps.previous, null);
  assert.equal(result.performance.previous, null);
});

test("missing ownership fails before reading activity, and query failures are not shown as zero", async () => {
  const db = database(fixture());
  await assert.rejects(service.getOwnDancerAudienceAnalytics(db, "unknown", "7d", now), /profile not found/);
  assert.equal(db.calls.length, 1);
  await assert.rejects(service.getOwnDancerAudienceAnalytics(database(fixture(), "media_likes"), "owner", "7d", now), /database unavailable/);
  await assert.rejects(service.getOwnDancerAudienceAnalytics(database(fixture(), "get_dancer_performance_analytics"), "owner", "7d", now), /performance unavailable/);
});

test("empty activity returns real zeroes with no invented rank or top content", async () => {
  const rows = fixture();
  for (const key of Object.keys(rows)) if (key !== "dancer_profiles") rows[key] = [];
  const result = await service.getOwnDancerAudienceAnalytics(database(rows), "owner", "7d", now);
  assert.equal(result.currentRank, null);
  assert.equal(result.topContent.length, 0);
  assert.equal(result.profileViews.value, 0);
  const html = renderToStaticMarkup(React.createElement(DancerAnalyticsPanel, { initialAnalytics: result }));
  assert.match(html, /Your results will appear here/);
  assert.doesNotMatch(html, /Unranked|City rank|Club Deal|Cashier|Weekly results|milestones/);
});

test("results lead with four demand cards and retain audience growth, content and safe comparisons", async () => {
  const result = await service.getOwnDancerAudienceAnalytics(database(fixture()), "owner", "7d", now);
  result.profileViews = { value: 12, previous: 0 };
  result.contentLikes = { value: 5, previous: 10 };
  result.socialLinkTaps = { value: 5, previous: 10 };
  const html = renderToStaticMarkup(React.createElement(DancerAnalyticsPanel, { initialAnalytics: result }));
  assert.equal((html.match(/class="dancer-analytics-metric"/g) || []).length, 7);
  for (const text of ["Table requests", "VIP requests", "Returning VIP requesters", "Verified entries", "New followers", "Results by shift", "Recorded working time", "All clubs"]) assert.ok(html.includes(text), text);
  assert.ok(html.indexOf("Table requests") < html.indexOf("Profile views"));
  for (const text of ["Profile views", "New followers", "Content likes", "Your audience", "Top content", "City activity rank #4", "Your performance score", "+12 vs prior 7 days", "−50% vs prior 7 days"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Social link taps|Infinity|NaN|Unranked/);
});

test("only supported analytics periods are accepted", () => {
  assert.equal(service.dancerAnalyticsPeriod(null), "7d");
  assert.equal(service.dancerAnalyticsPeriod("tonight"), "tonight");
  assert.equal(service.dancerAnalyticsPeriod("30d"), "30d");
  assert.equal(service.dancerAnalyticsPeriod("all"), "all");
  assert.throws(() => service.dancerAnalyticsPeriod("365d"), /All time/);
});

test("All time starts at profile creation with full timestamp precision and no prior comparisons", async () => {
  const rows = fixture(); rows.dancer_profiles[0].created_at = "2026-06-25T12:00:00.123456Z";
  const db = database(rows);
  const result = await service.getOwnDancerAudienceAnalytics(db, "owner", "all", now);
  assert.equal(result.periodStart, rows.dancer_profiles[0].created_at);
  assert.equal(result.profileViews.value, 6);
  assert.equal(result.profileViews.previous, null);
  assert.equal(result.performance.previous, null);
  assert.equal(result.newFollowers.value, 2);
  assert.equal(result.trend.length, 1);
  assert.equal(db.calls.find(call => call.table === "get_dancer_performance_analytics").params.p_since, result.periodStart);
  await assert.rejects(service.getOwnDancerAudienceAnalytics(database(rows, "get_dancer_activity_trend"), "owner", "all", now), /trend unavailable/);
});

function routes({ denied = false } = {}) {
  const calls = [], admin = { admin: true };
  const dependencies = {
    "next/server": { NextResponse: Response },
    "@/src/lib/api": { apiError: error => Response.json({ ok: false, error: error.message }, { status: 401 }) },
    "@/src/lib/dancr/auth": { getAccountByUserId: async () => ({ role: "dancer", accountState: "active" }) },
    "@/src/lib/dancr/ondato": { getDancerAgeVerification: async () => ({ required: false }) },
    "@/src/lib/dancr/dancer-agreement": { getDancerAgreementAccess: async () => ({ accepted: true }) },
    "@/src/lib/dancr/customer-follow-notifications": { broadcastFollowedClubRosterAddition: async () => {} },
    "@/src/lib/dancr/nfc": { finalizePendingDancerNfcEnrollment: async () => null, getDancerNfcDashboardState: async () => ({ affiliations: [] }) },
    "@/src/lib/security/safe-error-metadata": { safeErrorMetadata: () => ({}) },
    "@/src/lib/dancr/deals": { getDancerDealMetrics: async () => { calls.push("legacy-deals"); return { redeemed: 1 }; } },
    "@/src/lib/dancr/dancer": { getOwnDancerDashboardAnalytics: async () => { calls.push("legacy-analytics"); return { profileViews30Days: 50 }; } },
    "@/src/lib/dancr/dancer-audience-analytics": {
      dancerAnalyticsPeriod: service.dancerAnalyticsPeriod,
      getOwnDancerAudienceAnalytics: async (client, userId, period) => { assert.equal(client, admin); assert.equal(userId, "authenticated-owner"); calls.push(period); return { period }; },
    },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => admin },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async (_request, access) => {
      if (access) assert.equal(access.role, "dancer");
      if (denied) throw new Error("Sign in required.");
      return { client: {}, user: { id: "authenticated-owner" } };
    } },
  };
  return { calls, analytics: compile("../app/api/dancer/analytics/route.ts", dependencies), dashboard: compile("../app/api/dancer/dashboard/route.ts", dependencies) };
}

for (const endpoint of ["analytics", "dashboard"]) {
  test(`${endpoint} accepts All time for the authenticated dancer only`, async () => {
    const route = routes();
    const response = await route[endpoint].GET(new Request(`https://mydancr.test/api/dancer/${endpoint}?period=all&dancerId=someone-else`));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).analytics.period, "all");
    assert.deepEqual(route.calls, ["all"]);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  });
  test(`${endpoint} accepts Tonight without changing ownership or cache protection`, async () => {
    const route = routes();
    const response = await route[endpoint].GET(new Request(`https://mydancr.test/api/dancer/${endpoint}?period=tonight&dancerId=someone-else`));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).analytics.period, "tonight");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(route.calls, ["tonight"]);
  });
  test(`${endpoint} serves the requested period only for the authenticated owner and skips legacy deal queries`, async () => {
    const route = routes();
    const response = await route[endpoint].GET(new Request(`https://mydancr.test/api/dancer/${endpoint}?period=30d&dancerId=someone-else`));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).analytics.period, "30d");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(route.calls, ["30d"]);
  });
  test(`${endpoint} rejects unsupported periods and unauthenticated reads without querying analytics`, async () => {
    const route = routes();
    assert.equal((await route[endpoint].GET(new Request(`https://mydancr.test/api/dancer/${endpoint}?period=365d`))).status, 400);
    assert.deepEqual(route.calls, []);
    const denied = routes({ denied: true });
    assert.equal((await denied[endpoint].GET(new Request(`https://mydancr.test/api/dancer/${endpoint}?period=7d`))).status, 401);
    assert.deepEqual(denied.calls, []);
  });
  test(`${endpoint} keeps the established response for older clients without a period`, async () => {
    const route = routes();
    const response = await route[endpoint].GET(new Request(`https://mydancr.test/api/dancer/${endpoint}`));
    const data = await response.json();
    assert.equal(data.analytics.profileViews30Days, 50);
    assert.ok(route.calls.includes("legacy-analytics"));
    if (endpoint === "dashboard") assert.equal(data.deals.redeemed, 1);
  });
}

function liveShift(overrides={}) {
  return {id:'shift-live',dancer_id:'mine',venue_id:'club-a',venues:{name:'Club A'},timezone:'America/New_York',
    checked_in_at:'2026-09-23T10:00:00.000Z',checked_out_at:null,status:'scheduled',location_status:'club_confirmed',
    location_verification_expires_at:'2026-09-23T16:00:00.000Z',...overrides};
}

test('automatic analytics uses actual check-in time across midnight and scopes requests to that club',async()=>{
  const rows=fixture();const startedAt='2026-09-23T02:00:00.000Z';
  rows.shifts=[liveShift({checked_in_at:startedAt})];
  rows.profile_views=[{dancer_id:'mine',viewed_at:'2026-09-23T01:59:59.999Z'},
    {dancer_id:'mine',viewed_at:startedAt},{dancer_id:'mine',viewed_at:'2026-09-23T09:00:00.000Z'},
    {dancer_id:'other',viewed_at:startedAt}];
  rows.performanceClubs=[{id:'club-a',name:'Club A',current:{tableRequests:4,vipRequests:2,repeatVips:1},external:{claims:1,admissions:0},roster:{checkIns:1,recordedHours:3}},
    {id:'club-b',name:'Club B',current:{tableRequests:90},external:{claims:20,admissions:10}}];
  rows.performanceShifts=[{venueId:'club-a',id:'mine'},{venueId:'club-b',id:'elsewhere'}];
  const db=database(rows),result=await service.getOwnDancerAudienceAnalytics(db,'owner','auto',now);
  assert.equal(result.period,'shift');assert.equal(result.periodStart,startedAt);
  assert.equal(result.timezone,'America/New_York');assert.equal(result.activeShift.venueName,'Club A');
  assert.equal(result.profileViews.value,2);assert.equal(result.profileViews.previous,null);
  assert.equal(result.performance.current.tableRequests,4);assert.equal(result.performance.previous,null);
  assert.equal(result.performance.clubs.length,1);assert.equal(result.performance.shifts.length,1);
  assert.equal(result.performance.roster,rows.performanceClubs[0].roster);
  for(const rpc of db.calls.filter(call=>call.params)) assert.equal(rpc.params.p_since,startedAt);
  assert.ok(db.calls.find(call=>call.table==='shifts').filters.some(([key,op,value])=>key==='dancer_id'&&value==='mine'));
});

test('off-shift, expired, checked-out, cancelled and other-owner sessions fall back to seven days',async()=>{
  for(const shifts of [[],[liveShift({dancer_id:'other'})],[liveShift({checked_out_at:'2026-09-23T11:00:00.000Z'})],
    [liveShift({status:'cancelled'})],[liveShift({location_status:'unverified'})],
    [liveShift({location_verification_expires_at:now.toISOString()})],[liveShift({checked_in_at:'2026-09-23T13:00:00.000Z'})]]) {
    const rows=fixture();rows.shifts=shifts;
    for(const selection of ['auto','shift']) {
      const result=await service.getOwnDancerAudienceAnalytics(database(rows),'owner',selection,now);
      assert.equal(result.period,'7d');assert.equal(result.activeShift,null);assert.equal(result.periodStart,daysAgo(7));
    }
  }
});

test('shift lookup failures surface as errors and explicit historical ranges stay intact while working',async()=>{
  await assert.rejects(service.getOwnDancerAudienceAnalytics(database(fixture(),'shifts'),'owner','auto',now),/database unavailable/);
  const rows=fixture();rows.shifts=[liveShift()];
  const result=await service.getOwnDancerAudienceAnalytics(database(rows),'owner','30d',now);
  assert.equal(result.period,'30d');assert.equal(result.periodStart,daysAgo(30));assert.equal(result.activeShift.id,'shift-live');
});

for(const endpoint of ['analytics','dashboard']) for(const period of ['auto','shift']) {
  test(endpoint+' accepts '+period+' while retaining authenticated ownership and private caching',async()=>{
    const route=routes();const response=await route[endpoint].GET(new Request('https://mydancr.test/api/dancer/'+endpoint+'?period='+period+'&dancerId=someone-else'));
    assert.equal(response.status,200);assert.deepEqual(route.calls,[period]);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
  });
}
