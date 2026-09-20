import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as version from "../src/lib/dancr/dancer-agreement-version.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DancerAgreementGate.tsx", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(agreement, checked = false, busy = false) {
  const exports = {}; let state = 0;
  vm.runInNewContext(code, { exports, require(name) {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return { ...React, useState: initial => [[agreement, checked, busy][state++] ?? initial, () => {}], useEffect() {}, useRef: initial => ({ current: initial }) };
    if (name === "next/link") return { default: props => React.createElement("a", props) };
    if (name === "@/src/lib/dancr/dancer-agreement-version") return version;
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
test("gate starts unchecked, links readable terms, and requires an explicit choice before submission", () => {
  const agreement = { required: true, accepted: false, version: version.DANCER_AGREEMENT_VERSION };
  const html = render(agreement);
  assert.match(html, /type="checkbox" required=""/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /type="submit" disabled=""/);
  assert.match(html, /href="\/dancer-agreement" target="_blank"/);
  assert.match(html, /href="\/account"/);
  assert.doesNotMatch(render(agreement, true), /type="submit" disabled=""/);
  assert.match(render(agreement, true, true), /type="submit" disabled=""/);
});
test("live signup starts unchecked and submits the same reviewed version", async () => {
  const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
  const checkbox = html.match(/<input id="dancerAgreementAccepted"[^>]*>/)?.[0];
  assert.ok(checkbox); assert.match(checkbox, /type="checkbox" required/); assert.doesNotMatch(checkbox, /\schecked(?:\s|=|>)/);
  assert.ok(checkbox.includes(`data-agreement-version="${version.DANCER_AGREEMENT_VERSION}"`));
  const handler = html.match(/document\.getElementById\("dancerSignupForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/)[0];
  let onSubmit, requested = false, focused = false;
  vm.runInNewContext(handler, { document: { getElementById(id) { return id === "dancerSignupForm" ? { addEventListener: (_name, fn) => { onSubmit = fn; } } : { checked: false, focus() { focused = true; } }; } }, setDancerSignupStatus() {}, requestAuth() { requested = true; } });
  await onSubmit({ preventDefault() {} });
  assert.equal(requested, false); assert.equal(focused, true);
});
