import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError, resolveApiError } from '../src/lib/api-error-policy.ts';
import { toPublicClubDeal } from '../src/lib/dancr/public-club-deal.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props) => ({ type, props });
function load(path, mocks, globals = {}) {
  const exports = {};
  vm.runInNewContext(compile(read(path)), { exports, URL, URLSearchParams, Error, ...globals, require(name) {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    assert.ok(name in mocks, `Unexpected import: ${name}`); return mocks[name];
  } }); return exports;
}
const venue = { id: '11111111-1111-4111-8111-111111111111', name: 'Private club', slug: 'private-club', city: 'Las Vegas', state: 'NV', isActive: false, ownerUserId: 'private-owner' };
const deal = { id: '22222222-2222-4222-8222-222222222222', venueId: venue.id, isActive: true, dealTitle: 'Free Entry', payoutAmountCents: 5000 };

function endpoint({ role = 'venue', active = true, session = true, ownClub = true, ownerAdmin = true, offer = deal } = {}) {
  const calls = [], db = {};
  const route = load('app/api/deals/transportation-preview/[dealId]/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/src/lib/api': { PublicApiError, apiError(error, fallback) { const r = resolveApiError(error, fallback); return Response.json(r.body, { status: r.status }); } },
    '@/src/lib/supabase/request': { async createRequestSupabaseContext() { if (!session) throw new PublicApiError('AUTH_REQUIRED', 'Sign in required.', 401); return { client: db, user: { id: 'user' }, session: { accessToken: 'synthetic-refreshed' } }; } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient: () => db },
    '@/src/lib/dancr/auth': { async getAccountByUserId() { return { role, accountState: active ? 'active' : 'disabled' }; } },
    '@/src/lib/dancr/admin': { async requireAdmin() { calls.push('admin'); if (!ownerAdmin) throw new PublicApiError('FORBIDDEN', 'Admin access required.', 403); } },
    '@/src/lib/dancr/venue-access': { async requireVenueAccess(_db, user, permission) { assert.equal(user, 'user'); assert.equal(permission, 'view_dashboard'); calls.push('access'); return { venueId: ownClub ? venue.id : 'another-club' }; } },
    '@/src/lib/dancr/deals': { async getActiveClubDealById(_db, id) { assert.equal(id, deal.id); calls.push('deal'); return offer; } },
    '@/src/lib/dancr/venue': { async getVenueById() { calls.push('venue'); return venue; } },
    '@/src/lib/dancr/club-shuttle-requests': { async getClubShuttleRecipientIds() { calls.push('shuttle'); return ['private-staff-id']; } },
    '@/src/lib/dancr/public-club-deal': { toPublicClubDeal },
    '@/src/lib/dancr/uber': { formatPublicVenueAddress: () => 'Las Vegas, NV' },
  });
  return { calls, run: (id = deal.id) => route.GET(new Request('https://example.test/preview'), { params: Promise.resolve({ dealId: id }) }) };
}

test('only the assigned club account or an authorized admin receives the private free-entry preview', async () => {
  for (const role of ['venue', 'admin']) {
    const f = endpoint({ role }), response = await f.run();
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
    const body = await response.json();
    assert.equal(body.venue.id, venue.id); assert.equal(body.deal.id, deal.id); assert.equal(body.shuttleAvailable, true);
    assert.equal(body.session.accessToken, 'synthetic-refreshed');
    assert.doesNotMatch(JSON.stringify(body), /payoutAmountCents|private-owner|private-staff-id/);
    const back = new URL(body.returnHref, 'https://example.test');
    assert.equal(back.searchParams.get('venue_preview'), '1'); assert.equal(back.searchParams.get('venue'), venue.slug);
    assert.equal(back.searchParams.get('preview_source'), role);
    assert.ok(f.calls.indexOf(role === 'venue' ? 'access' : 'admin') < f.calls.indexOf('deal'));
  }
});

test('logged-out, inactive, unrelated and restricted staff accounts cannot see private offers', async () => {
  for (const [options, status] of [[{ session: false }, 401], [{ active: false }, 403], [{ role: 'customer' }, 403], [{ role: 'dancer' }, 403], [{ ownClub: false }, 404], [{ role: 'admin', ownerAdmin: false }, 403], [{ offer: null }, 404]]) {
    const f = endpoint(options), response = await f.run(); assert.equal(response.status, status);
    const body = await response.json(); assert.equal(body.deal, undefined); assert.equal(body.venue, undefined);
    assert.ok(!f.calls.includes('venue'));
  }
  assert.equal((await endpoint().run('invalid')).status, 404);
});

