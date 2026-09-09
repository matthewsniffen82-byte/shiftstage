import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../outputs/index.html', import.meta.url), 'utf8');
function liveFunction(name) {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n    \\}`));
  assert.ok(match, `Missing ${name}`);
  return match[0];
}
function editor(profile) {
  const context = vm.createContext({
    profile, MAX_DANCER_PROFILE_PHOTOS: 50, URL: { createObjectURL: () => 'blob:synthetic-preview' },
    console: { log() {} }, latestContentReview: () => null,
    photoMatchesDeletedDancerPhoto: (p, photo) => (p.deletedPhotoIds || []).includes(photo.id),
    rememberDeletedDancerPhoto: (p, { photoId }) => { p.deletedPhotoIds = [...(p.deletedPhotoIds || []), photoId]; },
    isDancerSession: () => true, activeDancerProfile: () => profile,
    cropApprovedProfilePhoto: async file => file, persistQueuedApprovedPhotoDeletionsBeforeUpload: async p => p,
    dancerCoreApprovalUnlocked: () => false,
  });
  vm.runInContext([
    'normalizedReviewStatus', 'canonicalDancerPhotoRows', 'activeDancerPhotoRows', 'dancerPhotoSlotKey',
    'editableDancerPhotoRows', 'approvedVisualPhotoItems', 'photoDisplayLabel', 'relabelVisualPhotoItems',
    'dancerSetupPhotoModerationCategory', 'dancerSubmittedPhotosFromProfile', 'normalizeLocalDancerPhotos',
    'removeLocalDancerPhoto', 'isReplacingApprovedPhotoTarget', 'selectedPhotoReplacement',
    'availableApprovedGallerySortOrders', 'nextAvailableApprovedGallerySortOrder', 'assertDancerProfilePhotoLimit',
    'dancerProfilePhotoCount', 'dancerProfilePhotoSlots', 'uploadApprovedDancerPhoto',
  ].map(liveFunction).join('\n'), context);
  context.normalizeDancerPhotoKey = String;
  return context;
}
const pending = (id, extra = {}) => ({ id, review_status: 'pending', sort_order: 2, is_primary: false, imageUrl: `/private/${id}.jpg`, ...extra });
const approved = (id, extra = {}) => ({ ...pending(id), storage_path: `${id}.jpg`, review_status: 'approved', ...extra });
const ids = items => Array.from(items, item => item.id);

test('hydration keeps both pending record IDs without promoting a gallery upload to primary', () => {
  const profile = { pending_photo_reviews: [pending('first'), pending('second')] };
  const app = editor(profile);
  const items = app.dancerSubmittedPhotosFromProfile(profile);
  assert.deepEqual(ids(items), ['first', 'second']);
  assert.ok(items.every(photo => !photo.isPrimary && !photo.is_primary));
});

test('same-position pending records keep distinct stable editor targets alongside approved media', () => {
  const profile = { dancer_photos: [approved('current')], submittedPhotos: [pending('first'), pending('second')] };
  const app = editor(profile);
  const before = app.approvedVisualPhotoItems(profile);
  assert.deepEqual(ids(before), ['current', 'first', 'second']);
  assert.equal(new Set(before.map(photo => photo.target)).size, 3);
  profile.submittedPhotos.reverse();
  const after = app.approvedVisualPhotoItems(profile);
  assert.equal(after.find(photo => photo.id === 'first').target, before.find(photo => photo.id === 'first').target);
  assert.equal(after.find(photo => photo.id === 'second').target, before.find(photo => photo.id === 'second').target);
});

test('repeated hydration does not duplicate the same pending record', () => {
  const p = pending('same', { storage_path: 'same.jpg' });
  const profile = { dancer_photos: [p], pending_photo_reviews: [p], submittedPhotos: [p, { ...p }] };
  const app = editor(profile);
  assert.deepEqual(ids(app.dancerSubmittedPhotosFromProfile(profile)), ['same']);
  app.normalizeLocalDancerPhotos(profile);
  app.normalizeLocalDancerPhotos(profile);
  assert.deepEqual(ids(app.editableDancerPhotoRows(profile)), ['same']);
});

test('removing one pending record preserves other records even if their preview URLs match', () => {
  const profile = { dancer_photos: [approved('current')], submittedPhotos: [pending('first'), pending('second', { imageUrl: '/private/first.jpg' })] };
  const app = editor(profile);
  app.removeLocalDancerPhoto(profile, { photoId: 'first', photoUrl: '/private/first.jpg' });
  assert.deepEqual(ids(app.editableDancerPhotoRows(profile)), ['current', 'second']);
  assert.deepEqual(profile.deletedPhotoIds, ['first']);
});

test('an existing pending replacement is visible beyond the full approved library', () => {
  const profile = { dancer_photos: Array.from({ length: 50 }, (_, n) => approved(`saved-${n}`, { sort_order: n + 1 })), submittedPhotos: [pending('waiting')] };
  const app = editor(profile);
  assert.equal(app.approvedVisualPhotoItems(profile).length, 51);
  assert.throws(() => app.assertDancerProfilePhotoLimit(profile), /up to 50/);
});

test('pending replacement controls cannot select the approved photo underneath a provisional slot', () => {
  const profile = { dancer_photos: [approved('current')], submittedPhotos: [pending('waiting')] };
  const app = editor(profile);
  const target = app.approvedVisualPhotoItems(profile).find(photo => photo.id === 'waiting').target;
  assert.equal(app.isReplacingApprovedPhotoTarget(profile, target), true);
  assert.throws(() => app.selectedPhotoReplacement(profile, target), /Remove a pending upload/);
});

test('out-of-order upload responses preserve both pending additions with the same provisional slot', async () => {
  const profile = { dancer_photos: [], submittedPhotos: [] };
  const app = editor(profile), finish = [];
  app.uploadSetupPhotoFile = () => new Promise(resolve => finish.push(resolve));
  const first = app.uploadApprovedDancerPhoto({}, 'gallery-add:2');
  const second = app.uploadApprovedDancerPhoto({}, 'gallery-add:2');
  await new Promise(resolve => setImmediate(resolve));
  finish[1]({ decision: 'review', moderationRecordId: 'second', photo: { id: 'second', sortOrder: 2 } });
  await second;
  finish[0]({ decision: 'review', moderationRecordId: 'first', photo: { id: 'first', sortOrder: 2 } });
  await first;
  assert.deepEqual(ids(app.editableDancerPhotoRows(profile)).sort(), ['first', 'second']);
});

test('a confirmed upload retires only its pending record and keeps the other pending item visible', async () => {
  const profile = { dancer_photos: [], submittedPhotos: [pending('first'), pending('second')] };
  const app = editor(profile);
  app.uploadSetupPhotoFile = async () => ({ decision: 'approved', moderationRecordId: 'second', photo: { id: 'published', sortOrder: 3, imageUrl: '/published.jpg', storage_path: 'published.jpg' } });
  await app.uploadApprovedDancerPhoto({}, 'gallery-add:2');
  assert.deepEqual(ids(profile.submittedPhotos), ['first']);
  assert.deepEqual(ids(app.editableDancerPhotoRows(profile)), ['first', 'published']);
});

test('setup previews retain distinct pending IDs sharing a preview and show uploads beyond the approved limit', () => {
  const profile = { galleryPhotoUrls: Array.from({ length: 50 }, (_, i) => `/approved-${i}.jpg`), submittedPhotos: [pending('first'), pending('second', { imageUrl: '/private/first.jpg' })] };
  const app = editor(profile);
  Object.assign(app, { setupPhotoSelectionItems: () => [], escapeHtml: String });
  vm.runInContext(liveFunction('dancerSetupPhotoPreviewMarkup'), app);
  const markup = app.dancerSetupPhotoPreviewMarkup();
  assert.equal((markup.match(/submitted-photo-slot/g) || []).length, 52);
  assert.equal((markup.match(/Pending human review/g) || []).length, 2);
});

test('pending edit controls offer removal for the exact record and no replacement of an approved slot', () => {
  const card = { innerHTML: '' }, popover = { classList: { toggle() {} }, style: { removeProperty() {} } };
  const app = editor({});
  Object.assign(app, {
    displayText: String,
    document: { getElementById: id => id === 'approvedEditItemCard' ? card : popover,
      querySelector: () => ({ appendChild() {} }), body: { classList: { toggle() {} } } },
  });
  vm.runInContext(liveFunction('openApprovedVisualEditPopover'), app);
  app.openApprovedVisualEditPopover('photo', { status: 'pending', photoId: 'second', target: 'pending:second' });
  assert.match(card.innerHTML, /Remove upload/);
  assert.match(card.innerHTML, /data-photo-id="second"/);
  assert.doesNotMatch(card.innerHTML, /data-approved-visual-photo-replace/);
  app.openApprovedVisualEditPopover('photo', { status: 'approved', photoId: 'current', target: 'gallery:1' });
  assert.match(card.innerHTML, /data-approved-visual-photo-replace/);
});
