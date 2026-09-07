import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  DEVICE_SAVED_DEALS_KEY,
  readDeviceSavedClubDeals,
  mergeCustomerSavedClubDeals,
  removeDeviceSavedClubDeal,
} from '../src/lib/dancr/customer-device-deals.ts';

const deviceDeal = (id, extra = {}) => ({
  id: `nfc:club-${id}:${id}`, venueId: `club-${id}`, dealId: id,
  venueName: 'Silver Circuit', title: 'Half-off admission',
  savedAt: '2026-09-07T12:00:00Z', nfcIntent: true,
  url: '/?city=Las%20Vegas&venue=silver-circuit', ...extra,
});
function storageFor(items) {
  let raw = JSON.stringify(items);
  return {
    getItem(key) { assert.equal(key, DEVICE_SAVED_DEALS_KEY); return raw; },
    setItem(key, value) { assert.equal(key, DEVICE_SAVED_DEALS_KEY); raw = value; },
  };
}

test('existing Home device saves populate an empty account list with usable venue details', () => {
  const storage = storageFor([deviceDeal('one'), deviceDeal('two', { title: 'Skip the line', venueName: 'Neon Ember', url: '', savedAt: 1788800000000 })]);
  const merged = mergeCustomerSavedClubDeals([], readDeviceSavedClubDeals(storage));
  assert.equal(merged.length, 2);
  assert.deepEqual(new Set(merged.map(item => item.deal.title)), new Set(['Half-off admission', 'Skip the line']));
  assert.ok(merged.every(item => item.deviceOnly && item.venue.city === 'Las Vegas'));
  assert.equal(merged.find(item => item.dealId === 'two').venue.slug, 'neon-ember');
  assert.equal(merged.find(item => item.dealId === 'one').venue.slug, 'silver-circuit');
});

test('account saves win duplicates and retain verified availability while device saves remain separate', () => {
  const account = { dealId: 'one', savedAt: '2026-09-08T12:00:00Z', deal: { title: 'Updated offer', isActive: false } };
  const devices = readDeviceSavedClubDeals(storageFor([deviceDeal('one'), deviceDeal('one'), deviceDeal('two')]));
  const merged = mergeCustomerSavedClubDeals([account], devices);
  assert.equal(merged.length, 2);
  assert.equal(merged[0], account);
  assert.equal(merged[1].deviceOnly, true);
});

test('malformed entries and redemption history never become phantom bookmarks', () => {
  const storage = storageFor([null, false, {}, deviceDeal('server', { serverSaved: true }), deviceDeal('history', { redemptionToken: 'token' }), deviceDeal('history2', { serverGenerated: true }), deviceDeal('ok', { savedAt: 1e30 })]);
  const read = readDeviceSavedClubDeals(storage);
  assert.deepEqual(read.map(item => item.dealId), ['ok']);
  assert.equal(read[0].savedAt, '1970-01-01T00:00:00.000Z');
  assert.deepEqual(readDeviceSavedClubDeals({ getItem: () => '{broken' }), []);
  assert.deepEqual(readDeviceSavedClubDeals({ getItem: () => { throw new Error('blocked'); } }), []);
});

test('device removal survives a new read and preserves other saves and redemption history', () => {
  const redemption = { id: 'redemption', redemptionToken: 'private-pass' };
  const storage = storageFor([deviceDeal('one'), deviceDeal('one'), deviceDeal('two'), redemption]);
  removeDeviceSavedClubDeal(storage, 'one');
  assert.deepEqual(readDeviceSavedClubDeals(storage).map(item => item.dealId), ['two']);
  assert.deepEqual(JSON.parse(storage.getItem(DEVICE_SAVED_DEALS_KEY)).at(-1), redemption);
});

test('blocked removal reports failure and leaves the saved deal available', () => {
  const storage = storageFor([deviceDeal('one')]);
  storage.setItem = () => { throw new Error('storage blocked'); };
  assert.throws(() => removeDeviceSavedClubDeal(storage, 'one'), /storage blocked/);
  assert.equal(readDeviceSavedClubDeals(storage).length, 1);
});

test('stored links supply only venue identifiers, never a navigation destination', () => {
  const [item] = readDeviceSavedClubDeals(storageFor([deviceDeal('one', { url: 'javascript:alert(1)' })]));
  assert.equal(item.venue.slug, 'silver-circuit');
  assert.equal(item.url, undefined);
});

test('Home resynchronizes device additions and removals without rewriting storage or losing account saves', () => {
  const source = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');
  const start = source.indexOf('    function syncDeviceSavedDealPasses()');
  const end = source.indexOf('\n    function ', start + 5);
  assert.ok(start > 0 && end > start);
  const storage = storageFor([deviceDeal('new')]);
  const context = vm.createContext({ localStorage: storage, savedDealTimestamp: item => Date.parse(item.savedAt) || 0 });
  vm.runInContext(`let savedDealPasses = ${JSON.stringify([deviceDeal('old'), deviceDeal('account', { serverSaved: true })])};\n${source.slice(start, end)}`, context);
  const before = storage.getItem(DEVICE_SAVED_DEALS_KEY);
  context.syncDeviceSavedDealPasses();
  const ids = JSON.parse(vm.runInContext('JSON.stringify(savedDealPasses.map(item => item.dealId))', context));
  assert.deepEqual(new Set(ids), new Set(['account', 'new']));
  assert.equal(storage.getItem(DEVICE_SAVED_DEALS_KEY), before);
});
