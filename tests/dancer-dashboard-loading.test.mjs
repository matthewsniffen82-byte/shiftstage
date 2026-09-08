import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { effectiveDancerProfileStatus } from "../src/lib/dancr/profile-approval.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8");
function compile(source, context = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require, ...context });
  return exports;
}
const identity = compile(readFileSync(new URL("../app/dashboard/DancerDashboardIdentity.tsx", import.meta.url), "utf8"));
const start = source.indexOf("  const title = useMemo(");
const end = source.indexOf("\n  return (", start);
const headerStart = source.indexOf("      <section className={", end);
const headerEnd = source.indexOf("\n      {isLoading &&", headerStart);
const header = compile('export function Header({state, isLoading, role = "dancer"}) {' + source.slice(start, end) + ' return (' + source.slice(headerStart, headerEnd).trim() + ');}', {
  useMemo: fn => fn(), dashboardName: profile => profile?.stage_name || "", homeDiscoveryHref: () => "/", effectiveDancerProfileStatus,
  DancerDashboardAvatar: identity.DancerDashboardAvatar, DashboardCloseButton: () => React.createElement("button", null, "Close"),
  DashboardSignInRecovery: () => React.createElement("button", null, "Sign in"), retryDashboard: () => {},
});
const renderHeader = (state, isLoading) => renderToStaticMarkup(React.createElement(header.Header, { state, isLoading }));

test("initial and cached-account loading states do not suggest incomplete or public profiles", () => {
  for (const state of [{}, { account: { displayName: "Account Name", accountState: "approved" } }]) {
    const html = renderHeader(state, true);
    assert.match(html, /Loading your dashboard…/);
    assert.match(html, /dancer-dashboard-avatar-placeholder/);
    assert.doesNotMatch(html, /Complete your profile|>CY<|>LY<|Account Name|dashboard-live-status/);
  }
});

test("a loaded stage name and avatar replace the loading identity", () => {
  const html = renderHeader({ profile: { stage_name: "Stacy", status: "approved", verification_status: "approved", avatarPhotoUrl: "/avatar.jpg", is_public: true } }, false);
  assert.match(html, /<h1>Stacy<\/h1>/);
  assert.match(html, /src="\/avatar.jpg"/);
  assert.match(html, /dashboard-live-status/);
  assert.doesNotMatch(html, /Loading your dashboard|Complete your profile|avatar-placeholder/);
});

test("missing identity is an onboarding prompt only after a successful load", () => {
  assert.match(renderHeader({ profile: { status: "draft" } }, false), /Complete your profile/);
  const failed = renderHeader({ error: "Sign in to open this dashboard." }, false);
  assert.match(failed, /<h1>Dancer dashboard<\/h1>/);
  assert.doesNotMatch(failed, /Complete your profile|>CY<|dashboard-live-status/);
});

test("dancer loading placeholders match compact cards and expose one loading announcement", () => {
  const html = renderToStaticMarkup(React.createElement(identity.DancerDashboardLoading));
  assert.equal((html.match(/class="dancer-dashboard-loading-row"/g) || []).length, 5);
  assert.equal((html.match(/aria-hidden="true"/g) || []).length, 5);
  assert.match(html, /role="status"/);
  assert.match(html, /min-height:88px/);
  assert.doesNotMatch(html, /venue-dashboard-loading-command|Complete your profile/);
});
