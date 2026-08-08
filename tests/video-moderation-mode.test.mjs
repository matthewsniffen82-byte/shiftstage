import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  demoVideoAutoApprovalValues,
  getVideoModerationMode,
  isVideoDemoAutoApproveMode,
} from "../src/lib/dancr/video-moderation-mode.ts";

const [modeSource, envExample, readme] = await Promise.all([
  readFile(new URL("../src/lib/dancr/video-moderation-mode.ts", import.meta.url), "utf8"),
  readFile(new URL("../.env.example", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8"),
]);

test("video moderation defaults to AI and requires an explicit demo bypass", () => {
  const original = process.env.DANCR_VIDEO_MODERATION_MODE;
  try {
    delete process.env.DANCR_VIDEO_MODERATION_MODE;
    assert.equal(getVideoModerationMode(), "ai");
    assert.equal(isVideoDemoAutoApproveMode(), false);

    process.env.DANCR_VIDEO_MODERATION_MODE = "demo_auto_approve";
    assert.equal(getVideoModerationMode(), "demo_auto_approve");
    assert.equal(isVideoDemoAutoApproveMode(), true);

    process.env.DANCR_VIDEO_MODERATION_MODE = "disabled";
    assert.throws(() => getVideoModerationMode(), /must be either ai or demo_auto_approve/);
  } finally {
    if (original === undefined) delete process.env.DANCR_VIDEO_MODERATION_MODE;
    else process.env.DANCR_VIDEO_MODERATION_MODE = original;
  }

  assert.match(modeSource, /VIDEO_MODERATION_MODES = \["ai", "demo_auto_approve"\]/);
  assert.match(modeSource, /process\.env\.DANCR_VIDEO_MODERATION_MODE/);
  assert.match(modeSource, /if \(!configured\) return "ai"/);
  assert.match(modeSource, /must be either ai or demo_auto_approve/);
  assert.match(
    modeSource,
    /isVideoDemoAutoApproveMode[\s\S]*?getVideoModerationMode\(\) === "demo_auto_approve"/,
  );
});

test("demo approval values publish immediately and preserve an explicit audit trail", () => {
  const approved = demoVideoAutoApprovalValues({
    submittedAt: "2026-08-08T00:00:00.000Z",
    completedAt: "2026-08-08T00:00:01.000Z",
    expiresAt: "2026-11-06T00:00:01.000Z",
    watermarkApplied: true,
  });
  assert.equal(approved.status, "approved");
  assert.equal(approved.published_at, "2026-08-08T00:00:01.000Z");
  assert.equal(approved.moderation_decision, "approved");
  assert.equal(approved.moderation_model, "demo-auto-approve-v1");
  assert.deepEqual(approved.moderation_reason_codes, ["demo_mode_auto_approved"]);
  assert.deepEqual(approved.moderation_details, {
    mode: "demo_auto_approve",
    aiModerationSkipped: true,
    watermarkApplied: true,
  });

  const watermarkFallback = demoVideoAutoApprovalValues({
    submittedAt: "2026-08-08T00:00:00.000Z",
    completedAt: "2026-08-08T00:00:01.000Z",
    expiresAt: "2026-11-06T00:00:01.000Z",
    watermarkApplied: false,
  });
  assert.equal(watermarkFallback.status, "approved");
  assert.deepEqual(watermarkFallback.moderation_reason_codes, [
    "demo_mode_auto_approved",
    "demo_watermark_processing_failed",
  ]);
});

test("deployment documentation keeps AI as the safe default", () => {
  assert.match(envExample, /DANCR_VIDEO_MODERATION_MODE=ai/);
  assert.match(readme, /`ai` is the default/);
  assert.match(readme, /`demo_auto_approve` is a temporary demo-population mode/);
  assert.match(readme, /does not retroactively moderate videos published during demo mode/);
});
