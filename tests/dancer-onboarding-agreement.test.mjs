import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { DANCER_AGREEMENT_VERSION } from "../src/lib/dancr/dancer-agreement-version.ts";
import { MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS } from "../src/lib/dancr/media-limits.ts";
import { dancerSubmissionMedia } from "../src/lib/dancr/dancer-submission-media.ts";
import { dancerSetupHelpContext } from "../src/lib/dancr/dashboard-help-context.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/dashboard/DancerProfileEditor.tsx", import.meta.url), "utf8");
const command = source.slice(source.indexOf("export function DancerOnboardingCommand("), source.indexOf("function persistedStageNameAndCity("));
const code = ts.transpileModule(command, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const walk = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(walk)] : [];
const consent = { agreementAccepted: true, agreementVersion: DANCER_AGREEMENT_VERSION };
const receipt = { accepted: true, version: DANCER_AGREEMENT_VERSION };
function fixture({ effectiveStatus = "approved", agreementReviewRequired = true, ready = true, storageBlocked = false, hash = "", save = async () => ({ agreement: receipt }), saveProfile } = {}) {
  const slots = [], effects = [], requests = [], profileSaves = [], events = [], profileChanges = [], navigation = [], exports = {};
  const location = { search: "", hash }, listeners = new Map();
  let cursor = 0, controls, helpContext;
  const profile = Object.freeze({ id: "saved-profile", stage_name: "Existing", city: "Las Vegas", avatarPhotoUrl: ready ? "saved-avatar" : "", status: effectiveStatus, verification_status: "approved",
    onboarding_video_count: 1, dancer_photos: ready ? [1, 2, 3].map(id => ({ id: String(id), review_status: "approved", is_primary: id === 1 })) : [] });
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useMemo: fn => fn(),
    useEffect(fn, deps) {
      const i = cursor++, previous = slots[i];
      if (previous && deps.every((value, index) => Object.is(value, previous.deps[index]))) return;
      const next = slots[i] = { deps };
      effects.push(() => { previous?.cleanup?.(); next.cleanup = fn(); });
    },
  };
  vm.runInNewContext(code, {
    ...hooks, exports, AbortController, Error, Event, URLSearchParams, DANCER_AGREEMENT_VERSION, MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS, dancerSubmissionMedia,
    require: name => require(name),
    window: { location, localStorage: { removeItem() {}, setItem() { if(storageBlocked) throw Error('Storage disabled'); } }, addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); }, dispatchEvent: event => events.push(event.type), requestAnimationFrame: fn => fn() },
    document: { getElementById: id => id==='dancer-onboarding-agreement'?{scrollIntoView:()=>navigation.push('agreement'),focus:()=>navigation.push('focus')}:null, querySelector: () => null },
    persistedDancerStageName: p => p.stage_name,
    dancerPhotoItemsFromProfile: p => p.dancer_photos.map(photo => ({ id: photo.id, status: photo.review_status, isPrimary: photo.is_primary })),
    DANCER_PHOTOS_KEEP_OPEN_EVENT: "keep-open",
    DancerProfileAgreementReview: "AgreementReview", DancerAgeVerificationGate: "AgeVerification",
    DashboardHelpArea: "HelpArea", dancerSetupHelpContext, useDashboardHelpArea: context => { helpContext = context; },
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
  return { render, requests, profileSaves, events, profileChanges, profile, navigation,
    get helpContext() { render(); return helpContext; },
    flushEffects() { render(); effects.splice(0).forEach(fn => fn()); },
    get mediaActive() { render(); return controls.active; },
    navigate(hash) { location.hash = hash; listeners.get("hashchange")?.(); },
    get continueLabel() { render(); return controls.continueLabel; },
    setAge(value) { render().find(node => node.type === "AgeVerification").props.onVerificationChange(value); },
    continueFromProfile() { controls.continueToAgreement(); },
    submit() { return render().find(node => node.type === "AgreementReview").props.onSubmit(consent); },
  };
}

test("onboarding steps start collapsed and keep the user's choice as verification loads", () => {
  for (const options of [
    { effectiveStatus: "draft", agreementReviewRequired: false, ready: false },
    { effectiveStatus: "pending_review", agreementReviewRequired: false },
    { effectiveStatus: "approved", agreementReviewRequired: true },
  ]) {
    const f = fixture(options);
    const stepButtons = () => f.render().filter(node => node.type === "button" && /^dancer-(profile-media|onboarding-age|onboarding-nfc)-button$/.test(node.props.id));
    assert.equal(stepButtons().length, 3);
    assert.ok(stepButtons().every(node => node.props["aria-expanded"] === false));
    f.setAge({ required: true, status: "verified" });
    f.flushEffects();
    assert.ok(stepButtons().every(node => node.props["aria-expanded"] === false), "loading verification must not open a step");
    stepButtons()[0].props.onClick();
    f.flushEffects();
    assert.equal(stepButtons()[0].props["aria-expanded"], true, "tapping opens the step");
    f.setAge({ required: true, status: "pending" });
    f.flushEffects();
    assert.equal(stepButtons()[0].props["aria-expanded"], true, "refresh preserves the open step");
    stepButtons()[0].props.onClick();
    f.flushEffects();
    assert.ok(stepButtons().every(node => node.props["aria-expanded"] === false), "tapping again collapses the step");
  }
});

