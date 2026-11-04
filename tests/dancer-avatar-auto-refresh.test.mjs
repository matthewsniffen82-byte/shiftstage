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
