import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { DANCER_AGREEMENT_VERSION } from "../src/lib/dancr/dancer-agreement-version.ts";
import { MIN_DANCER_ONBOARDING_PHOTOS } from "../src/lib/dancr/media-limits.ts";
import { dancerSubmissionMedia } from "../src/lib/dancr/dancer-submission-media.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DancerProfileEditor.tsx", import.meta.url), "utf8");
const command = source.slice(source.indexOf("export function DancerOnboardingCommand("), source.indexOf("function persistedStageNameAndCity("));
const code = ts.transpileModule(command, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const consent = { agreementAccepted: true, agreementVersion: DANCER_AGREEMENT_VERSION };
const receipt = { accepted: true, version: DANCER_AGREEMENT_VERSION };
function fixture({ effectiveStatus = "approved", agreementReviewRequired = true, ready = true, save = async () => ({ agreement: receipt }), saveProfile } = {}) {
  const slots = [], effects = [], requests = [], profileSaves = [], events = [], profileChanges = [], exports = {};
  let cursor = 0, controls;
  const profile = Object.freeze({ id: "saved-profile", stage_name: "Existing", city: "Las Vegas", avatarPhotoUrl: ready ? "saved-avatar" : "", status: effectiveStatus, verification_status: "approved",
    dancer_photos: ready ? [1, 2, 3].map(id => ({ id: String(id), review_status: "approved", is_primary: id === 1 })) : [] });
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo: fn => fn(), useEffect: fn => effects.push(fn),
  };
  vm.runInNewContext(code, {
    ...hooks, exports, AbortController, Error, Event, URLSearchParams, DANCER_AGREEMENT_VERSION, MIN_DANCER_ONBOARDING_PHOTOS, dancerSubmissionMedia,
    require: name => require(name),
    window: { location: { search: "" }, localStorage: { removeItem() {}, setItem() {} }, addEventListener() {}, removeEventListener() {}, dispatchEvent: event => events.push(event.type), requestAnimationFrame: fn => fn() },
    document: { getElementById: () => null, querySelector: () => null },
    persistedDancerStageName: p => p.stage_name,
    dancerPhotoItemsFromProfile: p => p.dancer_photos.map(photo => ({ id: photo.id, status: photo.review_status, isPrimary: photo.is_primary })),
    DANCER_PHOTOS_KEEP_OPEN_EVENT: "keep-open",
    DancerProfileAgreementReview: "AgreementReview", DancerAgeVerificationGate: "AgeVerification",
    readSession: () => ({ accessToken: "fixture" }),
    requestDashboardJson: async (path, options) => { requests.push({ path, options }); return save(); },
    requestDancerProfileJson: async options => { profileSaves.push(options); return saveProfile ? saveProfile() : { profile: { ...profile, status: "pending_review" } }; },
    effectiveDancerProfileStatus: p => p.status,
  });
  function render() {
    cursor = 0;
    return walk(exports.DancerOnboardingCommand({ agreementReviewRequired, effectiveStatus, isVenueApproved: effectiveStatus === "approved", profile, onProfileChange: p => { profileChanges.push(p); effectiveStatus = p.status; agreementReviewRequired = false; }, profileMediaContent: input => { controls = input; return React.createElement("div", null, "Profile editor"); }, venueVerificationContent: "Club confirmation" }));
  }
  render(); effects.splice(0).forEach(fn => fn());
  return { render, requests, profileSaves, events, profileChanges, profile,
    flushEffects() { effects.length = 0; render(); effects.splice(0).forEach(fn => fn()); },
    get continueLabel() { render(); return controls.continueLabel; },
    setAge(value) { render().find(node => node.type === "AgeVerification").props.onVerificationChange(value); },
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
  assert.equal(nodes.find(node => node.type === "AgreementReview").props.submitLabel, "Save agreement");
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
  f.setAge({ required: true, status: "not_started" });
  assert.equal(f.continueLabel, "Continue to agreement");
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-agreement").props.hidden, true);
  f.continueFromProfile();
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-agreement").props.hidden, false);
  assert.ok(f.render().some(node => node.type === "h3" && node.props.children === "Dancer Agreement"));
  assert.equal(f.render().find(node => node.type === "AgreementReview").props.submitLabel, "Continue to age verification");
  await f.submit();
  assert.equal(f.requests.length, 0);
  assert.deepEqual(JSON.parse(f.profileSaves[0].body), { submitForReview: true, ...consent });
  assert.equal(f.profileChanges[0].status, "pending_review");
  assert.deepEqual(f.events, ["mydancr:dancer-agreement-saved"]);
  f.flushEffects();
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-age-button").props["aria-expanded"], true);
  f.setAge({ required: true, status: "verified" });
  f.flushEffects();
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-nfc-button").props["aria-expanded"], true);
});

