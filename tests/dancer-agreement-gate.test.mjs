import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as version from "../src/lib/dancr/dancer-agreement-version.ts";
import { loadAgreementComponent } from "./helpers/dancer-agreement-ui.mjs";

const require = createRequire(import.meta.url);
const agreementLink = loadAgreementComponent("DancerAgreementLink.tsx");
const source = readFileSync(new URL("../app/dashboard/DancerAgreementGate.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(agreement, checked = false, busy = false, profileSetupAllowed = false, pathname = "/dashboard/dancer", error = "") {
  const exports = {}; let state = 0;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return { ...React, useState: initial => [[agreement, checked, busy, error, 0, profileSetupAllowed][state++] ?? initial, () => {}], useEffect() {}, useRef: initial => ({ current: initial }) };
    if (name === "next/link") return { default: props => React.createElement("a", props) };
    if (name === "next/navigation") return { usePathname: () => pathname };
    if (name === "@/src/lib/dancr/dancer-agreement-version") return version;
    if (name === "@/app/components/DancerAgreementLink") return agreementLink;
    if (name === "./dashboard-session" || name.endsWith(".css")) return {};
    throw new Error(name);
  } });
  return renderToStaticMarkup(exports.default({ children: React.createElement("div", null, "PRIVATE_DANCER_TOOLS") }));
}
test("existing dancers cannot see feature components during loading, failed checks or unaccepted/stale terms", () => {
  for (const agreement of [null, {}, { required: true, accepted: false, version: version.DANCER_AGREEMENT_VERSION }, { required: true, accepted: true, version: "old-version" }]) {
    assert.ok(!render(agreement).includes("PRIVATE_DANCER_TOOLS"));
  }
});
test("accepted dancers and paused-account management can proceed", () => {
  for (const agreement of [{ required: true, accepted: true }, { required: false, accepted: false }]) {
    assert.ok(render({ ...agreement, version: version.DANCER_AGREEMENT_VERSION }).includes("PRIVATE_DANCER_TOOLS"));
  }
});
test("agreement checks announce loading without showing an intermediate dashboard card", () => {
  const html = render(null);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /class="dancer-agreement-loading-status" role="status">Loading dancer dashboard/);
  assert.doesNotMatch(html, /<nav|<section|<h1|Checking your agreement status|Loading your dashboard|PRIVATE_DANCER_TOOLS/);
});

test("failed agreement checks still show an error and a retry action", () => {
  const html = render(null, false, false, false, "/dashboard/dancer", "Unable to check your agreement. Please try again.");
  assert.match(html, /<h1[^>]*>Unable to open your dashboard<\/h1>/);
  assert.match(html, /role="alert">Unable to check your agreement/);
  assert.match(html, /<button type="button">Try again<\/button>/);
  assert.match(html, /Contact support/);
  assert.doesNotMatch(html, /aria-busy="true"|Loading your dashboard|PRIVATE_DANCER_TOOLS/);
});

test("gate starts unchecked, links readable terms, and requires an explicit choice before submission", () => {
  const agreement = { required: true, accepted: false, version: version.DANCER_AGREEMENT_VERSION };
  const html = render(agreement);
  assert.match(html, /type="checkbox" required=""/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /type="submit" disabled=""/);
  assert.match(html, /href="\/dancer-agreement" aria-haspopup="dialog"/);
  assert.match(html, /href="\/account"/);
  assert.doesNotMatch(render(agreement, true), /type="submit" disabled=""/);
  assert.match(render(agreement, true, true), /type="submit" disabled=""/);
});
test("private drafts enter profile setup without a sign-in agreement popup, but feature pages remain gated", () => {
  const agreement = { required: true, accepted: false, version: version.DANCER_AGREEMENT_VERSION };
  assert.ok(render(agreement, false, false, true).includes("PRIVATE_DANCER_TOOLS"));
  assert.ok(!render(agreement, false, false, true, "/dashboard/dancer/tv").includes("PRIVATE_DANCER_TOOLS"));
  assert.doesNotMatch(render(null), /Review your Dancer Agreement/);
});

test("live signup creates the account without recording agreement acceptance", async () => {
  const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="dancerAgreementAccepted"/);
  const handler = html.match(/document\.getElementById\("dancerSignupForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/)[0];
  assert.doesNotMatch(handler, /agreementAccepted|agreementVersion/);
  assert.match(handler, /mode: "signup"/);
});
