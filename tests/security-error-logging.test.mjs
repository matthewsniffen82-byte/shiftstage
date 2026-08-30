import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { safeErrorMetadata } from "../src/lib/security/safe-error-metadata.ts";

const [
  api,
  moderation,
  profile,
  dancer,
  rateLimit,
  admin,
  imageWorker,
  videoWorker,
  stripeWebhook,
  auth,
  dmca,
  adminOperations,
  health,
  mediaWatermark,
  dashboard,
] = await Promise.all([
  readFile(new URL("../src/lib/api.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/image-moderation.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/dancer/profile/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dancer.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/public-request-rate-limit.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/image-moderation/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/cron/video-moderation/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/stripe/webhook/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/auth/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/dmca.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/admin-operations.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/health/supabase/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/dancr/media-watermark.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/dashboard/DashboardClient.tsx", import.meta.url), "utf8"),
]);

test("safe error metadata keeps operational codes without messages, stacks, or response bodies", () => {
  const error = Object.assign(new Error("password=secret /srv/private/file.ts"), {
    code: "provider_timeout",
    status: 503,
    request_id: "req_123",
    response: { data: { token: "secret" } },
  });
  const metadata = safeErrorMetadata(error);
  assert.deepEqual(metadata, {
    errorName: "Error",
    code: "provider_timeout",
    status: 503,
    requestId: "req_123",
  });
  assert.doesNotMatch(JSON.stringify(metadata), /password|secret|private|stack|response/i);
});

test("shared API errors log only sanitized metadata", () => {
  assert.match(api, /safeErrorMetadata\(error\)/);
  assert.doesNotMatch(api, /message: resolved\.internalMessage/);
});

test("image moderation logs no key fragments, provider bodies, stacks, or signed-object paths", () => {
  assert.doesNotMatch(moderation, /apiKeySuffix|apiKey\.slice\(-4\)|failedBodyPreview|responseData|providerError\.response|providerError\.stack/);
  assert.doesNotMatch(moderation, /stack: error instanceof Error/);
  assert.match(moderation, /safeErrorMetadata\(error\)/);
  assert.doesNotMatch(moderation, /STORAGE_IMAGE_RECORD[\s\S]{0,220}storagePath:/);
  const structuredLogs = [...moderation.matchAll(/logModeration\([^,\n]+,\s*\{[\s\S]*?\}\);/g)]
    .map((match) => match[0]);
  assert.ok(structuredLogs.length > 0);
  for (const log of structuredLogs) {
    assert.doesNotMatch(log, /(?:temporaryStoragePath|storagePath|userId):/);
  }
});

test("profile and photo logs retain counts and stages without payload values or storage paths", () => {
  assert.match(profile, /DANCER_PROFILE_SAVE_ERROR[\s\S]{0,180}safeErrorMetadata\(error\)/);
  assert.doesNotMatch(profile, /DANCER_PROFILE_SAVE_ERROR[\s\S]{0,260}(details:|hint:|stack:)/);
  const payloadLog = profile.match(/console\.log\("PROFILE_SAVE_PAYLOAD", \{[\s\S]*?\n    \}\);/)?.[0] || "";
  assert.match(payloadLog, /deletedPhotoCount/);
  assert.doesNotMatch(payloadLog, /\bdeletedPhotoIds\s*[:,}]/);
  assert.doesNotMatch(profile, /PUBLIC_PROFILE_STATE_(?:BEFORE|AFTER)_SAVE/);
  assert.doesNotMatch(dancer, /PHOTO_DELETE_CLICKED[\s\S]{0,180}storagePath:/);
});

test("rate-limit and admin authorization failures emit privacy-minimized security events", () => {
  assert.match(rateLimit, /security\.rate_limit_exceeded/);
  assert.match(admin, /security\.admin_authorization_denied/);
  assert.doesNotMatch(admin, /security\.admin_authorization_denied[\s\S]{0,220}userId/);
});

test("production workers and provider callbacks use the shared allowlisted error boundary", () => {
  for (const source of [imageWorker, videoWorker, stripeWebhook, auth, dmca, adminOperations, health]) {
    assert.match(source, /safeErrorMetadata/);
    assert.doesNotMatch(source, /responseData|errorMessage|failedBodyPreview|apiKeySuffix|\.stack\?*\.slice/);
    assert.doesNotMatch(source, /message:\s*(?:error|[a-zA-Z]+Error)(?:\?|\.)/);
  }
  assert.doesNotMatch(imageWorker, /storagePath:\s*claimed\.temporary_storage_path|safeWorkerError/);
  assert.doesNotMatch(stripeWebhook, /error instanceof Error \? error\.message/);
  assert.doesNotMatch(dmca, /Unable to load the DMCA uploader email[\s\S]{0,220}uploaderError\s*[,}]/);
  assert.doesNotMatch(adminOperations, /function errorMessage|message:\s*errorMessage/);
});

test("production diagnostics omit private storage paths and client profile state values", () => {
  assert.doesNotMatch(mediaWatermark, /event: "public_media\.video_watermarked"[\s\S]{0,240}(?:storagePath|posterStoragePath):/);
  assert.doesNotMatch(dashboard, /PUBLIC_PROFILE_STATE_AFTER_RESET/);
  assert.doesNotMatch(dashboard, /EDIT_PROFILE_BEFORE_SAVE[\s\S]{0,260}(?:deletedPhotoIds|profilePhotoIds):/);
  assert.doesNotMatch(dashboard, /EDIT_PROFILE_SAVE_PAYLOAD[\s\S]{0,320}(?:\bcity|deletedPhotoIds):/);
});
