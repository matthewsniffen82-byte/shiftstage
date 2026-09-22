import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as version from "../src/lib/dancr/dancer-agreement-version.ts";
import { PublicApiError } from "../src/lib/api-error-policy.ts";
import { loadAgreementComponent } from "./helpers/dancer-agreement-ui.mjs";

const require = createRequire(import.meta.url);
const agreementLink = loadAgreementComponent("DancerAgreementLink.tsx");
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const uiCode = compile(readFileSync(new URL("../app/dashboard/DancerProfileAgreementReview.tsx", import.meta.url), "utf8"));
const serviceCode = compile(readFileSync(new URL("../src/lib/dancr/dancer-agreement.ts", import.meta.url), "utf8"));
const receipt = (accepted = false) => ({ required: true, accepted, version: version.DANCER_AGREEMENT_VERSION, acceptedAt: accepted ? "2026-09-20T01:00:00Z" : null });
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];

function ui({ accepted = false, fail = false, stale = false } = {}) {
  const slots = [], effects = [], submissions = []; let cursor = 0;
  const exports = {};
  vm.runInNewContext(uiCode, { exports, AbortController, Error, require(name) {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "react") return { ...React, useEffect: fn => effects.push(fn), useState(initial) {
      const i = cursor++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }];
    } };
    if (name === "@/src/lib/dancr/dancer-agreement-version") return version;
    if (name === "@/app/components/DancerAgreementLink") return agreementLink;
    if (name === "./dashboard-session") return {
      readSession: () => ({ account: { id: "synthetic-owner" } }),
      requestDashboardJson: async () => { if (fail) throw new Error("Temporarily unavailable"); return { agreement: { ...receipt(accepted), ...(stale ? { version: "old" } : {}) } }; },
    };
    throw new Error(name);
  } });
  const render = (busy = false) => { cursor = 0; return exports.default({ profileId: "synthetic-profile", busy, onSubmit: async input => { submissions.push(input); } }); };
  return { render, submissions, async load() { render(); const cleanup = effects.shift()(); await new Promise(resolve => setImmediate(resolve)); return cleanup; } };
}

test("agreement starts unchecked and continues only after an explicit choice, without a profile review or preview", async () => {
  const f = ui(); await f.load();
  let tree = f.render(); const html = renderToStaticMarkup(tree);
  assert.match(html, /By checking this box, I agree to the/);
  assert.match(html, /href="\/dancer-agreement" aria-haspopup="dialog"/);
  assert.match(html, /type="checkbox" required=""/);
  assert.doesNotMatch(html, /checked=""/);
  assert.match(html, /type="submit" disabled=""/);
  assert.match(html, />Submit profile and continue<\/button>/);
  assert.doesNotMatch(html, /<h3|Review your profile|Preview profile/);
  await walk(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(f.submissions.length, 0);
  walk(tree).find(node => node.type === "input").props.onChange({ target: { checked: true } });
  tree = f.render();
  assert.doesNotMatch(renderToStaticMarkup(tree), /type="submit" disabled=""/);
  await walk(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(f.submissions)), [{ agreementAccepted: true, agreementVersion: version.DANCER_AGREEMENT_VERSION }]);
  await walk(f.render(true)).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(f.submissions.length, 1, "busy submissions cannot repeat");
});

