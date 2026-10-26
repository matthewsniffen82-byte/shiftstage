import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { PublicApiError } from '../src/lib/api-error-policy.ts';
import {
  createNfcCapacityDatabase, seedNfcCapacity, provisionTag, rotateTag,
  insertTags, activeTags, nfcCapacitySnapshot, capId,
} from './helpers/nfc-capacity-database.mjs';

const migration = readFileSync(new URL('../supabase/migrations/20261026010436_allow_private_club_nfc_setup.sql', import.meta.url), 'utf8');
const draft = { id: capId(10), name: 'Private club', slug: 'private-club', city: 'Las Vegas', state: 'NV', is_active: false, owner_user_id: capId(2) };
const published = { ...draft, id: capId(11), name: 'Published club', is_active: true };
const option = venue => ({ ...venue, isPublished: venue.is_active, isClaimed: true });
const tag = { id: capId(100), venue_id: draft.id, tag_type: 'dressing_room', label: 'Dressing room', status: 'active', created_at: '2026-10-25T00:00:00Z' };
function load(relativePath, mocks, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals, require(name) {
    assert.ok(name in mocks, `Unexpected import: ${name}`); return mocks[name];
  } });
  return exports;
}

function routeFixture({ admin = true } = {}) {
  let reads = 0;
  const json = (body, init) => Response.json(body, init);
  const route = load('../app/api/admin/nfc-tags/route.ts', {
    'next/server': { NextResponse: { json } },
    '@/src/lib/api': { apiError: () => json({ error: 'Admin access required' }, { status: 403 }) },
    '@/src/lib/bounded-json-body': {},
    '@/src/lib/dancr/admin': {
      async requireAdmin() { if (!admin) throw new Error('Forbidden'); },
      async getAdminVenues() { reads++; return [draft, published]; },
    },
    '@/src/lib/dancr/nfc': { async listAdminNfcTags() { return []; } },
    '@/src/lib/supabase/admin': { createAdminSupabaseClient() { return {}; } },
    '@/src/lib/supabase/request': { async createRequestSupabaseContext() { return { user: { id: capId(1) } }; } },
  });
  return { ...route, reads: () => reads };
}

