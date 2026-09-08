import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {
  deviceSavedDealsStorageKey,
  readDeviceSavedClubDeals,
  removeDeviceSavedClubDeal,
  mergeCustomerSavedClubDeals,
} from '../src/lib/dancr/customer-device-deals.ts';

const source = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');
function homeFunction(name) {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf('\n    function ', start + 5);
  assert.ok(start > 0 && end > start, name);
  return source.slice(start, end);
}
const deal = (id, extra = {}) => ({ id, dealId: id, venueId: 'club', title: id, savedAt: '2026-09-08T12:00:00Z', ...extra });
function fixture() {
  const values = new Map([
    ['dancrSavedDealPassesV2', JSON.stringify([deal('legacy')])],
    ['dancrSavedDealPassesV3:anonymous', JSON.stringify([deal('anonymous')])],
    ['dancrSavedDealPassesV3:account:customer-a', JSON.stringify([deal('only-a')])],
  ]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const switchAccount = id => id ? storage.setItem('dancrAuthSessionV1', JSON.stringify({ accessToken: 'token', account: { id, role: 'customer' } })) : values.delete('dancrAuthSessionV1');
  const context = vm.createContext({ localStorage: storage, savedDealTimestamp: item => Date.parse(item.savedAt) || 0 });
  vm.runInContext([
    homeFunction('savedDealsStorageKey'), homeFunction('loadSavedDealPasses'), homeFunction('saveSavedDealPasses'), homeFunction('syncDeviceSavedDealPasses'),
    'let savedDealPassesStorageKey = savedDealsStorageKey(); let savedDealPasses = loadSavedDealPasses();',
  ].join('\n'), context);
  return { values, storage, switchAccount, context };
}

for (const surface of ['dashboard', 'Home']) {
  test(`${surface}: a new account starts empty despite legacy, anonymous, and another customer's bookmarks`, () => {
    const f = fixture();
    f.switchAccount('brand-new');
    const items = surface === 'dashboard' ? readDeviceSavedClubDeals(f.storage) : f.context.loadSavedDealPasses();
    assert.equal(items.length, 0);
    assert.equal(mergeCustomerSavedClubDeals([], items).length, 0);
    assert.ok(f.values.get('dancrSavedDealPassesV2').includes('legacy'));
  });

  test(`${surface}: returning to an existing account restores only its bookmarks after refresh`, () => {
    const f = fixture();
    const read = () => surface === 'dashboard' ? readDeviceSavedClubDeals(f.storage) : f.context.loadSavedDealPasses();
    f.switchAccount('customer-a');
    assert.deepEqual(Array.from(read(), item => item.dealId), ['only-a']);
    f.switchAccount('customer-b');
    assert.equal(read().length, 0);
    f.storage.setItem(deviceSavedDealsStorageKey(f.storage), JSON.stringify([deal('only-b')]));
    f.switchAccount(null);
    assert.deepEqual(Array.from(read(), item => item.dealId), ['anonymous']);
    f.switchAccount('customer-a');
    assert.deepEqual(Array.from(read(), item => item.dealId), ['only-a']);
    f.switchAccount('customer-b');
    assert.deepEqual(Array.from(read(), item => item.dealId), ['only-b']);
    assert.deepEqual(Array.from(read(), item => item.dealId), ['only-b']);
  });
}

test('dashboard removal leaves another account and anonymous bookmarks intact', () => {
  const f = fixture();
  f.switchAccount('customer-b');
  f.storage.setItem(deviceSavedDealsStorageKey(f.storage), JSON.stringify([deal('only-a')]));
  removeDeviceSavedClubDeal(f.storage, 'only-a');
  assert.equal(readDeviceSavedClubDeals(f.storage).length, 0);
  f.switchAccount('customer-a');
  assert.equal(readDeviceSavedClubDeals(f.storage).length, 1);
  f.switchAccount(null);
  assert.equal(readDeviceSavedClubDeals(f.storage).length, 1);
});

test('Home clears both device and server copies in memory when the account changes', () => {
  const f = fixture();
  f.switchAccount('customer-a');
  f.context.syncDeviceSavedDealPasses();
  vm.runInContext(`savedDealPasses.push(${JSON.stringify(deal('private-server', { serverSaved: true }))})`, f.context);
  f.switchAccount('customer-b');
  assert.equal(f.context.saveSavedDealPasses(), false, 'old in-memory data cannot be written into a new account');
  f.context.syncDeviceSavedDealPasses();
  assert.equal(vm.runInContext('savedDealPasses.length', f.context), 0);
  assert.equal(f.values.has('dancrSavedDealPassesV3:account:customer-b'), false);
  f.switchAccount('customer-a');
  f.context.syncDeviceSavedDealPasses();
  assert.equal(vm.runInContext('savedDealPasses[0].dealId', f.context), 'only-a');
});

test('both clients use the same scope and never fall back to anonymous data while account identity is unresolved', () => {
  const f = fixture();
  for (const id of ['customer-a', 'customer-b', 'id:with/slashes', null]) {
    f.switchAccount(id);
    assert.equal(deviceSavedDealsStorageKey(f.storage), f.context.savedDealsStorageKey());
  }
  f.storage.setItem('dancrAuthSessionV1', JSON.stringify({ accessToken: 'still-loading-account' }));
  assert.equal(deviceSavedDealsStorageKey(f.storage), null);
  assert.equal(f.context.savedDealsStorageKey(), null);
  assert.equal(readDeviceSavedClubDeals(f.storage).length, 0);
  assert.equal(f.context.loadSavedDealPasses().length, 0);
  assert.throws(() => removeDeviceSavedClubDeal(f.storage, 'anonymous'), /could not be read/);
  f.storage.setItem('dancrAuthSessionV1', '{broken');
  assert.equal(deviceSavedDealsStorageKey(f.storage), null);
  assert.equal(f.context.loadSavedDealPasses().length, 0);
});

test('a late account-saved response cannot populate the next customer’s Home list', async () => {
  const f = fixture();
  f.switchAccount('customer-a');
  let finish;
  let applied = false;
  Object.assign(f.context, {
    customerSavedStateVersion: 0, isCustomerSession: () => true,
    getAuthenticatedJson: () => new Promise(resolve => { finish = resolve; }),
    applyLiveCustomerSaved: () => { applied = true; },
    render() {}, customerDashboard: { classList: { contains: () => false } },
  });
  const start = source.indexOf('    async function loadLiveCustomerSaved()');
  const end = source.indexOf('    async function loadLiveCustomerDashboardData()', start);
  vm.runInContext(source.slice(start, end), f.context);
  const loading = f.context.loadLiveCustomerSaved();
  f.switchAccount('brand-new');
  finish({ saved: { dealSaves: [deal('private-server')] } });
  assert.equal(await loading, false);
  assert.equal(applied, false);
});

function reactCardFixture() {
  const f = fixture();
  const card = readFileSync(new URL('../app/components/ClubDealCard.tsx', import.meta.url), 'utf8');
  const part = (start, end) => card.slice(card.indexOf(start), card.indexOf(end, card.indexOf(start)));
  const notices = [];
  const context = vm.createContext({
    window: { localStorage: f.storage, location: { href: 'https://mydancr.com/?venue=club' } },
    deviceSavedDealsStorageKey,
    hasSignedInCustomerDealAccount: () => true,
    setCustomerDealSavedInAccount: async () => false,
    savePending: false, saveStateVersion: { current: 0 },
    setSavePending() {}, setSavedOnDevice() {}, setStatus: text => notices.push(text),
    activeDeal: { id: 'react-offer', dealTitle: 'React offer' }, venueId: 'club', venueName: 'Club',
    displayDescription: '', displayTerms: '', sourceType: 'club_page',
  });
  const functions = [
    part('  async function saveForLater()', '  async function removeSavedDeal()'),
    part('  async function removeSavedDeal()', '  async function shareDeal()'),
    part('function savedDealId(', 'async function copyDealLink('),
  ].join('\n');
  vm.runInContext(ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { ...f, cardContext: context, notices };
}

test('the profile deal card saves and removes device fallbacks only for the current account', async () => {
  const f = reactCardFixture();
  f.switchAccount('customer-a');
  await f.cardContext.saveForLater();
  assert.equal(readDeviceSavedClubDeals(f.storage).some(item => item.dealId === 'react-offer'), true);
  f.switchAccount('customer-b');
  assert.equal(f.cardContext.isDealSavedOnDevice('club', 'react-offer'), false);
  await f.cardContext.saveForLater();
  assert.equal(f.cardContext.isDealSavedOnDevice('club', 'react-offer'), true);
  await f.cardContext.removeSavedDeal();
  assert.equal(f.cardContext.isDealSavedOnDevice('club', 'react-offer'), false);
  f.switchAccount('customer-a');
  assert.equal(f.cardContext.isDealSavedOnDevice('club', 'react-offer'), true);
  assert.ok(f.values.get('dancrSavedDealPassesV2').includes('legacy'));
});

test('a delayed profile deal save cannot update the next account or show saved confirmation there', async () => {
  const f = reactCardFixture();
  f.switchAccount('customer-a');
  let finish;
  f.cardContext.setCustomerDealSavedInAccount = () => new Promise(resolve => { finish = resolve; });
  const saving = f.cardContext.saveForLater();
  f.switchAccount('brand-new');
  finish(true);
  await saving;
  assert.equal(readDeviceSavedClubDeals(f.storage).length, 0);
  assert.equal(f.notices.length, 0);
});
