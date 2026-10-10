import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as dashboard from '../../src/lib/dancr/vip-dashboard.ts';
import * as types from '../../src/lib/dancr/vip-types.ts';

const require = createRequire(import.meta.url);
export function compileVip(file, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, Date, Intl, Error, URLSearchParams, AbortController, crypto: { randomUUID }, console,
    require: name => dependencies[name] ?? (['node:crypto', 'react', 'react/jsx-runtime'].includes(name) ? require(name) : {}), ...globals });
  return exports;
}
export const guest = { id: 'guest-1', role: 'customer', email: 'guest@example.test' };
export const venues = [
  { id: 'venue-1', name: 'The Velvet Room', guestName: 'Jordan', timezone: 'America/Los_Angeles' },
  { id: 'venue-2', name: 'Midnight Lounge', guestName: 'Jordan', timezone: 'America/New_York' },
];
export const dancers = [
  { id: 'dancer-1', stage_name: 'Aria', working_now: true },
  { id: 'dancer-2', stage_name: 'Nova', working_now: false },
  { id: 'dancer-3', stage_name: 'Sapphire', working_now: true },
];
export const state = (venueId = venues[0].id, changes = {}) => ({ venues, selectedVenueId: venueId, dancers, requests: [], hasMore: false,
  summary: { pending: 2, upcoming: 0, nextVisit: null }, requestCount: 0, ...changes });

// Component events with in-memory responses only: no browser journeys, server, or network.
export function dashboardHarness({ hash = '', initialVenueId = '', request = async url => state(new URL(url, 'https://example.test').searchParams.get('venueId') || venues[0].id) } = {}) {
  const slots = [], listeners = new Map(), calls = [], writes = [];
  let cursor = 0, dirty = true, effects = [], tree, currentAccount = guest;
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next;
        if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ||= { current: initial }; },
    useEffect(effect, deps) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) {
        effects.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: effect() }; });
      }
    },
  };
  const window = { location: { hash }, history: { replaceState: (_, __, value) => { writes.push(value); window.location.hash = value; } },
    addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) };
  const RequestCards = compileVip('app/vip/VipRequests.tsx', { '@/src/lib/dancr/vip-types': types }).default;
  const Planner = compileVip('app/vip/VipPlan.tsx', { '@/src/lib/dancr/vip-types': types, '@/src/lib/dancr/vip-dashboard': dashboard }).default;
  const Component = compileVip('app/vip/VipDashboard.tsx', {
    react, 'next/link': { __esModule: true, default: 'a' }, 'next/dynamic': { __esModule: true, default: () => Planner },
    '@/app/dashboard/dashboard-session': { readSession: () => ({ account: currentAccount }), requestDashboardJson: (url, options) => { calls.push({ url, options }); return request(url, options); } },
    '@/src/lib/dancr/vip-dashboard': dashboard, './VipRequests': { __esModule: true, default: RequestCards },
  }, { window }).default;
  const props = { initialVenueId, account: guest, signingOut: false, onSignOut: async () => {} };
  function render() {
    dirty = true;
    for (let i = 0; dirty && i < 30; i++) { dirty = false; cursor = 0; effects = []; tree = Component(props); effects.forEach(cb => cb()); }
    assert.equal(dirty, false, 'component effects settle'); return tree;
  }
  function nodes(node = tree) { return node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).filter(Boolean).flatMap(child => nodes(child))] : []; }
  async function settle() { for (let i = 0; i < 6; i++) { await Promise.resolve(); render(); } return tree; }
  function navigate(view) { nodes().find(node => node.props?.['aria-controls'] === `vip-panel-${view}`).props.onClick(); render(); }
  render();
  return { calls, writes, nodes, render, settle, navigate, tree: () => tree,
    planner: () => nodes().find(node => node.type === Planner),
    session(account) { currentAccount = account; },
    hash(value) { window.location.hash = value; listeners.get('hashchange')?.(); render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
