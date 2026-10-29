import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { customerFacingDealTitle } from '../src/lib/dancr/deal-copy.ts';

function functions(path, names) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.JS);
  const found = new Map();
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.set(node.name.text, node.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(found.size, names.length);
  return ts.transpileModule([...found.values()].join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}

const legacy = functions('src/live-shell/app/08-save-customer-deal-pass.js', ['openDealPassOverlay', 'selectDealPassForNfc']);
const react = functions('app/components/ClubDealCard.tsx', ['openDealDialog', 'selectForNfcTap', 'selectOffer']);

function legacyHarness(ready = null) {
  const destinations = [];
  const context = {
    URLSearchParams, customerFacingDealTitle,
    window: { location: { assign: url => destinations.push(url) } },
    pendingNfcDealIntentForPass: () => ready,
    dealPassOverlay: () => assert.fail('Free Entry must not create an intermediate popup'),
    captureClubDealOverlayReturnContext: () => assert.fail('Direct navigation must not lock or focus an overlay'),
    clubDealOverlayReturnContext: null,
  };
  vm.runInNewContext(legacy, context);
  return { ...context, destinations };
}

test('legacy Free Entry links go directly to arrival options with their dancer attribution', () => {
  for (const title of ['Free Entry', 'Free admission', ' free entry ']) {
    const ui = legacyHarness();
    ui.openDealPassOverlay({ title, dealId: 'offer/one', sourceType: 'dancer_profile', dancerId: 'dancer-one', attributionToken: 'signed+token' }, {});
    assert.equal(ui.destinations.length, 1);
    const url = new URL(ui.destinations[0], 'https://example.test');
    assert.equal(url.pathname, '/deals/transportation/offer%2Fone');
    assert.equal(url.searchParams.get('dancerId'), 'dancer-one');
    assert.equal(url.searchParams.get('attributionToken'), 'signed+token');
  }
});

test('valid saved passes reopen directly; expired passes and venue previews continue to arrival options', () => {
  const ready = { expired: false, passUrl: '/deals/pass/existing-pass' };
  const pass = { title: 'Free admission', dealId: 'offer-one', sourceType: 'club_page' };
  const saved = legacyHarness(ready); saved.openDealPassOverlay(pass, {});
  assert.deepEqual(saved.destinations, [ready.passUrl]);
  for (const preview of [false, true]) {
    const ui = legacyHarness(preview ? ready : { ...ready, expired: true });
    ui.openDealPassOverlay({ ...pass, preview }, {});
    const url = new URL(ui.destinations[0], 'https://example.test');
    assert.equal(url.pathname, '/deals/transportation/offer-one');
    assert.equal(url.searchParams.get('venue_preview'), preview ? '1' : null);
    assert.equal(url.searchParams.get('dancerId'), '');
  }
});

function reactHarness(offerDeals) {
  const destinations = [], selected = [], dialogs = [];
  const context = {
    URLSearchParams, customerFacingDealTitle, offerDeals, activeDeal: offerDeals[0],
    displayTitle: customerFacingDealTitle(offerDeals[0].dealTitle),
    sourceType: 'dancer_profile', dancerId: 'dancer-one', attributionToken: 'first-token',
    attributionTokens: { second: 'second-token' }, admissionPassUrl: '/deals/pass/previous', intentState: 'ready',
    saveInFlight: { current: false }, dialogOpen: false, dialogReturnContext: { current: null },
    window: { scrollY: 10, location: { assign: url => destinations.push(url) } },
    setSelectedDealId: id => selected.push(id), setDialogOpen: open => dialogs.push(open),
  };
  vm.runInNewContext(react, context);
  return { ...context, destinations, selected, dialogs };
}

test('single React Free Entry buttons navigate directly; choosing a free offer keeps that offer’s attribution', () => {
  const first = { id: 'first', dealTitle: 'Free Entry' };
  const second = { id: 'second', dealTitle: 'Free admission' };
  const single = reactHarness([first]); single.openDealDialog(null);
  assert.equal(single.dialogs.length, 0);
  assert.match(single.destinations[0], /^\/deals\/transportation\/first\?/);
  const multiple = reactHarness([first, second]); multiple.selectOffer(second);
  assert.equal(multiple.selected.length, 0, 'there is no second confirmation after choosing Free Entry');
  const url = new URL(multiple.destinations[0], 'https://example.test');
  assert.equal(url.pathname, '/deals/transportation/second');
  assert.equal(url.searchParams.get('attributionToken'), 'second-token');
  assert.equal(url.searchParams.get('dancerId'), 'dancer-one');
});

test('other offers keep their details and an in-flight save blocks changing the selection', () => {
  const offer = { id: 'other', dealTitle: 'Special club offer' };
  const ui = reactHarness([offer]); ui.openDealDialog(null); ui.selectOffer(offer);
  assert.deepEqual(ui.dialogs, [true]); assert.deepEqual(ui.selected, ['other']);
  ui.saveInFlight.current = true;
  ui.selectOffer({ id: 'second', dealTitle: 'Free Entry' });
  assert.equal(ui.destinations.length, 0);
});
