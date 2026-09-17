import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { DANCER_MEDIA_CONTENT_RULES, DANCER_MEDIA_POLICY_REASON_CODES } from "../src/lib/dancr/media-content-rules.ts";
import { withOpenAIRequestDeadline } from "../src/lib/openai-request.ts";
import { evaluateDancrImageModeration } from "../src/lib/dancr/moderation-policy.ts";
import {
  getDistributedVideoFrameSampling,
  parseFfmpegDuration,
} from "../src/lib/dancr/video-frame-sampling.ts";

const [
  videoModeration,
  tvSource,
  migration,
  submitRoute,
  retryRoute,
  studio,
  adminPanel,
  adminReviewRoute,
  nextConfig,
  vercelConfig,
] = await Promise.all([
  readFile(new URL("../src/lib/dancr/video-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/tv.ts", import.meta.url), "utf8"),
  readFile(new URL("../supabase/migrations/202607280001_mydancr_tv_ai_moderation.sql", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/tv/videos/[id]/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/video-moderation/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DancerTvStudio.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/AdminTvPanel.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/tv/videos/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../next.config.mjs", import.meta.url), "utf8"),
  readFile(new URL("../vercel.json", import.meta.url), "utf8"),
]);

function providerResult({ flagged = false, categories = {}, scores = {} } = {}) {
  return { flagged, categories, category_scores: scores };
}

test("shared Dancr moderation thresholds approve promotional content and escalate unsafe content", () => {
  assert.equal(evaluateDancrImageModeration(providerResult()).decision, "approved");
  assert.equal(evaluateDancrImageModeration(providerResult({
    flagged: true,
    categories: { sexual: true },
    scores: { sexual: 0.75 },
  })).decision, "approved");
  assert.equal(evaluateDancrImageModeration(providerResult({
    flagged: true,
    categories: { sexual: true },
    scores: { sexual: 0.95 },
  })).decision, "review");
  assert.equal(evaluateDancrImageModeration(providerResult({
    flagged: true,
    categories: { sexual: true },
    scores: { sexual: 0.99 },
  })).decision, "rejected");
  assert.equal(evaluateDancrImageModeration(providerResult({
    flagged: true,
    categories: { "sexual/minors": true },
    scores: { "sexual/minors": 0.002 },
  })).decision, "rejected");
  assert.equal(evaluateDancrImageModeration(providerResult({
    flagged: true,
    categories: { "violence/graphic": true },
    scores: { violence: 0.4 },
  })).decision, "rejected");
  assert.equal(evaluateDancrImageModeration(providerResult({
    flagged: true,
    categories: { harassment: true },
    scores: { harassment: 0.7 },
  })).decision, "review");
});

test("video moderation checks server-decoded frames, caption, and spoken audio", () => {
  assert.match(videoModeration, /from "ffmpeg-static"/);
  assert.match(videoModeration, /frameSampling: "distributed_across_video"/);
  assert.match(videoModeration, /"-progress",\s*"pipe:1"/);
  assert.match(videoModeration, /sampling\.startOffsetSeconds\.toFixed\(6\)/);
  assert.match(videoModeration, /fps=\$\{sampling\.frameRate\.toFixed\(8\)\}/);
  assert.match(videoModeration, /const MAX_VIDEO_FRAMES = 10/);
  assert.match(videoModeration, /openai\.moderations\.create\([\s\S]*?input/);
  assert.match(videoModeration, /openai\.audio\.transcriptions\.create/);
  assert.match(videoModeration, /response_format:[\s\S]*?type: "json_schema"/);
  assert.match(videoModeration, /DANCER_MEDIA_POLICY_REASON_CODES as VIDEO_POLICY_REASON_CODES/);
  assert.match(videoModeration, /analyzeDancerMediaIdentity/);
  assert.doesNotMatch(videoModeration, /identityReferenceMatch|dancerAvatarStoragePath/);
  assert.match(videoModeration, /singlePersonOnly/);
  assert.match(videoModeration, /const VIDEO_POLICY_APPROVE_CONFIDENCE = 0\.75/);
  assert.match(videoModeration, /const VIDEO_POLICY_REJECT_CONFIDENCE = 0\.95/);
  assert.match(videoModeration, /policyDecision\.confidence >= VIDEO_POLICY_REJECT_CONFIDENCE \? "rejected" : "review"/);
  assert.match(videoModeration, /policyDecision\.confidence >= VIDEO_POLICY_APPROVE_CONFIDENCE \? "approved" : "review"/);
  assert.match(videoModeration, /await rm\(workspace, \{ recursive: true, force: true \}\)/);
});

test("video classifier receives the same full policy as photos, including covered thongs and cleavage", async () => {
  const ast = ts.createSourceFile('video-moderation.ts', videoModeration, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node)
    && ['classifyVideoPolicy', 'uniqueReasonCodes'].includes(node.name?.text)).map(node => node.getText(ast));
  const exports = {};
  vm.runInNewContext(ts.transpileModule(selected.join('\n') + '\nexport { classifyVideoPolicy };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, Buffer, DANCER_MEDIA_CONTENT_RULES, VIDEO_POLICY_REASON_CODES: DANCER_MEDIA_POLICY_REASON_CODES,
    VIDEO_POLICY_MODEL: 'synthetic', OPENAI_TIMEOUT_MS: 1000, withTimeout: withOpenAIRequestDeadline,
  });
  const client = { chat: { completions: { create: async (request, options) => {
    const rules = request.messages[0].content;
    for (const instruction of DANCER_MEDIA_CONTENT_RULES) assert.ok(rules.includes(instruction));
    assert.match(rules, /Thongs and cleavage are explicitly allowed when nipples\/areolas, genitals, and anus are covered/);
    assert.match(rules, /Exposed buttocks from a thong/);
    assert.match(request.messages[1].content[0].text, /Caption: fixture caption/);
    assert.match(request.messages[1].content[0].text, /Audio transcript: fixture transcript/);
    assert.ok(options.signal instanceof AbortSignal);
    return { choices: [{ message: { content: JSON.stringify({ decision: 'approved', reason_codes: ['safe_adult_promotional_content'], confidence: 0.99 }) } }] };
  } } } };
  const result = await exports.classifyVideoPolicy(client, [Buffer.from('frame')], 'fixture caption', 'fixture transcript');
  assert.equal(result.decision, 'approved');
});

test("video moderation distributes frames through the full decoded timeline", () => {
  assert.deepEqual(getDistributedVideoFrameSampling(1, 10), {
    startOffsetSeconds: 0.05,
    frameRate: 10,
  });
  assert.deepEqual(getDistributedVideoFrameSampling(10, 10), {
    startOffsetSeconds: 0.5,
    frameRate: 1,
  });
  assert.deepEqual(getDistributedVideoFrameSampling(60, 10), {
    startOffsetSeconds: 3,
    frameRate: 1 / 6,
  });
  assert.throws(() => getDistributedVideoFrameSampling(0, 10), /duration could not be determined/);
  assert.throws(() => getDistributedVideoFrameSampling(Number.NaN, 10), /duration could not be determined/);

  const progressAndMetadata = [
    "Duration: 00:00:10.000000, start: 0.000000, bitrate: 1000 kb/s",
    "out_time=00:00:00.500000",
    "progress=continue",
    "out_time=00:00:09.900000",
    "progress=end",
  ].join("\n");
  assert.equal(parseFfmpegDuration(progressAndMetadata), 10);
  assert.equal(parseFfmpegDuration("Duration: 01:02:03.500000"), 3723.5);
  assert.equal(parseFfmpegDuration("out_time=N/A\nprogress=end"), null);
});

test("video frame moderation respects the provider one-image limit with bounded retries", () => {
  assert.match(videoModeration, /const FRAME_MODERATION_CONCURRENCY = 3/);
  assert.match(videoModeration, /const FRAME_MODERATION_RETRY_DELAYS_MS = \[350\] as const/);
  assert.match(
    videoModeration,
    /const workerCount = Math\.min\(FRAME_MODERATION_CONCURRENCY, frames\.length\)[\s\S]*?results\[frameIndex\] = await moderateFrame\(openai, frames\[frameIndex\], frameIndex\)/,
  );
  assert.match(
    videoModeration,
    /openai\.moderations\.create\(\{[\s\S]*?input: \[[\s\S]*?type: "image_url" as const[\s\S]*?\][\s\S]*?\}\)/,
  );
  assert.doesNotMatch(videoModeration, /const input = frames\.map/);
  assert.match(videoModeration, /withVideoProviderRetry/);
  assert.match(videoModeration, /\[408, 409, 425, 429\]\.includes\(status\) \|\| status >= 500/);
  assert.match(videoModeration, /"mydancr_tv\.frame_moderation_retry"/);
});

test("video submission persists exactly approve, human-review, or reject outcomes", () => {
  assert.match(tvSource, /status: "moderating"/);
  assert.match(tvSource, /moderateStoredMyDancrTvVideo/);
  assert.match(tvSource, /decision === "approved"[\s\S]*?status: "approved"/);
  assert.match(tvSource, /decision === "rejected"[\s\S]*?status: "rejected"/);
  assert.match(tvSource, /status: "submitted"[\s\S]*?Automated safety review requested human review/);
  assert.doesNotMatch(tvSource, /profile_not_eligible_for_auto_publish/);
  assert.match(tvSource, /isDancerMediaOnboardingEligible/);
  assert.match(tvSource, /Videos stay private during setup|venue_approved_at/);
  assert.match(tvSource, /video_moderation_provider_error/);
  assert.match(submitRoute, /export const maxDuration = 300/);
  assert.match(submitRoute, /after\(async \(\) => \{[\s\S]*?retryMyDancrTvAutomatedModeration/);
  assert.match(submitRoute, /if \(!\("submissionAlreadyAccepted" in video\) \|\| video\.submissionAlreadyAccepted !== true\) \{[\s\S]*?after\(async \(\) =>/);
  assert.match(submitRoute, /\{ deferModeration: true \}/);
  assert.match(submitRoute, /uploaded successfully and is queued for automatic safety review/);
  assert.match(tvSource, /moderation_attempt_count: deferModeration \? 0 : 1/);
  assert.match(tvSource, /moderation_started_at: submittedAt/);
  assert.match(tvSource, /const workerId = deferModeration \? null : crypto\.randomUUID\(\)/);
  assert.match(submitRoute, /passed safety review and will appear whenever your dancer profile is live/);
  assert.match(submitRoute, /sent to an administrator for human review/);
});

test("temporary demo mode auto-approves without removing the AI moderation path", () => {
  assert.match(tvSource, /isVideoDemoAutoApproveMode/);
  assert.match(
    tvSource,
    /const demoAutoApprove = isVideoDemoAutoApproveMode\(\)[\s\S]*?\.eq\("status", "uploading"\)[\s\S]*?if \(deferModeration\) return moderating;[\s\S]*?if \(demoAutoApprove\) \{\s*return autoApproveMyDancrTvDemoUpload\(admin, moderating, submittedAt, "moderating"\);/,
  );
  assert.match(
    tvSource,
    /async function autoApproveMyDancrTvDemoUpload[\s\S]*?demoVideoAutoApprovalValues\(\{[\s\S]*?watermarkApplied/,
  );
  assert.match(tvSource, /moderateStoredMyDancrTvVideo/);
  assert.match(tvSource, /finalizeMyDancrTvAutomatedModeration/);
  assert.match(
    nextConfig,
    /env: \{[\s\S]*?DANCR_VIDEO_MODERATION_MODE:[\s\S]*?process\.env\.DANCR_VIDEO_MODERATION_MODE \|\| "ai"/,
  );
  assert.match(
    retryRoute,
    /isVideoDemoAutoApproveMode[\s\S]*?\.or\("status.eq.moderating,and\(status.eq.submitted,moderation_attempt_count.lt.3\)"\)[\s\S]*?autoApprovePendingMyDancrTvDemoVideo/,
  );
  assert.match(
    tvSource,
    /export async function autoApprovePendingMyDancrTvDemoVideo[\s\S]*?\.eq\("status", "submitted"\)[\s\S]*?autoApproveMyDancrTvDemoUpload/,
  );
});

test("video moderation decisions are durable, recoverable, and visible to dancers and admins", () => {
  assert.match(migration, /add column if not exists moderation_decision text/);
  assert.match(migration, /moderation_reason_codes text\[\]/);
  assert.match(migration, /moderation_category_scores jsonb/);
  assert.match(migration, /moderation_frame_count integer/);
  assert.match(migration, /status in \('uploading', 'moderating', 'submitted', 'approved', 'rejected', 'hidden', 'expired'\)/);
  assert.match(migration, /old\.status in \('submitted', 'moderating'\)/);
  assert.match(retryRoute, /authorizeCronRequest/);
  assert.match(retryRoute, /\.eq\("status", "moderating"\)/);
  assert.match(retryRoute, /retryMyDancrTvAutomatedModeration/);
  assert.deepEqual(JSON.parse(vercelConfig).crons.filter(({ path }) => path === "/api/cron/video-moderation"), [
    { path: "/api/cron/video-moderation", schedule: "2-59/5 * * * *" },
  ]);
  assert.match(studio, /Automated review:/);
  assert.match(studio, /video frames checked/);
  assert.match(adminPanel, /Automated safety review:/);
  assert.match(adminPanel, /moderationReasonCodes/);
  assert.match(nextConfig, /serverExternalPackages: \["ffmpeg-static"\]/);
  assert.match(nextConfig, /node_modules\/ffmpeg-static\/ffmpeg\*/);
  assert.match(videoModeration, /import ffmpegPath from "ffmpeg-static"/);
});

test("every production video-processing route bundles FFmpeg and admin failures stay private", () => {
  assert.match(nextConfig, /"\/api\/admin\/tv\/import": \["\.\/node_modules\/ffmpeg-static\/ffmpeg\*"\]/);
  assert.match(nextConfig, /"\/api\/admin\/tv\/videos": \["\.\/node_modules\/ffmpeg-static\/ffmpeg\*"\]/);
  assert.match(nextConfig, /"\/api\/dancer\/tv\/videos\/\\\\\[id\\\\\]": \["\.\/node_modules\/ffmpeg-static\/ffmpeg\*"\]/);
  assert.match(nextConfig, /"\/api\/cron\/video-moderation": \["\.\/node_modules\/ffmpeg-static\/ffmpeg\*"\]/);
  assert.match(adminReviewRoute, /export const maxDuration = 300/);
  assert.match(adminReviewRoute, /Video processing is temporarily unavailable\. The video was not changed\. Try again shortly\./);
  assert.match(adminReviewRoute, /mydancr_tv\.admin_review_failed/);
  assert.match(adminReviewRoute, /retrySubmittedMyDancrTvAutomatedModeration/);
  assert.match(adminReviewRoute, /action === "retry_automated_review"/);
  assert.match(adminPanel, /Retry automated review/);
  assert.match(tvSource, /Only automated processing failures can restart automated review\./);
});
