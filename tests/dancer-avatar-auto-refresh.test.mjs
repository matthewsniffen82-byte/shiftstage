import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { dancerAvatarPreview } from '../app/dashboard/dancer-avatar-preview.ts';
import { createMediaStatusCoordinator } from '../src/lib/media-status-coordinator.ts';

const source = readFileSync('app/dashboard/DancerDashboardPanels.tsx', 'utf8');
const effect = source.match(/useEffect\(\(\) => \{\s*if \(!hasPendingAvatar[\s\S]*?\}, \[effectiveStatus[^\]]*\]\);/)?.[0];
assert.ok(effect, 'exercise the dashboard profile subscription');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('an open onboarding dashboard picks up final approval with no pending uploads or manual refresh', async () => {
  let status = 'pending_review', shown, cleanup, poll;
  const subscribeDancerMediaStatus = createMediaStatusCoordinator({
    read: async () => ({ profile: status, videos: 'same', batch: 'same' }),
    visible: () => true, owner: () => 'owner', listen: () => () => {},
    schedule: fn => { poll = fn; return 1; }, cancel() {},
  });
  vm.runInNewContext(effect, {
    useEffect: fn => { cleanup = fn(); }, AbortController,
    hasPendingAvatar: false, hasPendingPhotos: false, hasProcessingAvatar: false, hasProcessingPhotos: false,
    needsAvatarRefresh: false, isApproved: false, effectiveStatus: status,
    document: { visibilityState: 'visible' }, readSession: () => ({ accessToken: 'fixture-token' }),
    requestDancerProfileJson: async () => ({ profile: { status, verification_status: status === 'approved' ? 'approved' : 'pending' } }),
    onProfileChange: profile => { shown = profile.status; }, dancerAvatarPreview, subscribeDancerMediaStatus,
  });
  try {
    await settle(); assert.equal(shown, 'pending_review');
    status = 'approved'; poll(); await settle();
    assert.equal(shown, 'approved');
  } finally { cleanup(); }
});

test('the dashboard automatically retries a missing avatar preview even when the media revision stays unchanged', async () => {
  const review = { id: 'main', is_primary: true, status: 'pending_review', previewUrl: '/main.jpg', category_flags: { publication_prepared: true } };
  let serverProfile = { pending_photo_reviews: [review] }, shown = '', requests = 0, cleanup;
  const timers = new Map(); let timerId = 0;
  const subscribeDancerMediaStatus = createMediaStatusCoordinator({
    read: async () => ({ profile: 'ready', videos: 'same', batch: 'same' }),
    visible: () => true, owner: () => 'owner', listen: () => () => {},
    schedule: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    cancel: id => timers.delete(id),
  });
  vm.runInNewContext(effect, {
    useEffect: fn => { cleanup = fn(); }, AbortController,
    hasPendingAvatar: false, hasPendingPhotos: true, hasProcessingPhotos: false, hasProcessingAvatar: false,
    needsAvatarRefresh: dancerAvatarPreview(serverProfile).needsAvatarRefresh, isApproved: false, effectiveStatus: 'pending_review',
    document: { visibilityState: 'visible' }, readSession: () => ({ accessToken: 'fixture-token' }),
    requestDancerProfileJson: async () => { requests++; return { profile: serverProfile }; },
    onProfileChange: profile => { shown = dancerAvatarPreview(profile).avatarUrl; },
    dancerAvatarPreview, subscribeDancerMediaStatus,
  });
  const tick = async () => { const job = [...timers.values()].at(-1); timers.clear(); job.fn(); await settle(); };
  try {
    await settle();
    assert.equal(shown, '/main.jpg');
    assert.equal([...timers.values()].at(-1).delay, 2000);
    await tick();
    assert.equal(requests, 2, 'an unchanged revision must not strand the placeholder after a signing failure');
    serverProfile = { pending_photo_reviews: [{ ...review, avatarPreviewUrl: '/face.jpg' }] };
    await tick();
    assert.equal(shown, '/face.jpg', 'the face crop arrives without a tap or page reload');
    assert.equal(requests, 3);
    await tick();
    assert.equal(requests, 3, 'stop refetching the unchanged profile once the avatar arrives');
  } finally { cleanup(); }
  assert.equal(timers.size, 0);
});

