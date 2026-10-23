import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync('src/lib/dancr/image-moderation.ts', 'utf8');
const ast = ts.createSourceFile('image-moderation.ts', source, ts.ScriptTarget.Latest, true);
const node = ast.statements.find(node => node.name?.text === 'holdPhotoForClubReview');
const code = ts.transpileModule(node.getText(ast) + '\nexports.hold = holdPhotoForClubReview;', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tick = () => new Promise(resolve => setImmediate(resolve));

for (const failCopy of [false, true]) test(`private review and display copies overlap and settle before approval eligibility (failure=${failCopy})`, async () => {
  const started = [], writes = [], removed = [], exports = {};
  const review = Promise.withResolvers(), display = Promise.withResolvers();
  vm.runInNewContext(code, { exports, Date, Set, randomUUID: () => 'unique',
    MODERATION_REVIEW_BUCKET: 'review', APPROVED_PHOTO_BUCKET: 'private-photos', MODERATION_TEMP_BUCKET: 'temp',
    isProfileAvatarUploadContext: () => false,
    uploadPrivateObject: () => { started.push('review'); return review.promise; },
    uploadResponsiveImage: () => { started.push('display'); return display.promise; },
    updateModerationRecord: async (...args) => writes.push(args),
    safeRemoveObject: async (...args) => removed.push(args),
    logModeration() {}, pendingModerationPhoto: id => ({ id }),
  });
  const work = exports.hold({}, { userId: 'owner', profileId: 'profile', recordId: 'record', expectedUpdatedAt: 'version',
    tempPath: 'owner/photo.jpg', uploadContext: 'profile_gallery:1', image: {}, evaluation: { decision: 'approved', reasonCodes: [] }, categoryFlags: {},
  });
  const finished = failCopy ? assert.rejects(work, /storage failed/) : work;
  assert.deepEqual(started, ['review', 'display']);
  if (failCopy) review.reject(Error('storage failed')); else review.resolve();
  await tick(); assert.equal(writes.length, 0); assert.equal(removed.length, 0);
  display.resolve({ storagePath: 'prepared' });
  await finished;
  assert.equal(writes.length, failCopy ? 0 : 1);
  assert.equal(removed.length, failCopy ? 0 : 1);
  if (!failCopy) {
    assert.equal(writes[0][2].status, 'pending_review');
    assert.equal(writes[0][2].categoryFlags.file_checks_passed, true);
    assert.equal(writes[0][2].categoryFlags.ai_recommended_approval, undefined);
  }
});
