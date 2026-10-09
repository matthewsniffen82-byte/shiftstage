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
const receipt = (accepted = false) => ({ required: true, accepted, version: version.DANCER_AGREEMENT_VERSION });
function fixture({ agreement = null, pathname = "/dashboard/dancer", error = "", request = async () => ({ agreement: receipt() }) } = {}) {
  const exports = {}, slots = [agreement, error, 0], effects = [], requests = [], redirects = [], listeners = new Map();
  let cursor = 0, accountId = "dancer-a";
  vm.runInNewContext(code, { exports, AbortController, Error, window: {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  }, require(name) {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return { ...React, useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    }, useEffect: fn => effects.push(fn) };
    if (name === "next/link") return { default: props => React.createElement("a", props) };
    if (name === "next/navigation") return { usePathname: () => pathname, useRouter: () => ({ replace: path => redirects.push(path) }) };
    if (name === "@/src/lib/dancr/dancer-agreement-version") return version;
    if (name === "./dashboard-session") return {
      readSession: () => ({ account: { id: accountId } }),
      requestDashboardJson: (...args) => { requests.push(args); return request(...args); },
    };
    if (name.endsWith(".css")) return {};
    throw new Error(name);
  } });
  return {
    requests, redirects, slots,
    render() { cursor = 0; return renderToStaticMarkup(exports.default({ children: React.createElement("div", null, "DANCER_CONTENT") })); },
    start() { return effects.shift()(); },
    switchAccount() { accountId = "dancer-b"; listeners.get("storage")(); },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("the dashboard always opens its original onboarding content without a separate acceptance screen", () => {
  for (const agreement of [null, receipt(), receipt(true)]) {
    const f = fixture({ agreement });
    const html = f.render(); f.start();
    assert.match(html, /DANCER_CONTENT/);
    assert.doesNotMatch(html, /checkbox|Accept and continue|Review your Dancer Agreement/);
    assert.equal(f.requests.length, 0, "dashboard loading supplies its own agreement state");
  }
});

test("separate dancer tools remain hidden during loading and unaccepted or stale terms", () => {
  for (const agreement of [null, {}, receipt(), { ...receipt(true), version: "old" }]) {
    const html = fixture({ agreement, pathname: "/dashboard/dancer/tv" }).render();
    assert.doesNotMatch(html, /DANCER_CONTENT|checkbox|<form/);
    assert.match(html, /aria-busy="true"/);
  }
});

test("accepted dancers and paused-account management can proceed to subpages", () => {
  for (const agreement of [receipt(true), { ...receipt(), required: false }]) {
    assert.match(fixture({ agreement, pathname: "/dashboard/dancer/tv" }).render(), /DANCER_CONTENT/);
  }
});

test("a direct tool link returns an unaccepted dancer to onboarding", async () => {
  const f = fixture({ pathname: "/dashboard/dancer/tv" });
  f.render(); f.start(); await settle();
  assert.deepEqual(f.redirects, ["/dashboard/dancer"]);
  assert.equal(f.requests[0][0], "/api/dancer/agreement");
  assert.doesNotMatch(f.render(), /DANCER_CONTENT|checkbox|<form/);
});

test("failed and stale subpage checks offer retry and dashboard access without a consent form", async () => {
  for (const request of [async () => { throw new Error("Temporarily unavailable"); }, async () => ({ agreement: { ...receipt(true), version: "old" } })]) {
    const f = fixture({ pathname: "/dashboard/dancer/tv", request });
    f.render(); f.start(); await settle();
    const html = f.render();
    assert.match(html, /role="alert"/);
    assert.match(html, /Try again/);
    assert.match(html, /href="\/dashboard\/dancer"/);
    assert.doesNotMatch(html, /DANCER_CONTENT|checkbox|<form/);
    assert.deepEqual(f.redirects, []);
  }
});

test("an account switch discards a pending acceptance check", async () => {
  let resolve;
  const f = fixture({ pathname: "/dashboard/dancer/tv", request: () => new Promise(done => { resolve = done; }) });
  f.render(); const cleanup = f.start();
  f.switchAccount(); resolve({ agreement: receipt(true) }); await settle();
  assert.equal(f.requests[0][1].signal.aborted, true);
  assert.equal(f.slots[0], null);
  assert.doesNotMatch(f.render(), /DANCER_CONTENT/);
  cleanup();
});

test("live signup creates the account without recording dancer agreement acceptance", () => {
  const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id="dancerAgreementAccepted"/);
  const handler = html.match(/document\.getElementById\("dancerSignupForm"\)\.addEventListener\("submit"[\s\S]*?\n    \}\);/)[0];
  assert.doesNotMatch(handler, /agreementAccepted|agreementVersion/);
  assert.match(handler, /mode: "signup"/);
});
