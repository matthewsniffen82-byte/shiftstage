import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as markets from '../src/lib/dancr/markets.ts';
import { isPublicDancerProfileEligible } from '../src/lib/dancr/profile-approval.ts';

const home = readFileSync('outputs/index.html', 'utf8');
function fn(name) {
  const start = home.indexOf(`    function ${name}(`);
  const end = home.indexOf('\n    }', start + 1) + '\n    }'.length;
  assert.ok(start >= 0 && end > start, name);
  return home.slice(start, end);
}
function context(values = {}) {
  return vm.createContext({
    ALL_CITIES: 'All cities', lastSpecificDiscoveryCity: 'Las Vegas',
    selectedCity: () => 'All cities', citySelect: { value: 'All cities' },
    markets: {}, allCitiesMarket: { dancers: [], venues: [] },
    ...values,
  });
}
function loadService(file, exportsToAdd = '') {
  const source = readFileSync(file, 'utf8') + exportsToAdd;
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports, console: { log() {}, warn() {} }, process,
    require: name => ({
      './markets': markets,
      './profile-approval': { isPublicDancerProfileEligible },
    })[name] || {},
  });
  return exports;
}
function queryFixture(rows = []) {
  const queries = [];
  return { queries, from(table) {
    const log = { table, filters: [] }; queries.push(log);
    const query = new Proxy({}, { get(_target, method) {
      if (method === 'then') return resolve => Promise.resolve({
        data: rows.filter(row => log.filters.every(([kind, key, value]) => {
          if (kind === 'ilike') return String(row[key]).toLowerCase() === String(value).toLowerCase();
          if (kind === 'eq' || kind === 'is') return row[key] === value;
          return true;
        })), count: rows.length, error: null,
      }).then(resolve);
      return (...args) => { log.filters.push([method, ...args]); return query; };
    } });
    return query;
  } };
}

test('All cities is a discovery scope and never becomes a profile city', () => {
  assert.equal(markets.resolveMyDancrDiscoveryCity(' ALL CITIES '), 'All cities');
  assert.equal(markets.resolveMyDancrDiscoveryCity('Miami'), 'Miami');
  assert.equal(markets.resolveMyDancrCity('All cities'), 'Las Vegas');
  assert.ok(!markets.MYDANCR_AVAILABLE_CITIES.includes('All cities'));
});

test('combined dancer queries retain approval and visibility while city queries remain scoped', async () => {
  const service = loadService('src/lib/dancr/public.ts', '\nexport { getApprovedDancerRowsByCity };');
  const approved = city => ({ id: city, city, status: 'approved', verification_status: 'approved', is_public: true, disabled_at: null });
  const rows = [approved('Las Vegas'), approved('Miami'), approved('Atlanta'),
    { ...approved('hidden'), is_public: false }, { ...approved('pending'), status: 'pending' },
    { ...approved('disabled'), disabled_at: '2026-09-01' }];
  const all = queryFixture(rows);
  assert.deepEqual(Array.from(await service.getApprovedDancerRowsByCity(all, 'All cities'), row => row.city), ['Las Vegas', 'Miami', 'Atlanta']);
  assert.ok(!all.queries[0].filters.some(([kind]) => kind === 'ilike'));
  assert.ok(all.queries[0].filters.some(([kind, n]) => kind === 'limit' && n === 800));
  const local = queryFixture(rows);
  assert.deepEqual(Array.from(await service.getApprovedDancerRowsByCity(local, 'Miami'), row => row.city), ['Miami']);
});

test('TV feed and video count support All cities without a literal city filter', async () => {
  const service = loadService('src/lib/dancr/tv.ts', '\nexport { normalizeTvCity, publicTvRowsQuery };');
  const all = queryFixture();
  await service.getPublicMyDancrTvVideoCount(all, { city: 'All cities' });
  assert.ok(!all.queries[0].filters.some(([kind]) => kind === 'ilike'));
  const local = queryFixture();
  await service.getPublicMyDancrTvVideoCount(local, { city: 'Miami' });
  assert.ok(local.queries[0].filters.some(([kind, key, value]) => kind === 'ilike' && key === 'dancer_profiles.city' && value === 'Miami'));
  const feed = queryFixture();
  service.publicTvRowsQuery(feed, { city: service.normalizeTvCity('All cities'), nowIso: new Date().toISOString(), limit: 24 });
  assert.ok(!feed.queries[0].filters.some(([kind]) => kind === 'ilike'));
  assert.ok(feed.queries[0].filters.some(([kind, key, value]) => kind === 'eq' && key === 'status' && value === 'approved'));
});

