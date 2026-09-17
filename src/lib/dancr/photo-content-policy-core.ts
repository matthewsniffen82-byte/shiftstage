import type { DancrImageModerationDecision, DancrImageModerationEvaluation } from "./moderation-policy.ts";
import { DANCER_MEDIA_POLICY_REASON_CODES, type DancerMediaPolicyReason } from "./media-content-rules.ts";

type ContentFinding = "absent" | "present" | "uncertain";

export type DancerPhotoContentAnalysis = {
  nudity: ContentFinding;
  sexualActivity: ContentFinding;
  decision: DancrImageModerationDecision;
  reasonCodes: DancerMediaPolicyReason[];
  confidence: number;
};

export function parseDancerPhotoContentAnalysis(value: unknown): DancerPhotoContentAnalysis {
  if (!value || typeof value !== "object") throw incompleteResponse();
  const { nudity, sexualActivity, decision, reasonCodes, confidence } = value as Record<string, unknown>;
  const findings = new Set(["absent", "present", "uncertain"]);
  if (typeof nudity !== "string" || !findings.has(nudity)
    || typeof sexualActivity !== "string" || !findings.has(sexualActivity)
    || typeof decision !== "string" || !["approved", "review", "rejected"].includes(decision)
    || !Array.isArray(reasonCodes) || reasonCodes.length < 1 || reasonCodes.length > 6
    || reasonCodes.some(reason => !DANCER_MEDIA_POLICY_REASON_CODES.includes(reason))
    || typeof confidence !== "number" || !Number.isFinite(confidence)
    || confidence < 0 || confidence > 1) throw incompleteResponse();
  const approvedReason = reasonCodes.includes("safe_adult_promotional_content");
  if (decision === "approved" ? !approvedReason || reasonCodes.length !== 1 : approvedReason) throw incompleteResponse();
  return {
    nudity: nudity as ContentFinding, sexualActivity: sexualActivity as ContentFinding,
    decision: decision as DancrImageModerationDecision,
    reasonCodes: [...new Set(reasonCodes)] as DancerMediaPolicyReason[], confidence,
  };
}

export function applyDancerPhotoContentPolicy(
  safety: DancrImageModerationEvaluation,
  value: DancerPhotoContentAnalysis,
): DancrImageModerationEvaluation {
  // A low generic sexual score is not proof that the subject is clothed.
  // Require a separate, complete assessment of the original uploaded image.
  const analysis = parseDancerPhotoContentAnalysis(value);
  const present = analysis.nudity === "present" || analysis.sexualActivity === "present";
  const clear = analysis.nudity === "absent" && analysis.sexualActivity === "absent"
    && analysis.decision === "approved" && analysis.confidence >= 0.9;
  const policyReject = analysis.decision === "rejected" && analysis.confidence >= 0.95
    && analysis.reasonCodes.some(reason => reason !== "copyright_or_consent_uncertain" && reason !== "unreadable_or_obscured_content");
  const decision = (present && analysis.confidence >= 0.85) || policyReject ? "rejected" : clear ? "approved" : "review";
  const reasons = decision === "rejected"
    ? [analysis.nudity === "present" ? "nudity_rejected" : "",
      analysis.sexualActivity === "present" ? "explicit_sexual_content_rejected" : ""].filter(Boolean)
    : [clear ? "photo_content_clear" : "photo_content_requires_review"];
  return {
    decision: safety.decision === "rejected" || decision === "rejected" ? "rejected"
      : safety.decision === "review" || decision === "review" ? "review" : "approved",
    reasonCodes: [...new Set([...safety.reasonCodes, ...reasons,
      ...analysis.reasonCodes.map(reason => `photo_policy_${reason}`)])],
    categoryScores: { ...safety.categoryScores, photo_content_confidence: analysis.confidence },
    providerFlagged: safety.providerFlagged,
  };
}

export function dancerPhotoContentCategoryFlags(analysis: DancerPhotoContentAnalysis) {
  return {
    photo_nudity: analysis.nudity === "present",
    photo_sexual_activity: analysis.sexualActivity === "present",
    photo_content_uncertain: analysis.nudity === "uncertain" || analysis.sexualActivity === "uncertain"
      || analysis.decision === "review" || analysis.confidence < 0.9,
    ...Object.fromEntries(analysis.reasonCodes.map(reason => [`photo_policy_${reason}`, true])),
  };
}

function incompleteResponse() {
  return new Error("provider_response_incomplete: photo content review");
}