test('failed, rejected and superseded avatar work does not cause continuing refreshes', () => {
  for (const status of ['moderation_retry', 'moderation_error', 'rejected', 'removed']) {
    assert.equal(dancerAvatarPreview({ pending_photo_reviews: [{ is_primary: true, status }] }).needsAvatarRefresh, false);
  }
  assert.equal(dancerAvatarPreview({ pending_photo_reviews: [{ is_primary: false, status: 'moderating', previewUrl: '/gallery.jpg' }] }).avatarUrl, '');
  assert.equal(dancerAvatarPreview({ pending_photo_reviews: [
    { id: 'new', is_primary: true, status: 'moderating', previewUrl: '/new.jpg' },
    { id: 'old', is_primary: true, status: 'pending_review', avatarPreviewUrl: '/old.jpg' },
  ] }).avatarUrl, '/new.jpg');
});

test('a failed status check and timed-out profile read do not strand the temporary avatar', async () => {
  const timers = new Map(); let timerId = 0, requests = 0, shown = '', cleanup;
  const subscribeDancerMediaStatus = createMediaStatusCoordinator({
    read: async () => { throw Error('Status unavailable'); },
    visible: () => true, owner: () => 'owner', listen: () => () => {},
    schedule: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    cancel: id => timers.delete(id),
  });
  let idleReads = 0;
  const stopIdle = subscribeDancerMediaStatus('videos', () => { idleReads++; });
  vm.runInNewContext(effect, {
    useEffect: fn => { cleanup = fn(); }, AbortController,
    hasPendingAvatar: false, hasPendingPhotos: true, hasProcessingPhotos: false, hasProcessingAvatar: false,
    needsAvatarRefresh: true, isApproved: false, effectiveStatus: 'pending_review',
    document: { visibilityState: 'visible' }, readSession: () => ({ accessToken: 'fixture-token' }),
    requestDancerProfileJson: async options => {
      assert.equal(options.timeoutMs, 15000, 'a stalled profile read must release the in-flight guard');
      if (++requests === 1) throw Error('Loading took too long');
      return { profile: { pending_photo_reviews: [{ is_primary: true, status: 'pending_review', avatarPreviewUrl: '/face.jpg' }] } };
    },
    onProfileChange: profile => { shown = dancerAvatarPreview(profile).avatarUrl; },
    dancerAvatarPreview, subscribeDancerMediaStatus,
  });
  try {
    await settle();
    assert.equal(requests, 1);
    const job = [...timers.values()].at(-1); timers.clear(); job.fn(); await settle();
    assert.equal(shown, '/face.jpg');
    assert.equal(requests, 2);
    assert.equal(idleReads, 0, 'do not repeatedly fetch unchanged idle panels during an outage');
  } finally { cleanup(); stopIdle(); }
  assert.equal(timers.size, 0);
});

test('a late failed status request cannot refresh a different account or an unmounted panel', async () => {
  for (const leave of ['account', 'unmount']) {
    let owner = 'first', rejectRead, refreshed = 0;
    const subscribe = createMediaStatusCoordinator({
      read: () => new Promise((_, reject) => { rejectRead = reject; }),
      visible: () => true, owner: () => owner, listen: () => () => {}, schedule: () => 1, cancel() {},
    });
    const stop = subscribe('profile', () => { refreshed++; }, true);
    if (leave === 'account') owner = 'second'; else stop();
    rejectRead(Error('Late failure')); await settle();
    assert.equal(refreshed, 0); stop();
  }
});