test('admin inventory includes private and published clubs with their publication status', async () => {
  const response = await routeFixture().GET(new Request('https://example.test/api/admin/nfc-tags'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.venues.map(v => [v.id, v.isPublished]), [[draft.id, false], [published.id, true]]);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
});

test('private club inventory is still restricted to administrators', async () => {
  const route = routeFixture({ admin: false });
  assert.equal((await route.GET(new Request('https://example.test/api/admin/nfc-tags'))).status, 403);
  assert.equal(route.reads(), 0);
});

function serviceFixture({ venue = draft, admin = true, tagRow = tag, inventory = [tag] } = {}) {
  const calls = [], accessCalls = [];
  const client = {
    from(table) {
      const filters = [];
      const query = { select() { return query; }, eq(key, value) { filters.push([key, value]); return query; },
        order() { return query; }, limit() { return query; },
        then(resolve) { return Promise.resolve({ data: inventory.filter(row => filters.every(([key, value]) => row[key] === value)).map(row => ({ ...row, venues: venue })), error: null }).then(resolve); },
        async maybeSingle() {
          let row = table === 'app_users' ? (admin ? { id: capId(1), role: 'admin', account_state: 'active' } : null)
            : table === 'nfc_tags' ? tagRow && { ...tagRow, venues: venue } : venue;
          if (row && filters.some(([key, value]) => key !== 'token_digest' && row[key] !== value)) row = null;
          return { data: row, error: null };
        },
      }; return query;
    },
    async rpc(name, args) { calls.push({ name, args }); return { data: { ...tagRow, id: args.p_replacement_id || args.p_tag_id, status: args.p_status || 'active' }, error: null }; },
  };
  const service = load('../src/lib/dancr/nfc.ts', {
    'node:crypto': crypto, './venue-access': { async requireVenueAccess(...args) { accessCalls.push(args); return { venueId: draft.id }; } }, './dancer-tap': {},
    './phone-tap-copy': { phoneTapCopy: value => value },
    '../api-error-policy': { PublicApiError },
  });
  return { ...service, client, calls, accessCalls };
}

test('cashier stickers cannot be assigned, replaced or reactivated', async () => {
  const f = serviceFixture({ tagRow: { ...tag, tag_type: 'cashier' } });
  for (const operation of [
    () => f.createAdminVenueNfcTag(f.client, { adminUserId: capId(1), venueId: draft.id, type: 'cashier', label: 'Cashier' }),
    () => f.rotateAdminVenueNfcTag(f.client, { adminUserId: capId(1), tagId: tag.id }),
    () => f.setAdminVenueNfcTagStatus(f.client, { adminUserId: capId(1), tagId: tag.id, status: 'active' }),
  ]) await assert.rejects(operation, error => error instanceof PublicApiError && error.status === 400 && /Only dancer check-in/.test(error.message));
  assert.equal(f.calls.length, 0, 'Unsupported placements must not reach a write RPC');
  await f.setAdminVenueNfcTagStatus(f.client, { adminUserId: capId(1), tagId: tag.id, status: 'disabled' });
  assert.equal(f.calls[0].args.p_status, 'disabled', 'Legacy stickers can still be disabled');
});

test('dressing-room stickers can still be replaced and reactivated by an active admin', async () => {
  const f = serviceFixture();
  assert.equal((await f.rotateAdminVenueNfcTag(f.client, { adminUserId: capId(1), tagId: tag.id })).tag.type, 'dressing_room');
  assert.equal((await f.setAdminVenueNfcTagStatus(f.client, { adminUserId: capId(1), tagId: tag.id, status: 'active' })).status, 'active');
  assert.deepEqual(f.calls.map(call => call.name), ['rotate_admin_venue_nfc_tag', 'set_admin_venue_nfc_tag_status']);
  for (const options of [{ admin: false }, { tagRow: null }]) {
    const blocked = serviceFixture(options);
    await assert.rejects(blocked.rotateAdminVenueNfcTag(blocked.client, { adminUserId: capId(1), tagId: tag.id }), /Admin access required|Tap sticker not found/);
    assert.equal(blocked.calls.length, 0);
  }
});

test('admin and venue inventories exclude cashier stickers and retain venue access scoping', async () => {
  const f = serviceFixture({ inventory: [tag, { ...tag, id: capId(101), tag_type: 'cashier' }, { ...tag, id: capId(102), venue_id: published.id }] });
  assert.deepEqual(Array.from(await f.listAdminNfcTags(f.client), row => row.id), [tag.id, capId(102)]);
  assert.deepEqual(Array.from(await f.listVenueNfcTags(f.client, capId(2)), row => row.id), [tag.id]);
  assert.equal(f.accessCalls[0][1], capId(2));
  assert.equal(f.accessCalls[0][2], 'view_nfc');
});

test('private club provisioning returns a programming secret while only storing its digest', async () => {
  const f = serviceFixture();
  const result = await f.createAdminVenueNfcTag(f.client, { adminUserId: capId(1), venueId: draft.id, type: 'dressing_room', label: 'Dressing room' });
  assert.equal(result.venue.id, draft.id);
  assert.equal(f.calls[0].args.p_token_digest, crypto.createHash('sha256').update(result.token).digest('hex'));
  assert.equal(JSON.stringify(f.calls).includes(result.token), false);
});

test('unpublished clubs cannot resolve a public tap; publication enables the same sticker', async () => {
  const token = 'a'.repeat(43);
  for (const venue of [draft, published, null]) {
    const f = serviceFixture({ venue });
    const result = await f.resolveNfcTag(f.client, token);
    assert.equal(Boolean(result), venue?.is_active === true);
  }
});

test('missing clubs and inactive admins cannot provision a sticker', async () => {
  for (const options of [{ venue: null }, { admin: false }]) {
    const f = serviceFixture(options);
    await assert.rejects(f.createAdminVenueNfcTag(f.client, { adminUserId: capId(1), venueId: draft.id, type: 'dressing_room', label: 'Dressing room' }), /Venue not found|Admin access required/);
    assert.equal(f.calls.length, 0);
  }
});

const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : [];
function panelFixture({ venues = [option(published), option(draft)], tags = [], failed = false, legacyCopy = true, clipboard = 'missing' } = {}) {
  const slots = [], effects = [], calls = [];
  const copied = [], selection = [], copyControls = {};
  const field = { value: '', focus() {}, select() {}, setSelectionRange(start, end) { selection.push([start, end]); } };
  let cursor = 0, tree, resolveLoad;
  const ready = new Promise(resolve => { resolveLoad = resolve; });
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useMemo(factory, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) slots[index] = { deps, value: factory() }; return slots[index].value; },
    useCallback(callback, deps) { return hooks.useMemo(() => callback, deps); },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) { old?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = effect(); }); } },
  };
  const jsx = (type, props) => ({ type, props });
  const panel = load('../app/admin/AdminNfcInventoryPanel.tsx', {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    './admin-session': { async requestAdminJson(url, init) {
      calls.push({ url, ...init });
      if (init.method === 'POST') return { programmingUrl: 'https://example.test/nfc/synthetic-only' };
      await ready; if (failed) throw new Error('Inventory unavailable'); return { venues, tags };
    } },
  }, { AbortController, Intl,
    document: { execCommand(command) {
      assert.equal(command, 'copy');
      if (legacyCopy === 'throws') throw new Error('Copy unsupported');
      if (legacyCopy) copied.push(field.value);
      return legacyCopy;
    } },
    navigator: clipboard === 'missing' ? {} : { clipboard: { async writeText(value) {
      if (clipboard === 'rejects') throw new Error('Clipboard blocked');
      if (clipboard === 'pending') await new Promise(resolve => { copyControls.finish = resolve; });
      copied.push(value);
    } } },
  });
  const render = () => {
    cursor = 0; tree = panel.default({ scopedVenueId: draft.id });
    for (const node of nodes(tree)) if (node.type === 'textarea' && node.props.ref) { field.value = node.props.value; node.props.ref.current = field; }
    while (effects.length) effects.shift()();
  };
  render(); render();
  const find = predicate => nodes(tree).find(predicate);
  return { render, find, calls, copied, selection, field, copyControls, async ready() { resolveLoad(); await new Promise(resolve => setImmediate(resolve)); render(); },
    async submit() { await find(n => n.type === 'form').props.onSubmit({ preventDefault() {} }); render(); },
    copy() { const promise = find(n => n.type === 'button' && ['Copy programming URL', 'Copied!'].includes(n.props.children)).props.onClick(); render(); return promise.then(render); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('scoped draft club is named, warns about publication and can be assigned after loading', async () => {
  const f = panelFixture();
  assert.equal(f.find(n => n.props?.type === 'submit').props.disabled, true);
  await f.submit(); assert.equal(f.calls.length, 1, 'Loading cannot submit a sticker');
  await f.ready();
  assert.equal(f.find(n => n.type === 'select').props.value, draft.id);
  assert.equal(f.find(n => n.type === 'option').props.value, draft.id);
  assert.match(JSON.stringify(f.find(n => n.type === 'form')), /after the club is published/);
  assert.equal(f.find(n => n.props?.type === 'submit').props.disabled, false);
  await f.submit();
  assert.equal(JSON.parse(f.calls.find(c => c.method === 'POST').body).venueId, draft.id);
  assert.equal(JSON.parse(f.calls.find(c => c.method === 'POST').body).type, 'dressing_room');
  assert.equal(f.find(n => n.type === 'option' && n.props.value === 'cashier'), undefined);
  assert.equal(f.find(n => n.type === 'textarea').props.value, 'https://example.test/nfc/synthetic-only');
  f.unmount();
});

test('admin panel counts and displays only dressing-room stickers for the selected club', async () => {
  const current = { id: tag.id, venueId: draft.id, type: 'dressing_room', label: 'Dressing room', status: 'active', tapCount: 0, venue: option(draft) };
  const f = panelFixture({ tags: [current, { ...current, id: capId(101), type: 'cashier', label: 'Old cashier' }, { ...current, id: capId(102), venueId: published.id }] });
  await f.ready();
  const summary = f.find(n => n.props?.className === 'admin-nfc-summary');
  assert.equal(nodes(summary).find(n => n.type === 'strong').props.children, 1);
  const list = f.find(n => n.props?.className === 'admin-nfc-list');
  assert.equal(nodes(list).filter(n => n.type === 'section').length, 1);
  assert.doesNotMatch(JSON.stringify(list), /cashier/i);
  f.unmount();
});

test('missing scoped club or failed inventory cannot silently assign a different club', async () => {
  for (const options of [{ venues: [option(published)] }, { failed: true }]) {
    const f = panelFixture(options); await f.ready();
    assert.equal(f.find(n => n.props?.type === 'submit').props.disabled, true);
    await f.submit(); assert.equal(f.calls.filter(c => c.method === 'POST').length, 0); f.unmount();
  }
});

test('copying the NFC programming link uses the selected complete URL and confirms next to the button', async () => {
  const f = panelFixture(); await f.ready(); await f.submit();
  const field = f.find(n => n.type === 'textarea');
  assert.equal(field.props.readOnly, true);
  field.props.onFocus({ currentTarget: f.field });
  assert.deepEqual(f.selection.at(-1), [0, field.props.value.length]);
  await f.copy();
  assert.deepEqual(f.copied, [field.props.value]);
  const section = f.find(n => n.props?.className === 'admin-nfc-programming');
  assert.ok(nodes(section).some(n => n.type === 'button' && n.props.children === 'Copied!'));
  assert.ok(nodes(section).some(n => n.props?.role === 'status' && /Paste it into NFC Tools/.test(n.props.children)));
  f.unmount();
});

test('clipboard API fallback succeeds when selection-based copy is unsupported', async () => {
  for (const legacyCopy of [false, 'throws']) {
    const f = panelFixture({ legacyCopy, clipboard: 'success' }); await f.ready(); await f.submit(); await f.copy();
    assert.deepEqual(f.copied, [f.field.value]);
    assert.ok(f.find(n => n.type === 'button' && n.props.children === 'Copied!')); f.unmount();
  }
});

test('blocked or unavailable clipboard leaves the link selectable with honest manual-copy feedback', async () => {
  for (const clipboard of ['missing', 'rejects']) {
    const f = panelFixture({ legacyCopy: false, clipboard }); await f.ready(); await f.submit(); await f.copy();
    assert.equal(f.copied.length, 0);
    assert.deepEqual(f.selection.at(-1), [0, f.field.value.length]);
    const section = f.find(n => n.props?.className === 'admin-nfc-programming');
    assert.ok(nodes(section).some(n => n.props?.role === 'status' && /Press and hold/.test(n.props.children)));
    assert.equal(f.find(n => n.type === 'button' && n.props.children === 'Copy programming URL').props.disabled, false);
    f.unmount();
  }
});

test('pending clipboard permission shows progress and does not mark a replacement link copied', async () => {
  const f = panelFixture({ legacyCopy: false, clipboard: 'pending' }); await f.ready(); await f.submit();
  const copying = f.copy();
  assert.equal(f.find(n => n.type === 'button' && n.props.children === 'Copying…').props.disabled, true);
  await f.submit();
  f.copyControls.finish(); await copying;
  assert.ok(f.find(n => n.type === 'button' && n.props.children === 'Copy programming URL'));
  assert.equal(f.find(n => n.type === 'button' && n.props.children === 'Copied!'), undefined); f.unmount();
});

test('private club provisioning and replacement preserve capacity, audit and permissions in Postgres', async t => {
  const db = await createNfcCapacityDatabase(); t.after(() => db.close());
  await db.exec(migration);
  async function seed() {
    await seedNfcCapacity(db);
    await db.query('update public.venues set is_active=false where id=$1', [draft.id]);
  }
  await t.test('admin can prepare and replace a sticker without publishing its venue', async () => {
    await seed(); const created = await provisionTag(db, { id: 100 });
    const replacement = await rotateTag(db);
    assert.equal(created.venue_id, draft.id); assert.equal(replacement.rotated_from_tag_id, created.id);
    assert.equal(await activeTags(db), 1);
    const snapshot = await nfcCapacitySnapshot(db);
    assert.equal(snapshot.tags.find(t => t.id === created.id).status, 'revoked');
    assert.deepEqual(snapshot.audit.map(a => a.action).sort(), ['provision_nfc_sticker', 'rotate_nfc_sticker']);
    assert.equal((await db.query('select is_active from public.venues where id=$1', [draft.id])).rows[0].is_active, false);
  });
  await t.test('the 25-sticker limit and atomic replacement still apply to private venues', async () => {
    await seed(); await insertTags(db, { count: 25 });
    const before = await nfcCapacitySnapshot(db);
    await assert.rejects(provisionTag(db), e => e.code === '54000');
    assert.deepEqual(await nfcCapacitySnapshot(db), before);
    await rotateTag(db); assert.equal(await activeTags(db), 25);
  });
  await t.test('non-admin actors and browser roles cannot use the provisioning functions', async () => {
    await seed(); await insertTags(db);
    const before = await nfcCapacitySnapshot(db);
    for (const actor of [capId(2), capId(3), capId(4)]) {
      await assert.rejects(provisionTag(db, { actor }), e => e.code === '42501');
      await assert.rejects(rotateTag(db, { actor }), e => e.code === '42501');
    }
    for (const signature of ['provision_admin_venue_nfc_tag(uuid,uuid,uuid,text,text,text)', 'rotate_admin_venue_nfc_tag(uuid,uuid,uuid,text)']) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, `public.${signature}`])).rows[0].allowed, role === 'service_role');
      }
    }
    assert.deepEqual(await nfcCapacitySnapshot(db), before);
  });
});
