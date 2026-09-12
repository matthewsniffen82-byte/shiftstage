import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import sharp from 'sharp';
import { resolveDancerProfileAlias } from '../src/lib/dancr/profile-link-alias.ts';
const require = createRequire(import.meta.url);
const { RGBLuminanceSource, HybridBinarizer, BinaryBitmap, QRCodeReader } = require('@zxing/library');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const exports = {};
vm.runInNewContext(compile(readFileSync('app/api/public/share-qr/route.ts', 'utf8')), { exports, require(name) {
  if (name.endsWith('/public-request-rate-limit')) return { enforcePublicRequestRateLimit: async () => {}, PublicRequestRateLimitError: class extends Error {} };
  if (name.endsWith('/request-client-address')) return { requestClientAddress: () => 'synthetic' };
  if (name.endsWith('/supabase/admin')) return { createAdminSupabaseClient: () => ({}) };
  return require(name);
}, URL, Request, Response, Uint8Array, process: { env: { NODE_ENV: 'production' } } });
const request = value => new Request('https://www.mydancr.com/api/public/share-qr?url=' + encodeURIComponent(value));

test('generated profile and club QR images scan to the exact public link', async () => {
  for (const url of ['https://www.mydancr.com/dancers/stacy', 'https://mydancr.com/venues/echo-house', 'https://www.mydancr.com/?city=Las+Vegas&profile=stacy']) {
    const response = await exports.GET(request(url));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    const { data, info } = await sharp(Buffer.from(await response.arrayBuffer())).greyscale().raw().toBuffer({ resolveWithObject: true });
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)));
    assert.equal(new QRCodeReader().decode(bitmap).getText(), new URL(url).toString());
  }
});

