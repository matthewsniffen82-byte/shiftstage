import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
  assert.match(videoModeration, /contact_or_payment_overlay/);
  assert.match(videoModeration, /sexual_services_or_solicitation/);
  assert.match(videoModeration, /drug_use_or_sales/);
  assert.match(videoModeration, /nonconsensual_or_coercive_content/);
  assert.match(videoModeration, /policyDecision\.confidence >= 0\.9 \? "rejected" : "review"/);
  assert.match(videoModeration, /policyDecision\.confidence >= 0\.86 \? "approved" : "review"/);
  assert.match(videoModeration, /await rm\(workspace, \{ recursive: true, force: true \}\)/);
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
  assert.match(submitRoute, /export const maxDuration = 60/);
  assert.match(submitRoute, /passed safety review and will appear whenever your dancer profile is live/);
  assert.match(submitRoute, /sent to an administrator for human review/);
});

test("temporary demo mode auto-approves without removing the AI moderation path", () => {
  assert.match(tvSource, /isVideoDemoAutoApproveMode/);
  assert.match(
    tvSource,
    /const demoAutoApprove = isVideoDemoAutoApproveMode\(\)[\s\S]*?\.eq\("status", "uploading"\)[\s\S]*?if \(demoAutoApprove\) \{\s*return autoApproveMyDancrTvDemoUpload\(admin, moderating, submittedAt, "moderating"\);/,
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
    /isVideoDemoAutoApproveMode[\s\S]*?\.in\("status", \["submitted", "moderating"\]\)[\s\S]*?autoApprovePendingMyDancrTvDemoVideo/,
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
  assert.match(vercelConfig, /"path": "\/api\/cron\/video-moderation"[\s\S]*?"schedule": "15 9 \* \* \*"/);
  assert.match(studio, /Automated review:/);
  assert.match(studio, /video frames checked/);
  assert.match(adminPanel, /Automated safety review:/);
  assert.match(adminPanel, /moderationReasonCodes/);
  assert.match(nextConfig, /serverExternalPackages: \["ffmpeg-static"\]/);
  assert.match(nextConfig, /node_modules\/ffmpeg-static\/ffmpeg\*/);
  assert.match(videoModeration, /import ffmpegPath from "ffmpeg-static"/);
});