test("the agreement continues to the age-verification step even when the account has no required check", async () => {
  const f = fixture({ effectiveStatus: "draft", agreementReviewRequired: false });
  f.setAge({ required: false, status: "not_started" });
  assert.equal(f.continueLabel, "Continue to agreement");
  f.continueFromProfile();
  let nodes = f.render();
  assert.ok(nodes.some(node => node.type === "p" && /Review and accept the Dancer Agreement to continue to age verification/.test(node.props.children)));
  assert.equal(nodes.find(node => node.type === "AgreementReview").props.submitLabel, "Continue to age verification");
  assert.equal(f.profileSaves.length, 0, "opening the agreement does not accept or submit it");
  await f.submit();
  assert.deepEqual(JSON.parse(f.profileSaves[0].body), { submitForReview: true, ...consent });
  f.flushEffects();
  nodes = f.render();
  assert.equal(nodes.find(node => node.props.id === "dancer-onboarding-nfc-button").props["aria-expanded"], false);
  assert.equal(nodes.find(node => node.props.id === "dancer-onboarding-age-button").props["aria-expanded"], true);
});

test("submitted dancers continue from edited photos to their actual next step without another agreement screen", () => {
  for (const [age, label, destination] of [
    [{ required: false, status: "not_started" }, "Continue to club confirmation", "dancer-onboarding-nfc"],
    [{ required: true, status: "verified" }, "Continue to club confirmation", "dancer-onboarding-nfc"],
    [{ required: true, status: "not_started" }, "Continue to verification", "dancer-onboarding-age"],
    [null, "Continue to verification", "dancer-onboarding-age"],
  ]) {
    const f = fixture({ effectiveStatus: "pending_review", agreementReviewRequired: false });
    f.setAge(age);
    assert.equal(f.continueLabel, label);
    f.render().find(node => node.props.id === "dancer-profile-media-button").props.onClick();
    f.continueFromProfile();
    const nodes = f.render();
    assert.equal(nodes.find(node => node.props.id === `${destination}-button`).props["aria-expanded"], true);
    assert.equal(nodes.find(node => node.props.id === "dancer-profile-media-button").props["aria-expanded"], false);
    assert.equal(nodes.some(node => node.type === "AgreementReview"), false);
    assert.equal(f.profileSaves.length, 0);
  }
});

test("a failed profile submission stays on the agreement and keeps later steps locked", async () => {
  const f = fixture({ effectiveStatus: "draft", agreementReviewRequired: false, saveProfile: async () => { throw Error("Save unavailable"); } });
  f.setAge({ required: false, status: "not_started" });
  f.continueFromProfile();
  await f.submit();
  const nodes = f.render();
  assert.equal(nodes.find(node => node.props.id === "dancer-profile-media-button").props["aria-expanded"], true);
  assert.equal(nodes.find(node => node.props.id === "dancer-onboarding-agreement").props.hidden, false);
  assert.equal(nodes.find(node => node.props.id === "dancer-onboarding-nfc-button").props.disabled, true);
  assert.match(nodes.find(node => node.props.id === "dancer-onboarding-agreement-status").props.children, /Save unavailable/);
  assert.equal(f.profileChanges.length, 0);
});
