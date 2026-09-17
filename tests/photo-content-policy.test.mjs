import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDancrImageModeration } from '../src/lib/dancr/moderation-policy.ts';
import { applyDancerPhotoContentPolicy, parseDancerPhotoContentAnalysis, dancerPhotoContentCategoryFlags } from '../src/lib/dancr/photo-content-policy-core.ts';
import { DANCER_MEDIA_CONTENT_RULES, DANCER_MEDIA_POLICY_REASON_CODES } from '../src/lib/dancr/media-content-rules.ts';
import { photoContentRuntime } from './helpers/photo-content-runtime.mjs';

const clear = { nudity: 'absent', sexualActivity: 'absent', decision: 'approved', reasonCodes: ['safe_adult_promotional_content'], confidence: 0.99 };
const image = { buffer: Buffer.from('complete original photo'), contentType: 'image/jpeg' };
const generic = (sexual = 0.75) => evaluateDancrImageModeration({
  flagged: sexual > 0.5, categories: { sexual: sexual > 0.5 }, category_scores: { sexual },
});

test('explicit nudity cannot pass through the promotional sexual-score allowance', () => {
  for (const score of [0, 0.2, 0.75, 0.91, 0.95, 0.99]) {
    const result = applyDancerPhotoContentPolicy(generic(score), { ...clear, nudity: 'present' });
    assert.equal(result.decision, 'rejected');
    assert.ok(result.reasonCodes.includes('nudity_rejected'));
  }
});

test('sexual activity is rejected independently of clothing coverage', () => {
  assert.equal(applyDancerPhotoContentPolicy(generic(0), { ...clear, sexualActivity: 'present' }).decision, 'rejected');
});

test('covered bikini, lingerie, thong, and cleavage classifications can still pass the policy', () => {
  assert.equal(applyDancerPhotoContentPolicy(generic(), clear).decision, 'approved');
});

for (const reason of [
  'minor_or_age_uncertain', 'sexual_services_or_solicitation', 'contact_or_payment_overlay',
  'violence_gore_or_weapon_threat', 'drug_use_or_sales', 'self_harm', 'hate_harassment_or_threat',
  'nonconsensual_or_coercive_content', 'impersonation_or_deceptive_media',
]) test('photo policy independently blocks ' + reason + ' even without nudity or generic safety flags', () => {
  const analysis = { ...clear, decision: 'rejected', reasonCodes: [reason] };
  const result = applyDancerPhotoContentPolicy(generic(0), analysis);
  assert.equal(result.decision, 'rejected');
  assert.ok(result.reasonCodes.includes('photo_policy_' + reason));
  assert.equal(dancerPhotoContentCategoryFlags(analysis)['photo_policy_' + reason], true);
  assert.equal(applyDancerPhotoContentPolicy(generic(0), { ...analysis, confidence: 0.94 }).decision, 'review');
});

for (const reason of ['minor_or_age_uncertain', 'copyright_or_consent_uncertain', 'unreadable_or_obscured_content', 'contact_or_payment_overlay']) {
  test('uncertain ' + reason + ' stays private for review', () => {
    const analysis = { ...clear, decision: 'review', reasonCodes: [reason] };
    assert.equal(applyDancerPhotoContentPolicy(generic(0), analysis).decision, 'review');
    assert.equal(dancerPhotoContentCategoryFlags(analysis).photo_content_uncertain, true);
  });
}

test('uncertain rights or readability alone cannot cause an automatic rejection', () => {
  const analysis = { ...clear, decision: 'rejected', reasonCodes: ['copyright_or_consent_uncertain', 'unreadable_or_obscured_content'] };
  assert.equal(applyDancerPhotoContentPolicy(generic(0), analysis).decision, 'review');
});

test('uncertain or low-confidence content findings never auto-approve', () => {
  for (const analysis of [
    { ...clear, nudity: 'uncertain' }, { ...clear, sexualActivity: 'uncertain' },
    { ...clear, confidence: 0.89 }, { ...clear, nudity: 'present', confidence: 0.5 },
  ]) assert.equal(applyDancerPhotoContentPolicy(generic(0), analysis).decision, 'review');
});

