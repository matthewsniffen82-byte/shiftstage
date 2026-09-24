import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
function compile(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => dependencies[name] || require(name), Date, Map, Set, URL, Request, Response });
  return exports;
}
const service = compile("../src/lib/dancr/dancer-audience-analytics.ts", {
  "./media-delivery-url.ts": {
    dancerPhotoDeliveryUrl: path => "/photo?path=" + path,
    dancerVideoDeliveryUrl: id => "/video?id=" + id,
  },
});
const { DancerAnalyticsPanel } = compile("../app/dashboard/DancerAnalyticsPanel.tsx", { "./dashboard-session": {} });
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
  return { calls, from(table) {
    const call = { table, filters: [], fields: "", options: {}, offset: 0, end: 999, single: false };
    calls.push(call);
    const query = {
      select(fields, options = {}) { call.fields = fields; call.options = options; return query; },
      eq(key, value) { call.filters.push([key, "eq", value]); return query; },
      gte(key, value) { call.filters.push([key, "gte", value]); return query; },
      lt(key, value) { call.filters.push([key, "lt", value]); return query; },
      range(offset, end) { call.offset = offset; call.end = end; return query; },
      order(key) { call.order = key; return query; },
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
          return op === "eq" ? actual === value : op === "gte" ? actual >= value : actual < value;
        }));
        const count = data.length;
        if (call.order) data = [...data].sort((a, b) => String(a[call.order]).localeCompare(String(b[call.order])));
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

test("a new account does not compare against time before the profile existed", async () => {
  const rows = fixture(); rows.dancer_profiles[0].created_at = daysAgo(10);
  const result = await service.getOwnDancerAudienceAnalytics(database(rows), "owner", "7d", now);
  assert.equal(result.profileViews.previous, null);
  assert.equal(result.socialLinkTaps.previous, null);
});

test("missing ownership fails before reading activity, and query failures are not shown as zero", async () => {
  const db = database(fixture());
  await assert.rejects(service.getOwnDancerAudienceAnalytics(db, "unknown", "7d", now), /profile not found/);
  assert.equal(db.calls.length, 1);
  await assert.rejects(service.getOwnDancerAudienceAnalytics(database(fixture(), "media_likes"), "owner", "7d", now), /database unavailable/);
});

test("empty activity returns real zeroes with no invented rank or top content", async () => {
  const rows = fixture();
  for (const key of Object.keys(rows)) if (key !== "dancer_profiles") rows[key] = [];
  const result = await service.getOwnDancerAudienceAnalytics(database(rows), "owner", "7d", now);
  assert.equal(result.currentRank, null);
  assert.equal(result.topContent.length, 0);
  assert.equal(result.profileViews.value, 0);
  const html = renderToStaticMarkup(React.createElement(DancerAnalyticsPanel, { initialAnalytics: result }));
  assert.match(html, /Your activity will appear here/);
  assert.doesNotMatch(html, /Unranked|City rank|Club Deal|Cashier|Weekly results|milestones/);
});

test("analytics rendering contains four cards, two compact sections, real rank and safe comparisons", async () => {
  const result = await service.getOwnDancerAudienceAnalytics(database(fixture()), "owner", "7d", now);
  result.profileViews = { value: 12, previous: 0 };
  result.socialLinkTaps = { value: 5, previous: 10 };
  const html = renderToStaticMarkup(React.createElement(DancerAnalyticsPanel, { initialAnalytics: result }));
  assert.equal((html.match(/class="dancer-analytics-metric"/g) || []).length, 4);
  for (const text of ["Profile views", "New followers", "Content likes", "Social link taps", "Your audience", "Top content", "City rank #4", "+12 vs prior 7 days", "−50% vs prior 7 days"]) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Infinity|NaN|<details|Unranked/);
});

test("only supported analytics periods are accepted", () => {
  assert.equal(service.dancerAnalyticsPeriod(null), "7d");
  assert.equal(service.dancerAnalyticsPeriod("30d"), "30d");
  assert.throws(() => service.dancerAnalyticsPeriod("365d"), /7-day or 30-day/);
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
