import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaReview } from './helpers/media-review-label.mjs';

const explain = mediaReview.mediaReviewExplanation;

for (const reason of ['person_count_uncertain', 'dancer_visibility_uncertain', 'branding_or_logo_uncertain',
  'photo_policy_copyright_or_consent_uncertain', 'photo_policy_unreadable_or_obscured_content',
  'sexual_content_requires_review', 'provider_flagged_other', 'photo_approval_not_confirmed']) {
  test(`a rejected photo explains ${reason} without promising manual review`, () => {
    const note = explain('photo', 'rejected', { reasonCodes: [reason, 'photo_approval_not_confirmed'] });
    assert.match(note, /Choose/);
    assert.doesNotMatch(note, /manual review|wait for review|not a rejection|specific reason wasn't saved/);
    assert.equal(mediaReview.mediaReviewLabel('rejected'), 'Not approved');
  });
}

for (const kind of ['photo', 'video']) {
  test(`${kind} explains uncertainty without calling it a rejection`, () => {
    const note = explain(kind, 'review', { reasonCodes: ['person_count_uncertain', 'branding_or_logo_uncertain'] });
    assert.match(note, /couldn't confirm that you are the only person/);
    assert.match(note, /Possible branding/);
    assert.doesNotMatch(note, /not allowed|wasn't approved/);
  });

  test(`${kind} distinguishes technical delays, active checks, missing reasons and final approvals`, () => {
    assert.match(explain(kind, 'review', { reasonCodes: ['OPENAI_TIMEOUT'], message: 'Photo uploaded, but moderation stopped before approval. Diagnostic code: OPENAI_TIMEOUT.' }), /Retry/);
    assert.doesNotMatch(explain(kind, 'review', { reasonCodes: ['OPENAI_TIMEOUT'] }), /OPENAI/);
    assert.equal(explain(kind, 'moderating'), '');
    assert.equal(explain(kind, 'submitted'), '');
    assert.match(explain(kind, 'rejected'), /specific reason wasn't saved/);
    assert.equal(explain(kind, 'approved', { reasonCodes: ['multiple_people_detected'], message: 'Old rejection.' }), '');
  });
}

test('photo and video reason prefixes resolve to the same actionable explanation', () => {
  const photo = explain('photo', 'rejected', { reasonCodes: ['photo_policy_contact_or_payment_overlay'] });
  const video = explain('video', 'rejected', { reasonCodes: ['policy_contact_or_payment_overlay'] });
  assert.equal(photo, video);
  assert.match(photo, /Remove phone numbers, emails/);
  assert.match(explain('video', 'rejected', { reasonCodes: ['frame_1_explicit_sexual_content_rejected'] }), /intimate areas covered/);
});

test('specific moderator instructions survive automatic review codes', () => {
  assert.equal(explain('video', 'rejected', { reasonCodes: ['person_count_uncertain'], message: 'Replace the segment showing another person at 0:12.' }), 'Replace the segment showing another person at 0:12.');
});

test('unknown and malformed reasons never invent a violation or expose diagnostics', () => {
  assert.equal(explain('photo', 'review', { reasonCodes: ['new_internal_reason', null, {}] }), '');
  assert.match(explain('photo', 'rejected', { reasonCodes: 'multiple_people_detected' }), /specific reason wasn't saved/);
  assert.doesNotMatch(explain('photo', 'review', { reasonCodes: ['new_internal_reason'] }), /new_internal_reason/);
  assert.equal(explain('photo', 'review', { reasonCodes: ['provider_not_flagged'] }), '');
});

for (const kind of ['photo', 'video']) {
  test(`${kind} keeps background processing receipts out of uploading and club approval feedback`, () => {
    for (const status of ['pending', 'moderating']) {
      assert.equal(mediaReview.mediaReviewLabel(status), 'Uploading');
      assert.equal(explain(kind, status, { message: 'Upload received. AI checks are running; club approval is required before it goes live.' }), '');
    }
    for (const status of ['pending_review', 'submitted', 'review', 'completed']) {
      assert.equal(mediaReview.mediaReviewLabel('pending', status), 'Waiting for Club approval');
      assert.equal(explain(kind, 'pending', { moderationStatus: status, message: 'AI checks passed. Pending club approval.' }), '');
    }
    assert.equal(mediaReview.mediaReviewLabel('approved', 'pending_review'), 'Approved');
    assert.equal(mediaReview.mediaReviewLabel('rejected', 'moderating'), 'Not approved');
    assert.match(explain(kind, 'rejected', { reasonCodes: ['multiple_people_detected'] }), /more than one person/);
  });
}
