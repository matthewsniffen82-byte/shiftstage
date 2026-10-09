import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { DANCER_AGREEMENT_VERSION } from "../src/lib/dancr/dancer-agreement-version.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DancerProfileEditor.tsx", import.meta.url), "utf8");
const command = source.slice(source.indexOf("export function DancerOnboardingCommand("), source.indexOf("function persistedStageNameAndCity("));
const code = ts.transpileModule(command, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const consent = { agreementAccepted: true, agreementVersion: DANCER_AGREEMENT_VERSION };
const receipt = { accepted: true, version: DANCER_AGREEMENT_VERSION };
function fixture({ effectiveStatus = "approved", agreementReviewRequired = true, ready = true, save = async () => ({ agreement: receipt }) } = {}) {
  const slots = [], effects = [], requests = [], profileSaves = [], events = [], profileChanges = [], exports = {};
  let cursor = 0, controls;
  const profile = Object.freeze({ id: "saved-profile", stage_name: "Existing", city: "Las Vegas", avatarPhotoUrl: ready ? "saved-avatar" : "", status: effectiveStatus, verification_status: "approved" });
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
  };
  vm.runInNewContext(code, {
    ...hooks, exports, AbortController, Error, Event, URLSearchParams, DANCER_AGREEMENT_VERSION,
    require: name => require(name),
    window: { location: { search: "" }, localStorage: { removeItem() {}, setItem() {} }, addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event.type), requestAnimationFrame: fn => fn() },
    document: { getElementById: () => null, querySelector: () => null },
    persistedDancerStageName: p => p.stage_name,
    dancerPhotoItemsFromProfile: () => ready ? [{ status: "approved" }] : [],
    DANCER_PHOTOS_KEEP_OPEN_EVENT: "keep-open",
    DancerProfileAgreementReview: "AgreementReview", DancerAgeVerificationGate: "AgeVerification",
    readSession: () => ({ accessToken: "fixture" }),
    requestDashboardJson: async (path, options) => { requests.push({ path, options }); return save(); },
    requestDancerProfileJson: async options => { profileSaves.push(options); return { profile: { ...profile, status: "pending_review" } }; },
    effectiveDancerProfileStatus: p => p.status, offerPushNotifications() {},
  });
  function render() {
    cursor = 0;
    return walk(exports.DancerOnboardingCommand({ agreementReviewRequired, effectiveStatus, isVenueApproved: effectiveStatus === "approved", profile, onProfileChange: p => profileChanges.push(p), profileMediaContent: input => { controls = input; return React.createElement("div", null, "Profile editor"); }, venueVerificationContent: "Club confirmation" }));
  }
  render(); effects.splice(0).forEach(fn => fn());
  return { render, requests, profileSaves, events, profileChanges, profile,
    continueFromProfile() { controls.continueToAgreement(); },
    submit() { return render().find(node => node.type === "AgreementReview").props.onSubmit(consent); },
  };
}

for (const effectiveStatus of ["approved", "pending_review"]) test(`${effectiveStatus} dancers renew inside step one without resubmitting their saved profile`, async () => {
  const f = fixture({ effectiveStatus, ready: false });
  const nodes = f.render();
  assert.equal(nodes.find(node => node.props.id === "dancer-profile-media-button").props["aria-expanded"], true);
  assert.equal(nodes.find(node => node.props.id === "dancer-onboarding-agreement").props.hidden, false);
  assert.equal(nodes.find(node => node.props.id === "dancer-onboarding-agreement-status").props.children, "");
  assert.ok(nodes.find(node => node.type === "AgreementReview"));
  await f.submit();
  assert.equal(f.requests[0].path, "/api/dancer/agreement");
  assert.deepEqual(JSON.parse(f.requests[0].options.body), consent);
  assert.equal(f.requests[0].options.method, "POST");
  assert.deepEqual(f.profileSaves, []);
  assert.deepEqual(f.profileChanges, []);
  assert.equal(f.profile.verification_status, "approved");
  assert.deepEqual(f.events, ["mydancr:dancer-agreement-saved"]);
});

test("renewal failures and invalid receipts keep the dancer in the onboarding agreement", async () => {
  for (const save of [async () => { throw new Error("Save unavailable"); }, async () => ({ agreement: { ...receipt, accepted: false } }), async () => ({ agreement: { ...receipt, version: "old" } })]) {
    const f = fixture({ save }); await f.submit();
    const nodes = f.render();
    assert.equal(nodes.find(node => node.props.id === "dancer-onboarding-agreement").props.hidden, false);
    assert.match(nodes.find(node => node.props.id === "dancer-onboarding-agreement-status").props.children, /unavailable|not confirmed/);
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.profileSaves, []);
  }
});

test("a pending renewal saves once even if Continue is triggered again", async () => {
  let resolve;
  const f = fixture({ save: () => new Promise(done => { resolve = done; }) });
  const first = f.submit(); await f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.render().find(node => node.type === "AgreementReview").props.busy, true);
  resolve({ agreement: receipt }); await first;
  assert.deepEqual(f.events, ["mydancr:dancer-agreement-saved"]);
});

test("a new dancer keeps the original profile-to-agreement-to-verification flow", async () => {
  const f = fixture({ effectiveStatus: "draft" });
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-agreement").props.hidden, true);
  f.continueFromProfile();
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-agreement").props.hidden, false);
  await f.submit();
  assert.equal(f.requests.length, 0);
  assert.deepEqual(JSON.parse(f.profileSaves[0].body), { submitForReview: true, ...consent });
  assert.equal(f.profileChanges[0].status, "pending_review");
  assert.deepEqual(f.events, ["mydancr:dancer-agreement-saved"]);
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-age-button").props["aria-expanded"], true);
});
