import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaReview } from './helpers/media-review-label.mjs';

const explain = mediaReview.mediaReviewExplanation;

for (const [codes, label] of [
  [['nudity_rejected'], 'Nudity'],
  [['visible_branding_or_logo'], 'Logo visible'],
  [['multiple_people_detected'], 'Multiple people'],
  [['branding_or_logo_uncertain'], 'Branding unclear'],
  [['person_count_uncertain'], 'Person unclear'],
  [['nudity_rejected', 'visible_branding_or_logo', 'multiple_people_detected'], 'Nudity'],
]) test(`concise rejection: ${codes.join(', ')}`, () => {
  for (const kind of ['photo', 'video']) {
    assert.equal(explain(kind, 'rejected', { reasonCodes: codes }), label);
    assert.equal(explain(kind, 'rejected', { reasonCodes: codes, message: 'A long legacy explanation that must not appear.' }), label);
  }
});

test('missing reasons never expose diagnostics or display long legacy messages', () => {
  assert.equal(explain('photo', 'rejected', { message: 'OPENAI_API_KEY missing' }), 'Reason unavailable');
  assert.equal(explain('video', 'rejected', { message: 'This is a long saved rejection without a reason code.' }), 'Reason unavailable');
});

for (const [code, reason] of [['provider_flagged_violence', 'violence'], ['provider_flagged_harassment', 'harassment'],
  ['provider_flagged_self_harm', 'self-harm'], ['provider_flagged_illicit', 'illegal activity']]) {
  test(`rejection explains the specific safety finding ${code}`, () => {
    assert.match(explain('video', 'rejected', { reasonCodes: [`frame_1_${code}`] }), new RegExp(reason, 'i'));
  });
}

for (const reason of ['person_count_uncertain', 'dancer_visibility_uncertain', 'branding_or_logo_uncertain',
  'photo_policy_copyright_or_consent_uncertain', 'photo_policy_unreadable_or_obscured_content',
  'sexual_content_requires_review', 'provider_flagged_other', 'photo_approval_not_confirmed']) {
  test(`a rejected photo explains ${reason} without promising manual review`, () => {
    const note = explain('photo', 'rejected', { reasonCodes: [reason, 'photo_approval_not_confirmed'] });
    assert.ok(note.trim().split(/\s+/).length <= 3);assert.notEqual(note, 'Reason unavailable');
    assert.doesNotMatch(note, /manual review|wait for review|not a rejection|specific reason wasn't saved/);
    assert.equal(mediaReview.mediaReviewLabel('rejected'), 'Not approved');
  });
}

for (const kind of ['photo', 'video']) {
  for (const reason of ['person_count_uncertain', 'branding_or_logo_uncertain', 'copyright_or_consent_uncertain',
    'unreadable_or_obscured_content', 'sexual_content_requires_review', `${kind}_approval_not_confirmed`]) {
    test(`${kind} rejection explains ${reason} without a manual-review outcome`, () => {
      const note = explain(kind, 'rejected', { reasonCodes: [reason] });
      assert.ok(note.trim().split(/\s+/).length <= 3);assert.notEqual(note, 'Reason unavailable');
      assert.doesNotMatch(note, /manual review|human review|Possible|specific reason wasn't saved/);
    });
  }
  test(`${kind} explains uncertainty without promising manual review`, () => {
    const note = explain(kind, 'review', { reasonCodes: ['person_count_uncertain', 'branding_or_logo_uncertain'] });
    assert.match(note, /couldn't confirm that you are the only person/);
    assert.match(note, /couldn't rule out branding/);
    assert.doesNotMatch(note, /not allowed|wasn't approved/);
  });

  test(`${kind} distinguishes technical delays, active checks, missing reasons and final approvals`, () => {
    assert.match(explain(kind, 'review', { reasonCodes: ['OPENAI_TIMEOUT'], message: 'Photo uploaded, but moderation stopped before approval. Diagnostic code: OPENAI_TIMEOUT.' }), /Retry/);
    assert.doesNotMatch(explain(kind, 'review', { reasonCodes: ['OPENAI_TIMEOUT'] }), /OPENAI/);
    assert.equal(explain(kind, 'moderating'), '');
    assert.equal(explain(kind, 'submitted'), '');
    assert.match(explain(kind, 'rejected'), /Reason unavailable/);
    assert.equal(explain(kind, 'approved', { reasonCodes: ['multiple_people_detected'], message: 'Old rejection.' }), '');
  });
}

test('photo and video reason prefixes resolve to the same actionable explanation', () => {
  const photo = explain('photo', 'rejected', { reasonCodes: ['photo_policy_contact_or_payment_overlay'] });
  const video = explain('video', 'rejected', { reasonCodes: ['policy_contact_or_payment_overlay'] });
  assert.equal(photo, video);
  assert.match(photo, /Contact information/);
  assert.match(explain('video', 'rejected', { reasonCodes: ['frame_1_explicit_sexual_content_rejected'] }), /Explicit content/);
});

test('specific moderator instructions survive automatic review codes', () => {
  assert.equal(explain('video', 'rejected', { reasonCodes: ['person_count_uncertain'], message: 'Multiple people' }), 'Multiple people');
});

test('unknown and malformed reasons never invent a violation or expose diagnostics', () => {
  assert.equal(explain('photo', 'review', { reasonCodes: ['new_internal_reason', null, {}] }), '');
  assert.match(explain('photo', 'rejected', { reasonCodes: 'multiple_people_detected' }), /Reason unavailable/);
  assert.doesNotMatch(explain('photo', 'review', { reasonCodes: ['new_internal_reason'] }), /new_internal_reason/);
  assert.equal(explain('photo', 'review', { reasonCodes: ['provider_not_flagged'] }), '');
});

for (const kind of ['photo', 'video']) {
  test(`${kind} keeps background processing receipts out of uploading and club approval feedback`, () => {
    for (const status of ['pending', 'moderating']) {
      assert.equal(mediaReview.mediaReviewLabel(status, '', kind), 'Completed');
      assert.equal(explain(kind, status, { message: 'Upload received. AI checks are running; club approval is required before it goes live.' }), '');
    }
    for (const status of ['pending_review', 'submitted', 'review', 'completed']) {
      assert.equal(mediaReview.mediaReviewLabel('pending', status), 'Waiting for final approval');
      assert.equal(explain(kind, 'pending', { moderationStatus: status, message: 'AI checks passed. Pending club approval.' }), '');
    }
    assert.equal(mediaReview.mediaReviewLabel('approved', 'pending_review'), 'Approved');
    assert.equal(mediaReview.mediaReviewLabel('rejected', 'moderating'), 'Not approved');
    assert.match(explain(kind, 'rejected', { reasonCodes: ['multiple_people_detected'] }), /Multiple people/);
  });
}

test('overlength video rejection gives the same brief reason from saved notes or a reason code', () => {
  assert.equal(explain('video', 'rejected', { message: 'Over 30 seconds' }), 'Over 30 seconds');
  assert.equal(explain('video', 'rejected', { reasonCodes: ['video_too_long'] }), 'Over 30 seconds');
  assert.equal(explain('video', 'rejected', { reasonCodes: ['video_duration_exceeded'] }), 'Over 30 seconds');
});