test("media notification links reveal the profile editor before and after age status loads", () => {
  for (const hash of ["#dancer-main-photo", "#dancer-photos-title", "#dancer-videos-title"]) {
    const f = fixture({ effectiveStatus: "pending_review", agreementReviewRequired: false, hash });
    assert.equal(f.mediaActive, true);
    f.setAge({ required: true, status: "verified" });
    f.flushEffects();
    assert.equal(f.mediaActive, true, "age refresh must not hide the linked editor");
    assert.equal(f.render().find(node => node.props.id === "dancer-profile-media-panel").props.hidden, false);
    f.render().find(node => node.props.id === "dancer-onboarding-nfc-button").props.onClick();
    f.flushEffects();
    assert.equal(f.mediaActive, false, "the editor cannot own a modal inside a collapsed step");
    f.navigate(hash);
    assert.equal(f.mediaActive, true, "a later notification reopens the profile section");
  }
});

test("the media editor is inactive during agreement review and unrelated links leave it closed", () => {
  const f = fixture({ effectiveStatus: "draft", agreementReviewRequired: false });
  assert.equal(f.mediaActive, false);
  f.render().find(node => node.props.id === "dancer-profile-media-button").props.onClick();
  assert.equal(f.mediaActive, true);
  assert.equal(f.helpContext, "setup-details");
  f.continueFromProfile();
  assert.equal(f.mediaActive, false);
  assert.equal(f.helpContext, "setup-agreement");
  f.navigate("#dancer-account");
  assert.equal(f.mediaActive, false);
  f.navigate("#dancer-main-photo");
  assert.equal(f.mediaActive, true);
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-agreement").props.hidden, true);
});

for (const effectiveStatus of ["approved", "pending_review"]) test(`${effectiveStatus} dancers renew inside step one without resubmitting their saved profile`, async () => {
  const f = fixture({ effectiveStatus, ready: false });
  assert.equal(f.render().find(node => node.props.id === "dancer-profile-media-button").props["aria-expanded"], false);
  f.render().find(node => node.props.id === "dancer-profile-media-button").props.onClick();
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
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-age-button").props["aria-expanded"], true);
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-nfc-button").props["aria-expanded"], false);
  f.render().find(node => node.props.id === "dancer-onboarding-nfc-button").props.onClick();
  assert.equal(f.render().find(node => node.props.id === "dancer-onboarding-nfc-button").props["aria-expanded"], true);
});

test("Continue opens and focuses the agreement even if browser storage is disabled",()=>{
  const f=fixture({effectiveStatus:'draft',agreementReviewRequired:false,storageBlocked:true});
  f.continueFromProfile();
  assert.equal(f.render().find(node=>node.props.id==='dancer-onboarding-agreement').props.hidden,false);
  assert.deepEqual(f.navigation,['agreement','focus']);assert.equal(f.profileSaves.length,0);
});

test("required age verification is labeled and blocks club confirmation until verified", () => {
  const f = fixture({ effectiveStatus: "pending_review", agreementReviewRequired: false });
  for (const status of ["not_started", "pending", "in_review", "declined", "expired"]) {
    f.setAge({ required: true, status });
    const nodes = f.render();
    const age = nodes.find(node => node.props.id === "dancer-onboarding-age-button");
    assert.ok(walk(age).some(node => node.type === "small" && node.props.children === "Required"));
    assert.equal(nodes.find(node => node.props.id === "dancer-onboarding-nfc-button").props.disabled, true);
  }
  f.setAge({ required: true, status: "verified" });
  const nodes = f.render();
  assert.equal(nodes.find(node => node.props.id === "dancer-onboarding-nfc-button").props.disabled, false);
  const age = nodes.find(node => node.props.id === "dancer-onboarding-age-button");
  assert.equal(walk(age).some(node => node.type === "small" && node.props.children === "Required"), false);
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
    [{ required: false, status: "not_started" }, "Continue to club & media approval", "dancer-onboarding-nfc"],
    [{ required: true, status: "verified" }, "Continue to club & media approval", "dancer-onboarding-nfc"],
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
