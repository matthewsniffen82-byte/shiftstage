import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { evaluateDancerMediaIdentity } from '../src/lib/dancr/media-identity-core.ts';
import { evaluateDancrImageModeration } from '../src/lib/dancr/moderation-policy.ts';
import { runVideoReviewChecks } from '../src/lib/dancr/video-review-checks.ts';
import { mediaIdentityRuntime } from './helpers/media-identity-runtime.mjs';

const solo = { personCount: 1, personCountConfidence: 0.99, singlePersonOnly: true };

for (const mediaType of ['photo', 'video']) {
  test(mediaType + ' checks the entire target media in high detail with an independent person-count confidence', async () => {
    const targets = mediaType === 'photo' ? [Buffer.from('original-photo')] : [Buffer.from('first-frame'), Buffer.from('later-frame')];
    const reference = Buffer.from('reference-avatar');
    const runtime = mediaIdentityRuntime({ createResponse: async (request, options) => {
      const content = request.input[0].content;
      const images = content.filter(item => item.type === 'input_image');
      assert.deepEqual(Array.from(images, item => Buffer.from(item.image_url.split(',')[1], 'base64').toString()),
        targets.map(buffer => buffer.toString()));
      assert.ok(images.every(item => item.detail === 'high'));
      assert.deepEqual(Array.from(request.text.format.schema.required), ['personCount', 'personCountConfidence', 'singlePersonOnly']);
      assert.match(request.instructions, /Do not compare appearance with an avatar or verify identity/);
      assert.match(content[0].text, /A different person appearing later still makes personCount greater than one/);
      assert.match(content[0].text, /Count partially visible people even when their face is hidden/);
      assert.match(content[0].text, /Do not double-count the same person's mirror reflection/);
      assert.ok(options.signal instanceof AbortSignal);
      return { status: 'completed', output_text: JSON.stringify(solo) };
    } });
    assert.deepEqual(await runtime.analyzeDancerMediaIdentity({ targetImages: targets, mediaType, referenceImage: reference }), solo);
  });
}

test('an incomplete response cannot certify a single person even if its partial JSON says one', async () => {
  const runtime = mediaIdentityRuntime({ createResponse: async () => ({ status: 'incomplete', output_text: JSON.stringify(solo) }) });
  await assert.rejects(runtime.analyzeDancerMediaIdentity({ targetImages: [Buffer.from('photo')], mediaType: 'photo' }), /incomplete response/);
});

function videoRuntime(identityAnalysis) {
  const source = readFileSync(new URL('../src/lib/dancr/video-moderation.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('video-moderation.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ['moderateStoredMyDancrTvVideo', 'combineVideoDecisions', 'strongestDecision', 'buildModerationText', 'maximumCategoryScores', 'uniqueReasonCodes'];
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast));
  const frames = [Buffer.from('first'), Buffer.from('middle'), Buffer.from('last')];
  const exports = {};
  vm.runInNewContext(ts.transpileModule(selected.join('\n'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports, path, Buffer, console: { info() {} },
    getServerEnv: () => 'synthetic', createOpenAIClient: async () => ({}),
    mkdtemp: async () => 'synthetic-workspace', tmpdir: () => 'synthetic-temp',
    writeFile: async () => {}, rm: async () => {},
    downloadVideo: async () => Buffer.from('video'), assertAllowedVideoContainer() {},
    probeVideoDurationSeconds: async () => 30, extractVideoFrames: async () => frames,
    extractOptionalAudio: async () => null,
    runVideoReviewChecks, evaluateDancerMediaIdentity, evaluateDancrImageModeration,
    moderateFrames: async () => frames.map(() => ({ flagged: false })),
    moderateText: async () => ({ flagged: false }),
    classifyVideoPolicy: async () => ({ decision: 'approved', reasonCodes: [], confidence: 0.99 }),
    analyzeDancerMediaIdentity: async input => {
      assert.equal(input.mediaType, 'video');assert.equal(input.targetImages, frames);
      assert.equal('referenceImage' in input, false);
      return identityAnalysis;
    },
    DANCR_IMAGE_MODERATION_MODEL: 'synthetic', VIDEO_POLICY_MODEL: 'synthetic', DANCR_MEDIA_IDENTITY_MODEL: 'synthetic',
    VIDEO_POLICY_APPROVE_CONFIDENCE: 0.75, VIDEO_POLICY_REJECT_CONFIDENCE: 0.95,
  });
  return () => exports.moderateStoredMyDancrTvVideo({}, {
    videoId: 'synthetic', storagePath: 'synthetic.mp4', storageMime: 'video/mp4', caption: '',
  });
}

for (const [name, analysis, expected] of [
  ['one confirmed dancer', solo, 'approved'],
  ['one person without an avatar match', { ...solo, referenceMatch: 'mismatch', confidence: 0.1 }, 'approved'],
  ['another person anywhere in the sampled frames', { ...solo, personCount: 2, singlePersonOnly: false }, 'rejected'],
  ['multiple people with an uncertain identity match', { ...solo, personCount: 3, singlePersonOnly: false, confidence: 0.4 }, 'rejected'],
  ['uncertain background person despite matching main dancer', { ...solo, personCountConfidence: 0.6 }, 'review'],
  ['no person', { ...solo, personCount: 0, singlePersonOnly: false }, 'rejected'],
  ['missing person-count confidence', { ...solo, personCountConfidence: undefined }, 'review'],
]) test('video moderation: ' + name, async () => {
  const result = await videoRuntime(analysis)();
  assert.equal(result.decision, expected);
  assert.equal(result.details.identityDecision, expected);
  assert.equal(result.details.personCount, analysis.personCount);
  assert.equal(result.details.personCountConfidence, analysis.personCountConfidence);
  if (analysis.personCount > 1) assert.ok(result.reasonCodes.includes('multiple_people_detected'));
});