test('dancer mapping retains cities and grouping mixes cities without duplicates', () => {
  const ctx = context({ formatLiveDistance: () => '',
    isWorkingTonight: profile => Boolean(profile.now),
    dailyRotationScore: profile => profile.order,
    upcomingSortValue: profile => profile.order,
    shiftStartMinutes: () => 0,
  });
  vm.runInContext(fn('mapLiveDancer') + fn('interleaveDancerCities') + fn('dancerDirectoryGroups'), ctx);
  const mapped = ctx.mapLiveDancer({ id: 'miami', stageName: 'Luna', city: 'Miami' }, false, 0, {});
  assert.equal(mapped.city, 'Miami');
  const rows = ['Las Vegas', 'Las Vegas', 'Las Vegas', 'Miami', 'Atlanta'].map((city, order) => ({ id: order, city, order }));
  const groups = ctx.dancerDirectoryGroups(rows, 'All cities');
  assert.deepEqual(Array.from(groups.noSchedule, row => row.city), ['Las Vegas', 'Miami', 'Atlanta', 'Las Vegas', 'Las Vegas']);
  assert.equal(new Set(groups.noSchedule.map(row => row.id)).size, rows.length);
  assert.equal(ctx.dancerDirectoryGroups([], 'All cities').noSchedule.length, 0);
});

test('combined cards use the dancer city at a date boundary and retain profile identity', () => {
  const vegas = { id: 'vegas', slug: 'luna-vegas', name: 'Luna', city: 'Las Vegas', scheduled: true, shiftStartsAt: '2026-09-08T05:00:00Z' };
  const miami = { ...vegas, id: 'miami', slug: 'luna-miami', city: 'Miami' };
  const ctx = context({ allCitiesMarket: { dancers: [vegas, miami], venues: [] },
    isWorkingTonight: () => false, isApprovedPublicProfile: () => true, withTrendingRank: p => p,
    cityTimeZone: city => city === 'Miami' ? 'America/New_York' : 'America/Los_Angeles',
  });
  vm.runInContext(fn('discoveryMarket') + fn('profileDiscoveryCity') + fn('homeDancerGridScheduleLabel') + fn('findProfile'), ctx);
  assert.equal(ctx.homeDancerGridScheduleLabel(vegas, 'All cities'), 'Upcoming · Sep 7');
  assert.equal(ctx.homeDancerGridScheduleLabel(miami, 'All cities'), 'Upcoming · Sep 8');
  assert.equal(ctx.findProfile('luna-miami').id, 'miami');
  assert.equal(ctx.findProfile('luna-vegas').id, 'vegas');
  assert.equal(ctx.citySelect.value, 'All cities');
});

test('All cities remains available for grid and TV, and Clubs returns to a real city', () => {
  const allOption = { value: 'All cities', hidden: false, disabled: false };
  const visited = [];
  const ctx = context({ activeTab: 'tv', lastSpecificDiscoveryCity: 'Miami',
    citySelect: { value: 'All cities', options: [allOption, { value: 'Miami' }] },
    venueSelect: { value: 'club' }, syncHomeDestinationLocation: tab => visited.push(tab),
    loadLiveDiscovery: city => visited.push(city),
  });
  vm.runInContext(fn('syncDiscoveryCityScope'), ctx);
  ctx.syncDiscoveryCityScope();
  assert.equal(ctx.citySelect.value, 'All cities');
  assert.equal(allOption.hidden, false);
  ctx.activeTab = 'venues'; ctx.syncDiscoveryCityScope();
  assert.equal(ctx.citySelect.value, 'Miami');
  assert.equal(allOption.disabled, true);
  assert.equal(ctx.venueSelect.value, 'all');
  assert.deepEqual(visited, ['venues', 'Miami']);
});
