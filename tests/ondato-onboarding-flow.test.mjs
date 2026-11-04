import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { dancerMediaRequirementHint, dancerSubmissionMedia } from "../src/lib/dancr/dancer-submission-media.ts";
import React from 'react';
import { dancerSetupHelpContext } from '../src/lib/dancr/dashboard-help-context.ts';
import { renderToStaticMarkup } from 'react-dom/server';
import { approvedProfilePhotoCount, MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS } from '../src/lib/dancr/media-limits.ts';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/dashboard/DancerProfileEditor.tsx', import.meta.url), 'utf8');
const component = source.slice(source.indexOf('export function DancerOnboardingCommand('), source.indexOf('function persistedStageNameAndCity('));
const code = ts.transpileModule(component, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(effectiveStatus, verification, profileOverrides = {}, approvalProps = {}) {
  const exports = {}; let stateIndex = 0;
  const states = ['', false, '', verification];
  vm.runInNewContext(code, {
    exports, require, useState: () => [states[stateIndex++], () => {}], useRef: value => ({ current: value }),
    useMemo: fn => fn(), useEffect() {},
    dancerSetupHelpContext, useDashboardHelpArea() {}, DashboardHelpArea: ({children}) => children,
    persistedDancerStageName: profile => profile.stageName,
    approvedProfilePhotoCount, MIN_DANCER_ONBOARDING_PHOTOS, MIN_DANCER_ONBOARDING_VIDEOS, dancerSubmissionMedia, dancerMediaRequirementHint,
    dancerPhotoItemsFromProfile: () => [1, 2, 3].map(id => ({ id, status: 'approved', isPrimary: id === 1 })),
    DancerAgeVerificationGate: ({ profileSubmitted, children }) => React.createElement('div', { 'data-profile-submitted': profileSubmitted }, children),
    DancerProfileAgreementReview: ({ children }) => React.createElement('div', null, 'PROFILE_AGREEMENT_REVIEW', children),
    DancerProfilePreview: () => React.createElement('button', null, 'Preview profile'),
  });
  return renderToStaticMarkup(exports.DancerOnboardingCommand({
    effectiveStatus, isVenueApproved: false, ...approvalProps, profile: { id: 'synthetic', stageName: 'Synthetic dancer', city: 'Las Vegas', avatarPhotoUrl: '/synthetic', onboarding_video_count: 1, dancer_photos: [1,2,3].map(id=>({id,review_status:'approved',is_primary:id===1})), ...profileOverrides },
    profileMediaContent: () => React.createElement('div', null, 'PROFILE_SETUP_TOOLS'),
    venueVerificationContent: React.createElement('div', null, 'FIRST_TAP_TOOLS'),
  }));
}
function locked(html, id) {
  const button = html.match(new RegExp(`<button[^>]*id="${id}-button"[^>]*>`))?.[0];
  assert.ok(button, id + ' should exist');
  return button.includes('disabled=""');
}

test('draft dancers can set up profiles while verification and tap steps stay locked', () => {
  const html = render('draft', { required: true, status: 'not_started' });
  assert.ok(html.includes('PROFILE_SETUP_TOOLS'));
  assert.equal(locked(html, 'dancer-profile-media'), false);
  assert.equal(locked(html, 'dancer-onboarding-age'), true);
  assert.equal(locked(html, 'dancer-onboarding-nfc'), true);
  assert.ok(!html.includes('FIRST_TAP_TOOLS'));
  assert.ok(html.includes('data-profile-submitted="false"'));
});

test('Create profile shows all missing media and updates the summary when each minimum is met',()=>{
 const photos=count=>Array.from({length:count},(_,i)=>({id:String(i),review_status:'approved',is_primary:i===0}));
 for(const [photoCount,videoCount,expected] of [
  [0,0,'Add 3 photos (including your main photo) and 1 video. Extras optional.'],
  [1,0,'Add 2 more photos and 1 video. Extras optional.'],
  [2,0,'Add 1 more photo and 1 video. Extras optional.'],
  [3,0,'Add 1 video. Extras optional.'],
  [1,1,'Add 2 more photos. Extras optional.'],
  [3,1,'Profile ready. Continue to the Dancer Agreement.'],
 ]) {
  const html=render('draft',null,{dancer_photos:photos(photoCount),onboarding_video_count:videoCount});
  assert.ok(html.includes(expected),expected);
  assert.equal(locked(html,'dancer-onboarding-age'),true);
 }
});

test('Create profile counts pending photos once, excludes rejected uploads and retains the main-photo requirement',()=>{
 const profile={onboarding_video_count:0,dancer_photos:[{id:'main',review_status:'approved',is_primary:true}],pending_photo_reviews:[
  {id:'replacement',status:'pending_review',upload_context:'profile_main',photo_publication_mode:'replace',replacement_photo_id:'main'},
  {id:'gallery',status:'pending_review',upload_context:'profile_gallery'},
  {id:'rejected',status:'rejected',upload_context:'profile_gallery'},
 ]};
 assert.ok(render('draft',null,profile).includes('Add 1 more photo and 1 video. Extras optional.'));
 profile.dancer_photos=[1,2,3].map(id=>({id:String(id),review_status:'approved',is_primary:false}));
 profile.pending_photo_reviews=[];
 assert.ok(render('draft',null,profile).includes('Add your main photo and 1 video. Extras optional.'));
});

test('submitted profiles can verify, but first-tap tools wait through loading, review and failed results', () => {
  for (const verification of [null, ...['not_started', 'pending', 'in_review', 'declined', 'expired'].map(status => ({ required: true, status }))]) {
    const html = render('pending_review', verification);
    assert.ok(html.includes('PROFILE_SETUP_TOOLS'));
    assert.equal(locked(html, 'dancer-onboarding-age'), false);
    assert.equal(locked(html, 'dancer-onboarding-nfc'), true);
    assert.ok(!html.includes('FIRST_TAP_TOOLS'));
  }
});

test('verified adults unlock the tap; an explicitly disabled rollout preserves existing access', () => {
  for (const verification of [{ required: true, status: 'verified' }, { required: false, status: 'not_started' }]) {
    const html = render('pending_review', verification);
    assert.equal(locked(html, 'dancer-onboarding-nfc'), false);
    assert.ok(html.includes('FIRST_TAP_TOOLS'));
    assert.ok(html.indexOf('id="dancer-profile-media"') < html.indexOf('id="dancer-onboarding-age"'));
    assert.ok(html.indexOf('id="dancer-onboarding-age"') < html.indexOf('id="dancer-onboarding-nfc"'));
  }
});

test('an age check that is not required never appears completed or advances the completed count', () => {
  for (const status of ['not_started', 'pending', 'in_review', 'declined', 'expired']) {
    const verification = { required: false, status };
    for (const [profileStatus, completed, currentStep] of [
      ['draft', 0, 'dancer-profile-media'],
      ['pending_review', 1, 'dancer-onboarding-nfc'],
    ]) {
      const html = render(profileStatus, verification);
      const ageRow = html.match(/<li[^>]*id="dancer-onboarding-age"[\s\S]*?<\/li>/)?.[0] || '';
      assert.ok(ageRow.includes('No age check has been completed.'));
      assert.doesNotMatch(ageRow, /is-complete|✓/);
      assert.match(html, new RegExp(`aria-valuenow="${completed}"`));
      assert.ok(html.includes(`${completed} of 3 complete · 1 not required`));
      assert.match(html, /<span class="is-not-required">–<\/span>/);
      const currentButton = html.match(new RegExp(`<button[^>]*id="${currentStep}-button"[^>]*>`))?.[0] || '';
      assert.ok(currentButton.includes('aria-current="step"'));
    }
  }
});

test('only an actual verified result gives the age step a completion checkmark', () => {
  for (const required of [true, false]) {
    const html = render('pending_review', { required, status: 'verified' });
    const ageRow = html.match(/<li[^>]*id="dancer-onboarding-age"[\s\S]*?<\/li>/)?.[0] || '';
    assert.match(ageRow, /class="is-complete/);
    assert.ok(ageRow.includes('✓'));
    assert.match(html, /aria-valuenow="2"/);
    assert.ok(html.includes('2 of 3 complete'));
    assert.ok(!html.includes('1 not required'));
  }
});


test('pending uploads allow verification, and verified dancers can tap before media approval', () => {
  const profile = { onboarding_video_count: 1, avatarPhotoUrl: '', dancer_photos: [], pending_photo_reviews: [1,2,3].map(id=>({id,decision:'review',status:'moderating',upload_context:id===1?'profile_main':'profile_gallery:'+id})) };
  assert.deepEqual(dancerSubmissionMedia(profile), {count:3,hasMain:true,videoCount:1});
  const awaitingAge = render('pending_review', {required:true,status:'not_started'}, profile);
  assert.equal(locked(awaitingAge, 'dancer-onboarding-age'), false);
  assert.equal(locked(awaitingAge, 'dancer-onboarding-nfc'), true);
  const verified = render('pending_review', {required:true,status:'verified'}, profile);
  assert.equal(locked(verified, 'dancer-onboarding-nfc'), false);
  assert.ok(verified.includes('FIRST_TAP_TOOLS'));
});

test('a first-time profile without its required video returns to setup, including already submitted profiles', () => {
  for (const status of ['draft', 'pending_review']) {
    const html = render(status, { required: true, status: 'verified' }, { onboarding_video_count: 0 });
    assert.equal(locked(html, 'dancer-onboarding-age'), true);
    assert.equal(locked(html, 'dancer-onboarding-nfc'), true);
    assert.ok(html.includes('Create your profile'));
  }
  const active = render('approved', { required: true, status: 'verified' }, { onboarding_video_count: 0 });
  assert.equal(locked(active, 'dancer-onboarding-nfc'), false);
});

test('the final step explains club and media approval without completing on affiliation alone', () => {
  for (const [profileStatus, isVenueApproved, detail, complete] of [
    ['pending_review', true, 'Club confirmed · Media approval pending', false],
    ['pending_review', false, 'Awaiting club approval', false],
    ['approved', true, 'Approved—tap again to check in', true],
  ]) {
    const html = render(profileStatus, { required: true, status: 'verified' }, {}, { isVenueApproved, checkInDetail: detail });
    const row = html.match(/<li[^>]*id="dancer-onboarding-nfc"[\s\S]*?<\/li>/)?.[0] || '';
    assert.ok(html.includes('id="dancer-onboarding-heading">Club &amp; media approval</h2>'));
    assert.ok(row.includes('Club &amp; media approval'));
    assert.ok(row.includes(detail));
    assert.equal(/<li class="is-complete/.test(row), complete);
    assert.ok(html.includes(`${complete ? 3 : 2} of 3 complete`));
  }
});
