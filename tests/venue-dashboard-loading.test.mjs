import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function compile(source, imports) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  }, URL, window: { location: { hash: "" } } });
  return exports;
}

for (const denied of [false, true]) test(`summary ${denied ? "denies unauthorized access" : "opens without analytics or roster reads"}`, async () => {
  const calls = [];
  const route = compile(read("app/api/venue/dashboard/route.ts"), {
    "next/server": { NextResponse: Response },
    "@/src/lib/api": { apiError: () => Response.json({ ok: false }, { status: 403 }) },
    "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => ({ client: {}, user: { id: "owner" } }) },
    "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
    "@/src/lib/dancr/auth": { requireActiveVenueAccount: async () => calls.push("active") },
    "@/src/lib/dancr/venue-access": {
      withVenueAccessReadScope: (_client, _user, run) => run(),
      requireVenueAccess: async (_client, user, permission) => {
        assert.equal(user, "owner"); assert.equal(permission, "view_dashboard");
        calls.push("permission");
        if (denied) throw new Error("No access");
        return { venueId: "own-venue", role: "owner" };
      },
    },
    "@/src/lib/dancr/venue": {
      getVenueDashboardSummary: async () => { calls.push("summary"); return { profile: { id: "own-venue" }, deals: [{ isActive: true }] }; },
      getVenueDashboard: () => assert.fail("summary must not run historical analytics"),
      readVenueAnalyticsPeriod: () => assert.fail("summary needs no analytics period"),
    },
    "@/src/lib/dancr/venue-affiliations": { getVenueDancerVerificationState: () => assert.fail("summary must not read the roster") },
    "@/src/lib/dancr/venue-deal-requests": { getVenueClubDealRequests: () => assert.fail("summary must not read request history") },
  });
  const response = await route.GET(new Request("https://example.test/api/venue/dashboard?view=summary"));
  assert.equal(response.status, denied ? 403 : 200);
  assert.deepEqual(calls, denied ? ["active", "permission"] : ["active", "permission", "summary"]);
  if (!denied) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json();
    assert.equal(data.profile.id, "own-venue");
    assert.equal(data.deals[0].isActive, true);
    assert.equal(data.refreshedAt, undefined, "summary must not claim live data is ready");
  }
});

test("summary service retains publication data and only reads profile and deals after authorization", async () => {
  const source = read("src/lib/dancr/venue.ts");
  const summary = source.slice(source.indexOf("export async function getVenueDashboardSummary"), source.indexOf("export async function getVenueDashboard("));
  const calls = [], profile = { id: "own-venue", isActive: true }, deals = [{ id: "deal", isActive: true }];
  const compiled = ts.transpileModule(summary, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports,
    requireVenueAccess: async () => calls.push("authorized"),
    requireVenueForAccount: async () => { calls.push("profile"); return profile; },
    getVenueDealsForAccount: async () => { calls.push("deals"); return { deals }; },
    getVenuePublicationState: (actualProfile, actualDeals) => {
      assert.equal(actualProfile, profile); assert.equal(actualDeals, deals); return { isPublished: true };
    },
  });
  const data = await exports.getVenueDashboardSummary({}, "owner");
  assert.deepEqual(calls, ["authorized", "profile", "deals"]);
  assert.equal(data.profile, profile); assert.equal(data.deal, deals[0]);
  assert.equal(data.publication.isPublished, true);
});

const require = createRequire(import.meta.url);
function renderWorkspace(workspace, { opened = [], ready = true } = {}) {
  const mounted = [];
  let hook = 0;
  const component = name => function PanelStub(props) { mounted.push(name); return React.createElement("div", null, props.children); };
  const fallback = new Proxy({}, { get: (_target, name) => name === "__esModule" ? true : component(String(name)) });
  const exports = {};
  vm.runInNewContext(ts.transpileModule(read("app/dashboard/VenueDashboardPanels.tsx"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, { exports, require: name => {
    if (name === "react") return { ...React, useState(initial) {
      const index = hook++;
      return React.useState(index === 4 ? workspace : index === 5 ? opened : initial);
    } };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/dynamic") return { default: loader => component(loader.toString().match(/\.\/(\w+)/)[1]) };
    if (name === "./DashboardShared") return { ...fallback,
      formatVenueReviewHours: () => "8 PM–4 AM", formatDashboardDate: () => "Today",
      DashboardSection: component("DashboardSection"), Metric: component("Metric"),
      NotificationPanel: component("NotificationPanel"), SupportInboxPanel: component("SupportInboxPanel"),
      AccountControlsPanel: component("AccountControlsPanel"),
    };
    return fallback;
  }, window: { location: { hash: "" } } });
  const html = renderToStaticMarkup(React.createElement(exports.VenuePanel, {
    account: { id: "owner" }, profile: { id: "venue", name: "Venue", isActive: true },
    venueDeals: [{ id: "deal", isActive: true }], dealRequests: [], workingNow: [], initialAffiliations: [],
    venueAccess: { role: "owner", permissions: ["view_team"] },
    refreshedAt: ready ? new Date().toISOString() : null, analyticsPeriod: "30d", refreshStatus: "",
  }));
  return { mounted, html };
}

test("opening guests mounts neither hidden roster nor management tools", () => {
  const { mounted, html } = renderWorkspace("tonight", { ready: false });
  assert.ok(mounted.includes("VenueGuestListPanel"));
  assert.ok(mounted.includes("PickupDashboardPanel"));
  for (const name of ["VenueNfcTagPanel", "VenueTeamPanel", "VenueTvPanel", "NotificationPanel", "SupportInboxPanel"]) assert.ok(!mounted.includes(name), name);
  assert.match(html, />LIVE</);
  assert.doesNotMatch(html, /HIDDEN|0 working now|Analytics are unavailable/);
});

test("a linked roster waits for live data rather than displaying empty results", () => {
  const loading = renderWorkspace("roster", { ready: false });
  assert.match(loading.html, /Loading dancers and tables/);
  assert.ok(!loading.mounted.includes("VenueNfcTagPanel"));
  const ready = renderWorkspace("roster");
  assert.ok(ready.mounted.includes("VenueNfcTagPanel"));
  assert.ok(!ready.mounted.includes("VenueGuestListPanel"));
});

test("returning to guests preserves tools and drafts in a previously opened tab", () => {
  const { mounted } = renderWorkspace("tonight", { opened: ["roster"] });
  assert.ok(mounted.includes("VenueGuestListPanel"));
  assert.ok(mounted.includes("VenueNfcTagPanel"));
  assert.ok(!mounted.includes("VenueTeamPanel"));
});

test("results show a loading state until analytics arrive", () => {
  const { html, mounted } = renderWorkspace("business", { ready: false });
  assert.match(html, /Loading results/);
  assert.doesNotMatch(html, /Analytics are unavailable/);
  assert.ok(!mounted.includes("PickupDashboardPanel"));
});