test('the preview page renders an authentication loader without reading or exposing private venue data', async () => {
  let reads = 0;
  const page = load('app/deals/transportation/[dealId]/page.tsx', {
    'next/navigation': { notFound() { throw new Error('NOT_FOUND'); } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient() { reads++; return { from() { const q = { select() { return q; }, eq() { return q; }, not() { return q; }, async maybeSingle() { return { data: null }; } }; return q; } }; } },
    '@/src/lib/dancr/deals': { getActiveClubDealById: async () => deal },
    '@/src/lib/dancr/public-club-deal': { toPublicClubDeal }, '@/src/lib/dancr/club-shuttle-requests': {}, '@/src/lib/dancr/uber': {},
    '@/src/lib/dancr/responsive-image': {}, '@/src/lib/dancr/venue-branding': {}, './TransportationClient': {}, './TransportationPreviewClient': { default: 'preview-loader' },
  });
  const run = query => page.default({ params: Promise.resolve({ dealId: deal.id }), searchParams: Promise.resolve(query) });
  const result = await run({ venue_preview: '1' }); assert.equal(result.type, 'preview-loader'); assert.equal(result.props.dealId, deal.id); assert.equal(reads, 0);
  await assert.rejects(run({}), /NOT_FOUND/, 'Private offers remain unavailable through the public route');
});

function extract(path, name, globals) {
  const code = read(path), ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  return vm.runInNewContext(`(${fn.getText(ast)})`, { URLSearchParams, ...globals });
}

test('venue preview context survives the Free Entry button and bypasses any existing live pass', async () => {
  let config, navigated, readyReads = 0;
  const markup = extract('src/live-shell/app/08-save-customer-deal-pass.js', 'venueOfferMarkup', { encodeDealPass: value => { config = value; return ''; }, escapeHtml: String, freeEntryButtonLabel: () => 'Free Entry' });
  const makePass = extract('src/live-shell/app/07-shift-window-for-date.js', 'createRevenueDealPass', { customerFacingDealDescription: value => value, venueExperienceHref: () => '/?venue=private-club' });
  const select = extract('src/live-shell/app/08-save-customer-deal-pass.js', 'selectDealPassForNfc', { pendingNfcDealIntentForPass: () => { readyReads++; return { passUrl: '/live-pass' }; }, window: { location: { assign: value => { navigated = value; } } } });
  markup({ ...venue, activeDeal: deal, isDashboardPreview: true });
  assert.equal(config.preview, true); select(await makePass(config));
  assert.equal(readyReads, 0); assert.match(navigated, new RegExp(`/deals/transportation/${deal.id}`)); assert.match(navigated, /venue_preview=1/);
  markup({ ...venue, activeDeal: deal }); select(await makePass(config));
  assert.equal(readyReads, 1); assert.equal(navigated, '/live-pass');
});

test('preview loading rejects mismatched receipts and clears private content when the account changes', async () => {
  const slots = [], effects = [], pending = [], listeners = new Map(); let cursor = 0, tree, account = { id: 'owner-a', role: 'venue' };
  const hooks = { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useEffect(effect, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = effect(); }); } },
  };
  const ui = load('app/deals/transportation/[dealId]/TransportationPreviewClient.tsx', {
    react: hooks, '@/src/lib/dancr/browser-session': { readBrowserAuthSession: () => ({ account }) },
    '@/app/dashboard/dashboard-session': { requestDashboardJson: (_path, options) => new Promise(resolve => pending.push({ options, resolve })) },
    './TransportationClient': { default: 'transportation' },
  }, { AbortController, window: { addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) } });
  const render = () => { cursor = 0; tree = ui.default({ dealId: deal.id }); while (effects.length) effects.shift()(); };
  const settle = async () => { await new Promise(resolve => setImmediate(resolve)); render(); };
  const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
  render(); pending[0].resolve({ deal: { ...deal, venueId: 'wrong' }, venue, returnHref: '/?venue_preview=1' }); await settle();
  assert.ok(nodes(tree).some(node => node.props?.role === 'alert')); assert.notEqual(tree.type, 'transportation');
  nodes(tree).find(node => node.type === 'button').props.onClick(); render();
  pending[1].resolve({ deal, venue, shuttleAvailable: true, returnHref: '/?venue_preview=1' }); await settle();
  assert.equal(tree.type, 'transportation'); assert.equal(tree.props.preview.returnHref, '/?venue_preview=1');
  account = { id: 'customer-b', role: 'customer' }; listeners.get('storage')(); render();
  assert.equal(pending[1].options.signal.aborted, true); assert.notEqual(tree.type, 'transportation');
  assert.ok(nodes(tree).some(node => node.props?.role === 'alert'));
  slots.forEach(slot => slot?.cleanup?.());
});
