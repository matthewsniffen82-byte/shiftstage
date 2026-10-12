import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaReview } from './helpers/media-review-label.mjs';

const explain = mediaReview.mediaReviewExplanation;

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
    assert.match(explain(kind, 'moderating'), /automatic check is still running/);
    assert.match(explain(kind, 'submitted'), /specific reason wasn't provided/);
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
  assert.match(explain('photo', 'review', { reasonCodes: ['new_internal_reason', null, {}] }), /specific reason wasn't provided/);
  assert.match(explain('photo', 'rejected', { reasonCodes: 'multiple_people_detected' }), /specific reason wasn't saved/);
  assert.doesNotMatch(explain('photo', 'review', { reasonCodes: ['new_internal_reason'] }), /new_internal_reason/);
  assert.match(explain('photo', 'review', { reasonCodes: ['provider_not_flagged'] }), /specific reason wasn't provided/);
});
