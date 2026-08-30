export const VIDEO_MODERATION_MODES = ["ai", "demo_auto_approve"] as const;

export type VideoModerationMode = (typeof VIDEO_MODERATION_MODES)[number];

export function getVideoModerationMode(): VideoModerationMode {
  const configured = process.env.DANCR_VIDEO_MODERATION_MODE?.trim().toLowerCase();
  if (!configured) return "ai";
  if (VIDEO_MODERATION_MODES.includes(configured as VideoModerationMode)) {
    return configured as VideoModerationMode;
  }
  throw new Error(
    "DANCR_VIDEO_MODERATION_MODE must be either ai or demo_auto_approve.",
  );
}

export function isVideoDemoAutoApproveMode() {
  return getVideoModerationMode() === "demo_auto_approve";
}

export function demoVideoAutoApprovalValues(input: {
  submittedAt: string;
  completedAt: string;
  expiresAt: string;
  watermarkApplied: boolean;
  posterStoragePath?: string | null;
}) {
  return {
    status: "approved" as const,
    submitted_at: input.submittedAt,
    review_notes: "Published automatically while MyDancr TV demo auto-approval is enabled.",
    moderation_decision: "approved" as const,
    moderation_reason_codes: [
      "demo_mode_auto_approved",
      ...(input.watermarkApplied ? [] : ["demo_watermark_processing_failed"]),
    ],
    moderation_category_scores: {},
    moderation_provider_flagged: false,
    moderation_frame_count: 0,
    moderation_model: "demo-auto-approve-v1",
    moderation_details: {
      mode: "demo_auto_approve",
      aiModerationSkipped: true,
      watermarkApplied: input.watermarkApplied,
      ...(input.posterStoragePath
        ? { posterStoragePath: input.posterStoragePath }
        : {}),
    },
    moderation_started_at: null,
    moderation_completed_at: input.completedAt,
    reviewed_by: null,
    reviewed_at: input.completedAt,
    published_at: input.completedAt,
    expires_at: input.expiresAt,
  };
}
