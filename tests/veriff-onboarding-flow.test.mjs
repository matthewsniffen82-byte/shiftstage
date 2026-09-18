import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../app/dashboard/DancerProfileEditor.tsx', import.meta.url), 'utf8');
const component = source.slice(source.indexOf('export function DancerOnboardingCommand('), source.indexOf('function dancerPreviewSocialLinks('));
const code = ts.transpileModule(component, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function render(effectiveStatus, verification) {
  const exports = {}; let stateIndex = 0;
  const states = ['', false, null, verification];
  vm.runInNewContext(code, {
    exports, require, useState: () => [states[stateIndex++], () => {}], useRef: value => ({ current: value }),
    useMemo: fn => fn(), useEffect() {},
    persistedDancerStageName: profile => profile.stageName,
    dancerPhotoItemsFromProfile: () => [{ status: 'approved' }],
    dancerProfileSetupBlocker: () => 'Finish your profile',
    DancerAgeVerificationGate: ({ profileSubmitted, children }) => React.createElement('div', { 'data-profile-submitted': profileSubmitted }, children),
  });
  return renderToStaticMarkup(exports.DancerOnboardingCommand({
    effectiveStatus, isVenueApproved: false, profile: { id: 'synthetic', stageName: 'Synthetic dancer', city: 'Las Vegas', avatarPhotoUrl: '/synthetic' },
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
