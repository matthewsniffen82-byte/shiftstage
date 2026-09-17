import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateDancrImageModeration } from '../src/lib/dancr/moderation-policy.ts';
import { applyDancerPhotoContentPolicy, parseDancerPhotoContentAnalysis } from '../src/lib/dancr/photo-content-policy-core.ts';
import { photoContentRuntime } from './helpers/photo-content-runtime.mjs';

const clear = { nudity: 'absent', sexualActivity: 'absent', confidence: 0.99 };
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

test('covered bikini and lingerie classifications can still pass the policy', () => {
  assert.equal(applyDancerPhotoContentPolicy(generic(), clear).decision, 'approved');
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
