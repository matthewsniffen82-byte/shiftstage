import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync('src/live-shell/app/13-open-profile-modal.js', 'utf8');
const mount = source.match(/    function syncProfilePortraitDetails\([^]*?\n    \}/)[0];

class Element {
  constructor(className = '') { this.className = className; this.children = []; this.dataset = {}; }
  get firstElementChild() { return this.children[0] || null; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  querySelector(selector) {
    const direct = selector.startsWith(':scope > ');
    const name = selector.replace(':scope > ', '').slice(1);
    for (const node of this.children) {
      if (node.className.split(' ').includes(name)) return node;
      const found = !direct && node.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

function fixture() {
  const profileModal = new Element('profile-modal');
  profileModal.dataset.profileLayout = 'portrait-details';
  const identity = new Element('modal-identity');
  const modalProfileAvatar = new Element('profile-modal-avatar');
  const modalBody = new Element('modal-body');
  const modalProfileMetrics = new Element('profile-modal-header-metrics');
  const metrics = new Element('profile-activity-metrics is-internal');
  const shift = new Element('profile-shift-card');
  const request = new Element('profile-tonight-deal');
  request.onClick = () => 'add to VIP queue';
  modalProfileMetrics.append(metrics); modalBody.append(shift, request);
  profileModal.append(identity, modalProfileAvatar, modalProfileMetrics, modalBody);
  const context = { profileModal, modalProfileAvatar, modalProfileMetrics, modalBody, document: { createElement: () => new Element() } };
  vm.runInNewContext(mount, context);
  return { ...context, identity, metrics, shift, request, sync: context.syncProfilePortraitDetails };
}

test('all profile cards share the portrait layout while editor previews retain their layout', () => {
  const opening = source.slice(source.indexOf('    function openProfileModal('), source.indexOf('      profileModal.removeAttribute(')) + '\n}';
  for (const [profile, preview, expected] of [
    [{}, false, 'portrait-details'], [{ vipProfile: true }, false, 'portrait-details'],
    [{ internalRoster: true, vipProfile: true }, false, 'portrait-details'],
    [{ internalRoster: true }, false, 'portrait-details'], [{ internalRoster: true, internalGuestProfile: true }, false, 'portrait-details'],
    [{ vipProfile: true }, true, ''],
  ]) {
    const profileModal = { dataset: {}, querySelector: () => null };
    const context = { profileModal, findProfile: () => profile, citySelect: { value: 'Las Vegas' } };
    vm.runInNewContext(opening, context);
    context.openProfileModal('dancer', { preview });
    assert.equal(profileModal.dataset.profileLayout, expected);
  }
});

test('staff context and table actions stay with the identity and bottom analytics across refreshes', () => {
  const f = fixture();
  const context = new Element('profile-portrait-context');
  const score = new Element('internal-profile-performance-score');
  const roster = new Element('internal-profile-roster-status');
  const table = new Element('internal-profile-table-context');
  context.append(score, roster, table);
  const request = new Element('internal-profile-request');
  request.onClick = () => 'request at table';
  f.modalBody.append(context, request);
  f.sync();
  const copy = f.profileModal.querySelector('.profile-portrait-copy');
  assert.equal(copy.querySelector('.profile-portrait-person').querySelector('.profile-portrait-context'), context);
  assert.equal(copy.querySelector('.profile-activity-metrics'), f.metrics);
  assert.equal(copy.querySelector('.internal-profile-request').onClick(), 'request at table');
  const updatedContext = new Element('profile-portrait-context');
  const updatedRequest = new Element('internal-profile-request');
  updatedRequest.onClick = () => 'cancel request';
  f.modalBody.append(updatedContext, updatedRequest);
  f.sync();
  assert.equal(context.parentElement, null);
  assert.equal(request.parentElement, null);
  assert.equal(copy.querySelector('.profile-portrait-context'), updatedContext);
  assert.equal(copy.querySelector('.internal-profile-request').onClick(), 'cancel request');
  assert.equal(copy.querySelector('.modal-identity'), f.identity);
  assert.equal(copy.querySelector('.profile-activity-metrics'), f.metrics);
});

test('VIP identity, request action and original metrics move into one portrait footer', () => {
  const f = fixture(); f.sync();
  const copy = f.profileModal.querySelector('.profile-portrait-copy');
  assert.equal(copy.querySelector('.modal-identity'), f.identity);
  assert.equal(copy.querySelector('.profile-modal-avatar'), f.modalProfileAvatar);
  assert.equal(copy.querySelector('.profile-activity-metrics'), f.metrics);
  assert.equal(copy.querySelector('.profile-shift-card'), f.shift);
  assert.equal(copy.querySelector('.profile-tonight-deal').onClick(), 'add to VIP queue');
  assert.equal(f.modalProfileMetrics.children.length, 0);
  f.sync();
  assert.equal(copy.children.length, 5, 'repeated updates must not duplicate the footer');
});

test('live metrics and availability updates replace the visible VIP footer without losing identity or reopening', () => {
  const f = fixture(); f.sync();
  const info = f.profileModal.querySelector('.profile-portrait-info');
  const freshMetrics = new Element('profile-activity-metrics is-internal');
  f.modalProfileMetrics.append(freshMetrics); f.sync();
  assert.equal(info.querySelector('.profile-activity-metrics'), freshMetrics);
  assert.equal(f.metrics.parentElement, null);
  const newShift = new Element('profile-shift-card');
  const newRequest = new Element('profile-tonight-deal');
  f.modalBody.append(newShift, newRequest); f.sync();
  assert.equal(info.querySelector('.profile-shift-card'), newShift);
  assert.equal(info.querySelector('.profile-tonight-deal'), newRequest);
  assert.equal(f.shift.parentElement, null); assert.equal(f.request.parentElement, null);
  assert.equal(info.querySelector('.modal-identity'), f.identity);
  assert.equal(f.profileModal.querySelector('.profile-portrait-info'), info);
});

test('VIP metrics retain Requests tonight alongside followers and views', () => {
  const metricsSource = readFileSync('src/live-shell/app/12-sync-profile-photo-viewer-window.js', 'utf8');
  const fn = metricsSource.match(/    function profileActivityMetricsMarkup\([^]*?\n    \}/)[0];
  const context = { followerNumber: () => 4, profileViewsToday: () => 12 };
  vm.runInNewContext(fn, context);
  const html = context.profileActivityMetricsMarkup({ internalRoster: true, vipProfile: true, requestsTonight: 3 }, 'Las Vegas');
  assert.match(html, />4<\/dd><dt id="modalFollowerLabel">Followers/);
  assert.match(html, />3<\/dd><dt>Requests tonight/);
  assert.match(html, />12<\/dd><dt>Views today/);
  assert.doesNotMatch(html, />Going</);
});
