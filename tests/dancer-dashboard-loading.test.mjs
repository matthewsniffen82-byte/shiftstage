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
  DashboardStyles: () => null,
  DashboardSignInRecovery: () => React.createElement("button", null, "Sign in"), retryDashboard: () => {},
});
const renderHeader = (state, isLoading) => renderToStaticMarkup(React.createElement(header.Header, { state, isLoading }));

test("initial and cached-account loading states show no placeholder dashboard", () => {
  for (const state of [{}, { account: { displayName: "Account Name", accountState: "approved" } }]) {
    const html = renderHeader(state, true);
    assert.match(html, /class="dashboard-sr-only" role="status"/);
    assert.doesNotMatch(html, /dashboard-head|dancer-dashboard-avatar|Complete your profile|Account Name|dashboard-live-status|Loading your dashboard…/);
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

test("the complete initial dancer page contains only an accessible loading announcement", () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => {
    if (name === "react" || name === "react/jsx-runtime") return require(name);
    return new Proxy(() => null, { get: (_target, key) => key === "__esModule" ? false : () => null });
  } });
  const html = renderToStaticMarkup(React.createElement(exports.default, { role: "dancer" })).replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.match(html, /aria-busy="true"/);
  assert.equal((html.match(/role="status"/g) || []).length, 1);
  assert.doesNotMatch(html, /dashboard-head|loading-row|loading-command|loading-metrics|dashboard-grid|Complete your profile|Loading your dashboard…/);
});

test("the paused page exposes account controls without onboarding or active dancer tools", () => {
  const exports = {};
  let stateIndex = 0;
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => {
    if (name === "react") return { ...React, useState(initial) {
      const index = stateIndex++;
      return React.useState(index === 0 ? {
        account: { role: "dancer", accountState: "disabled", email: "fixture@example.test" },
        profile: null, agentAccess: { active: true },
      } : index === 1 ? false : initial);
    } };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/dynamic") return { default: () => () => null };
    return new Proxy(() => null, { get: (_target, key) => key === "__esModule" ? false : () => null });
  } });
  const html = renderToStaticMarkup(React.createElement(exports.default, { role: "dancer" })).replace(/<style>[\s\S]*?<\/style>/g, "");
  assert.match(html, /<h1>Dancer dashboard<\/h1>/);
  assert.match(html, /Account paused/);
  assert.match(html, /id="dancer-account"[^>]*open=""/);
  assert.match(html, /Reactivate account/);
  assert.match(html, />Reactivate<\/button>/);
  assert.match(html, /fixture@example.test/);
  assert.doesNotMatch(html, /Complete your profile|dancer-schedule|dancer-profile-media|agent-dashboard-shortcut|dashboard-live-status/);
});