test('QR endpoint rejects external URLs, credentials, private routes and oversized input', async () => {
  for (const url of ['', 'javascript:alert(1)', 'https://other.example/dancers/stacy', 'https://user:pass@mydancr.com/dancers/stacy', 'https://mydancr.com/dashboard', 'https://mydancr.com/nfc/cashier', 'https://mydancr.com/dancers/stacy?token=secret', 'http://mydancr.com/dancers/stacy', 'https://mydancr.com/dancers/'+'a'.repeat(2048)]) {
    const response = await exports.GET(request(url));
    assert.equal(response.status, 400, url);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

function aliasClient(result) {
  return { from(table) { assert.equal(table, 'dancer_profile_slug_aliases'); return { select() { return this; }, eq(field, value) { assert.equal(field, 'slug'); assert.equal(value, 'dancer-3'); return this; }, async maybeSingle() { return result; } }; } };
}
test('old links resolve to their assigned profile, while absent aliases stay absent', async () => {
  assert.equal(await resolveDancerProfileAlias(aliasClient({ data: { dancer_profiles: { slug: 'stacy' } } }), 'dancer-3'), 'stacy');
  assert.equal(await resolveDancerProfileAlias(aliasClient({ data: null }), 'dancer-3'), null);
  assert.equal(await resolveDancerProfileAlias(aliasClient({ data: { dancer_profiles: { slug: 'dancer-3' } } }), 'dancer-3'), null);
  assert.equal(await resolveDancerProfileAlias(aliasClient({ error: { code: 'PGRST205' } }), 'dancer-3'), null);
  await assert.rejects(resolveDancerProfileAlias(aliasClient({ error: { code: '08006' } }), 'dancer-3'), error => error.code === '08006');
});

const live = readFileSync('outputs/index.html', 'utf8');
const share = live.match(/function profileShareUrl\([\s\S]*?\n    \}/)[0];
test('sharing uses the signed-in profile slug even when discovery has another dancer with the same name', () => {
  const context = { URL, window: { location: { origin: 'https://www.mydancr.com' } }, discoveryMarket: () => ({ dancers: [{ name: 'Stacy', slug: 'stacy-2' }] }), isApprovedPublicProfile: () => true };
  vm.runInNewContext(share+';this.share=profileShareUrl;', context);
  assert.equal(context.share('Stacy','Las Vegas','stacy'), 'https://www.mydancr.com/dancers/stacy');
  assert.equal(context.share('Stacy','Las Vegas'), 'https://www.mydancr.com/dancers/stacy-2');
});

test('QR loading hides a failed image and allows retry without losing the link', () => {
  const image = { style: {} }, status = {}, retry = {};
  const overlay = { dataset: { qrUrl: 'https://www.mydancr.com/dancers/stacy' }, querySelector(selector) { return selector === '#profileQrImage' ? image : selector === '#profileQrLoadStatus' ? status : retry; } };
  const context = { qrCodeUrl: value => '/api/public/share-qr?url='+encodeURIComponent(value) };
  vm.runInNewContext(live.match(/function loadProfileQrImage\([\s\S]*?\n    \}/)[0]+';this.load=loadProfileQrImage;', context);
  context.load(overlay);
  assert.match(image.src, /^\/api\/public\/share-qr/);
  image.onerror(); assert.equal(image.style.visibility, 'hidden'); assert.equal(retry.hidden, false);
  context.load(overlay); image.onload(); assert.equal(image.style.visibility, 'visible'); assert.equal(status.hidden, true); assert.equal(retry.hidden, true);
});

test('alias lookups still enforce all public profile approval and visibility filters', async () => {
  const source = readFileSync('src/lib/dancr/public.ts','utf8');
  const code = source.slice(source.indexOf('export async function getDancerProfile'),source.indexOf('async function getApprovedDancerPhotos'));
  const api = {};
  const filters = [];
  const windows = [];
  const client = { from(table) {
    assert.equal(table, 'dancer_profiles');
    const window = []; windows.push(window);
    return {
      select(value) { assert.match(value, /venues!inner\(/); return this; },
      eq(key, value) { filters.push([key, value]); window.push(['eq', key, value]); return this; },
      is(key, value) { window.push(['is', key, value]); return this; },
      or(value, options) { assert.equal(options.referencedTable, 'shifts'); window.push(['or', value]); return this; },
      order(key, options) { assert.equal(options.referencedTable, 'shifts'); assert.equal(options.ascending, true); window.push(['order', key]); return this; },
      limit(value, options) { assert.equal(options.referencedTable, 'shifts'); window.push(['limit', value]); return this; },
      async maybeSingle() { return { data: null }; },
    };
  } };
  vm.runInNewContext(compile(code), { exports: api, applyPublicApprovalFilters(query) { return query.eq('status','approved').eq('verification_status','approved'); }, PUBLIC_PROFILE_SHIFT_LIMIT: 50, isMissingIsPublicColumnError: () => false, resolveDancerProfileAlias: async () => 'stacy' });
  assert.equal(await api.getDancerProfile(client,'dancer-3'), null);
  assert.deepEqual(filters.filter(([key]) => key === 'slug'), [['slug','dancer-3'],['slug','stacy']]);
  assert.equal(filters.filter(([key,value])=>key==='is_public'&&value===true).length,2);
  assert.equal(filters.filter(([key,value])=>key==='status'&&value==='approved').length,2);
  assert.equal(windows.length, 2);
  for (const window of windows) {
    assert.deepEqual(window.slice(-3), [['order', 'starts_at'], ['order', 'id'], ['limit', 50]]);
    for (const expected of [['eq', 'shifts.status', 'posted'], ['is', 'shifts.checked_out_at', null], ['eq', 'shifts.venues.is_active', true], ['eq', 'shifts.venues.has_active_club_deal', true]]) {
      assert.ok(window.some(actual => JSON.stringify(actual) === JSON.stringify(expected)));
    }
    const expression = window.find(([method]) => method === 'or')?.[1];
    assert.match(expression, /shift_source\.eq\.scheduled,ends_at\.gte\./);
    assert.match(expression, /location_verification_expires_at\.gt\./);
  }
});

test('legacy shared links retain their photo selection when the assigned slug has changed', async () => {
  let destination;
  const context = {
    URL, URLSearchParams,
    window: { location: { origin: 'https://www.mydancr.com', search: '?city=Las+Vegas&profile=dancer-3&media=photo&mediaIndex=2', replace: url => { destination = url; } } },
    discoveryMarket: () => ({ dancers: [] }), citySelect: {}, activeTab: '',
    document: { querySelectorAll: () => [] }, render() {}, isApprovedPublicProfile: () => true,
  };
  vm.runInNewContext(live.match(/async function openSharedProfileFromUrl\(\) \{[\s\S]*?\n    \}/)[0]+';this.open=openSharedProfileFromUrl;', context);
  await context.open();
  assert.equal(destination, 'https://www.mydancr.com/dancers/dancer-3?media=photo&mediaIndex=2');
});