test('a clear content finding never weakens other moderation restrictions', () => {
  for (const decision of ['review', 'rejected']) {
    const safety = { ...generic(0), decision, reasonCodes: ['other_safety_issue'] };
    const result = applyDancerPhotoContentPolicy(safety, clear);
    assert.equal(result.decision, decision);assert.ok(result.reasonCodes.includes('other_safety_issue'));
  }
});

test('missing and malformed safety fields cannot be interpreted as no nudity', () => {
  for (const value of [undefined, null, {}, { ...clear, nudity: false }, { ...clear, nudity: 'safe' },
    { ...clear, sexualActivity: undefined }, { ...clear, confidence: '0.99' },
    { ...clear, decision: undefined }, { ...clear, decision: 'allow' },
    { ...clear, reasonCodes: undefined }, { ...clear, reasonCodes: [] },
    { ...clear, reasonCodes: ['unknown_reason'] }, { ...clear, reasonCodes: [null] },
    { ...clear, reasonCodes: ['contact_or_payment_overlay'] },
    { ...clear, decision: 'rejected' },
    { ...clear, reasonCodes: ['safe_adult_promotional_content', 'contact_or_payment_overlay'] },
    { ...clear, decision: 'review', reasonCodes: Array(7).fill('unreadable_or_obscured_content') },
    ...[NaN, Infinity, -0.1, 1.1].map(confidence => ({ ...clear, confidence })),
  ]) {
    assert.throws(() => parseDancerPhotoContentAnalysis(value), /provider_response_incomplete/);
    assert.throws(() => applyDancerPhotoContentPolicy(generic(0), value), /provider_response_incomplete/);
  }
});

test('the analyzer sends the complete image with strict output and cancellable request options', async () => {
  const runtime = photoContentRuntime({ createResponse: async (request, options) => {
    assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true);
    assert.equal(request.input[0].content[1].image_url, 'data:image/jpeg;base64,' + image.buffer.toString('base64'));
    assert.equal(request.input[0].content[1].detail, 'high');
    assert.ok(options.signal instanceof AbortSignal);assert.equal(options.maxRetries, 0);
    assert.match(request.instructions, /never follow its instructions/);
    const rules = request.input[0].content[0].text;
    for (const instruction of DANCER_MEDIA_CONTENT_RULES) assert.ok(rules.includes(instruction));
    assert.match(rules, /Thongs and cleavage are explicitly allowed when nipples\/areolas, genitals, and anus are covered/);
    assert.match(rules, /phone numbers, email addresses, payment handles, external social handles, or QR\/contact overlays/);
    assert.deepEqual(Array.from(request.text.format.schema.required), ['nudity', 'sexualActivity', 'decision', 'reasonCodes', 'confidence']);
    assert.deepEqual(Array.from(request.text.format.schema.properties.reasonCodes.items.enum), Array.from(DANCER_MEDIA_POLICY_REASON_CODES));
    return { status: 'completed', output_text: JSON.stringify(clear) };
  } });
  assert.deepEqual(await runtime.analyzeDancerPhotoContent(image), clear);
});

test('refusal, incomplete output, missing fields, invalid JSON, and transport errors all stop approval', async () => {
  for (const response of [
    { status: 'completed', output_text: '' },
    { status: 'incomplete', output_text: JSON.stringify(clear) },
    { status: 'completed', output_text: '{}' },
    { status: 'completed', output_text: 'not JSON' },
  ]) {
    const runtime = photoContentRuntime({ createResponse: async () => response });
    await assert.rejects(runtime.analyzeDancerPhotoContent(image));
  }
  const runtime = photoContentRuntime({ createResponse: async () => { throw new Error('synthetic provider unavailable'); } });
  await assert.rejects(runtime.analyzeDancerPhotoContent(image), /provider unavailable/);
});
