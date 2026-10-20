import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function compile(file, overrides) {
  const source = readFileSync(file, 'utf8'), exports = {};
  const deps = Object.fromEntries([...source.matchAll(/from "([^"]+)"/g)].map(match => [match[1], {}]));
  Object.assign(deps, overrides);
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Request, Response, URL, require: name => deps[name] });
  return exports;
}

test('legacy dancer ranking alerts return no details and still require dancer authorization', async () => {
  for (const denied of [false, true]) {
    const route = compile('app/api/dancer/ranking-events/route.ts', {
      'next/server': { NextResponse: Response },
      '@/src/lib/api': { apiError: () => Response.json({ ok: false }, { status: 403 }) },
      '@/src/lib/supabase/request': { createRequestSupabaseContext: async (_request, access) => {
        assert.equal(access.role, 'dancer'); if (denied) throw new Error('Denied'); return {};
      } },
    });
    const response = await route.GET(new Request('https://example.test/api/dancer/ranking-events'));
    assert.equal(response.status, denied ? 403 : 200);
    if (!denied) { assert.deepEqual(await response.json(), { ok: true, events: [] }); assert.match(response.headers.get('cache-control'), /no-store/); }
  }
});

test('historical ranking notifications are hidden from dancers while activity alerts and manager notices remain', async () => {
  for (const role of ['dancer', 'venue']) {
    const notices = [{ notification_type: 'ranking_milestone' }, { notification_type: 'engagement' }, { notification_type: 'support' }];
    const route = compile('app/api/notifications/route.ts', {
      'next/server': { NextResponse: Response },
      '@/src/lib/api': { apiError: error => { throw error; } },
      '@/src/lib/supabase/request': { createRequestSupabaseContext: async () => ({ client: {}, user: { id: 'owner' } }) },
      '@/src/lib/dancr/auth': { getAccountByUserId: async () => ({ role }) },
      '@/src/lib/dancr/customer-notification-delivery': { notificationPushDelivery: () => ({}) },
      '@/src/lib/dancr/venue-notification-preferences': { venueNotificationEnabled: () => true },
      '@/src/lib/dancr/notifications': { getUserNotifications: async (_client, id, _unread, include) => {
        assert.equal(id, 'owner'); return notices.filter(include);
      } },
    });
    const response = await route.GET(new Request('https://example.test/api/notifications'));
    const data = await response.json();
    assert.deepEqual(data.notifications.map(row => row.notification_type), role === 'dancer' ? ['engagement', 'support'] : notices.map(row => row.notification_type));
  }
});

test('legacy dancer dashboard keeps analytics without ranking cards or milestone loaders', () => {
  const shell = readFileSync('src/live-shell/shell.html', 'utf8');
  const dancer = shell.slice(shell.indexOf('id="dancerAnalyticsSummary"'), shell.indexOf('id="dancerDealSection"'));
  assert.match(dancer, /Weekly activity report|Social growth/);
  assert.doesNotMatch(dancer, /rank|score|milestone/i);
  const render = readFileSync('src/live-shell/app/17-render-dancer-setup.js', 'utf8');
  assert.doesNotMatch(render, /dancerRankMetrics|dancerRankingNotifications|weeklyRankText|rank movement/i);
  assert.match(render, /Profile views/); assert.match(render, /New followers/);
});

test('public cards omit rank badges while club manager score and rank displays remain', () => {
  const card = readFileSync('src/live-shell/app/11-post-verified-shift.js', 'utf8');
  const modal = readFileSync('src/live-shell/app/13-open-profile-modal.js', 'utf8');
  assert.doesNotMatch(card, /card-trend-marker|rank-one-card/);
  assert.doesNotMatch(modal, /Trending rank|modalTrendRank/);
  const manager = readFileSync('app/dashboard/VenueDancerPerformance.tsx', 'utf8');
  assert.match(manager, /venue-score-card-rank/); assert.match(manager, /selected\.rank/);
  assert.match(manager, /DANCER_SCORE_WEIGHTS/);
});