test("loading, failed and stale agreement checks cannot submit; saved consent does not ask again", async () => {
  for (const options of [{ fail: true }, { stale: true }]) {
    const f = ui(options); await f.load();
    const tree = f.render();
    assert.match(renderToStaticMarkup(tree), /role="alert"/);
    await walk(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
    assert.equal(f.submissions.length, 0);
  }
  const f = ui({ accepted: true });
  assert.match(renderToStaticMarkup(f.render()), /type="submit" disabled=""/);
  await f.load();
  assert.doesNotMatch(renderToStaticMarkup(f.render()), /type="checkbox"/);
  assert.match(renderToStaticMarkup(f.render()), /acceptance is saved/);
});

function service({ accepted = false, failure = false } = {}) {
  const exports = {}, calls = []; let current = receipt(accepted);
  vm.runInNewContext(serviceCode, { exports, Error, Date, require(name) {
    if (name === "server-only") return {};
    if (name === "../api-error-policy") return { PublicApiError };
    if (name === "./dancer-agreement-version") return version;
    throw new Error(name);
  } });
  const client = { rpc: async (name, args) => {
    calls.push([name, args]);
    if (name === "accept_dancer_agreement") {
      if (failure) return { error: { code: "failure" } };
      current = receipt(true);
    }
    return { data: current, error: null };
  } };
  return { ...exports, calls, client };
}

test("submission requires explicit current-version consent, saves it durably and reuses it on retry", async () => {
  for (const agreementAccepted of [undefined, false, "true", 1]) {
    const f = service();
    await assert.rejects(f.acceptDancerProfileSubmissionAgreement(f.client, { agreementAccepted, agreementVersion: version.DANCER_AGREEMENT_VERSION }), e => e.status === 400);
    assert.equal(f.calls.length, 1);
  }
  const f = service();
  await assert.rejects(f.acceptDancerProfileSubmissionAgreement(f.client, { agreementAccepted: true, agreementVersion: "old" }), e => e.status === 409);
  const first = await f.acceptDancerProfileSubmissionAgreement(f.client, { agreementAccepted: true, agreementVersion: version.DANCER_AGREEMENT_VERSION });
  const retry = await f.acceptDancerProfileSubmissionAgreement(f.client, {});
  assert.deepEqual(retry, first);
  assert.equal(f.calls.filter(([name]) => name === "accept_dancer_agreement").length, 1);
  const unavailable = service({ failure: true });
  await assert.rejects(unavailable.acceptDancerProfileSubmissionAgreement(unavailable.client, { agreementAccepted: true, agreementVersion: version.DANCER_AGREEMENT_VERSION }), e => e.status === 503);
});

const route = readFileSync(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8");
const submitCode = compile("export " + route.slice(route.indexOf("async function submitProfileForReview("), route.indexOf("\nfunction photoSlotKey(")));
function submission({ avatar = true, photo = true, acceptanceFails = false } = {}) {
  const calls = [], exports = {};
  vm.runInNewContext(submitCode, { exports, Error, createAdminSupabaseClient: () => ({ from(table) {
    const result = { data: table === "dancer_profiles" ? { avatar_storage_path: avatar ? "synthetic-avatar" : "" } : photo ? [{ review_status: "approved" }] : [], error: null };
    return { select() { return this; }, eq() { return this; }, maybeSingle: async () => result, then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
  } }), acceptDancerProfileSubmissionAgreement: async () => { calls.push("accept"); if (acceptanceFails) throw new Error("acceptance failed"); },
  transitionDancerPublication: async (_db, _id, action) => { calls.push(action); return { status: "pending_review" }; } });
  return { calls, run: () => exports.submitProfileForReview({}, "owner", "profile", { stageName: "Synthetic", city: "Las Vegas", identitySavedAt: "2026-09-20" }, {}, {}) };
}

test("profile submission checks approved media before acceptance and cannot transition on acceptance failure", async () => {
  for (const options of [{ avatar: false }, { photo: false }]) {
    const f = submission(options); await assert.rejects(f.run()); assert.deepEqual(f.calls, []);
  }
  const blocked = submission({ acceptanceFails: true });
  await assert.rejects(blocked.run(), /acceptance failed/); assert.deepEqual(blocked.calls, ["accept"]);
  const valid = submission(); await valid.run(); assert.deepEqual(valid.calls, ["accept", "submit_for_venue_review"]);
});

test("loading the dashboard cannot finalize an old tap before agreement and required age verification", async () => {
  const source = readFileSync(new URL("../app/api/dancer/dashboard/route.ts", import.meta.url), "utf8");
  for (const [accepted, required, verified, expected] of [[false, false, false, 0], [true, true, false, 0], [true, true, true, 1], [true, false, false, 1]]) {
    const exports = {}; let finalized = 0;
    const dependencies = {
      "next/server": { NextResponse: { json: value => value } },
      "@/src/lib/api": { apiError: error => { throw error; } },
      "@/src/lib/dancr/auth": { getAccountByUserId: async () => ({ role: "dancer", accountState: "active" }) },
      "@/src/lib/dancr/ondato": { getDancerAgeVerification: async () => ({ required, status: verified ? "verified" : "not_started" }) },
      "@/src/lib/dancr/dancer-agreement": { getDancerAgreementAccess: async () => receipt(accepted) },
      "@/src/lib/dancr/customer-follow-notifications": {},
      "@/src/lib/dancr/deals": { getDancerDealMetrics: async () => ({}) },
      "@/src/lib/dancr/dancer": { getOwnDancerDashboardAnalytics: async () => ({}) },
      "@/src/lib/dancr/nfc": { finalizePendingDancerNfcEnrollment: async () => { finalized++; return null; }, getDancerNfcDashboardState: async () => ({}) },
      "@/src/lib/supabase/admin": { createAdminSupabaseClient: () => ({}) },
      "@/src/lib/supabase/request": { createRequestSupabaseContext: async () => ({ client: {}, user: { id: "verified-owner" } }) },
      "@/src/lib/security/safe-error-metadata": {},
    };
    vm.runInNewContext(compile(source), { exports, require: name => dependencies[name] });
    assert.equal((await exports.GET(new Request("https://mydancr.test/api/dancer/dashboard"))).ok, true);
    assert.equal(finalized, expected);
  }
});
