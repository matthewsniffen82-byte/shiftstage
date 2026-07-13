export type DancrImageModerationDecision = "approved" | "review" | "rejected";

export type DancrImageModerationEvaluation = {
  decision: DancrImageModerationDecision;
  reasonCodes: string[];
  categoryScores: Record<string, number>;
  providerFlagged: boolean;
};

type ProviderModerationResult = {
  flagged?: boolean;
  categories?: Record<string, boolean>;
  category_scores?: Record<string, number>;
  categoryScores?: Record<string, number>;
};

export const DANCR_IMAGE_MODERATION_MODEL = "omni-moderation-latest";

export function dancrImageModerationThresholds() {
  return {
    // Dancr allows revealing promotional photos. Keep review close to reject so ordinary
    // clothed, bikini, lingerie, and stage outfit photos can auto-approve more often.
    // Old deployments may still have a very low env value such as 0.38. Do not let
    // stale config force normal photos into manual review.
    sexualReview: readThreshold("DANCR_SEXUAL_REVIEW_THRESHOLD", 0.92, { minimum: 0.9 }),
    sexualReject: readThreshold("DANCR_SEXUAL_REJECT_THRESHOLD", 0.98, { minimum: 0.92 }),
    violenceReject: readThreshold("DANCR_VIOLENCE_REJECT_THRESHOLD", 0.82),
    selfHarmReject: readThreshold("DANCR_SELF_HARM_REJECT_THRESHOLD", 0.72),
    minorReject: readThreshold("DANCR_MINOR_REJECT_THRESHOLD", 0.001),
  };
}

export function evaluateDancrImageModeration(result: ProviderModerationResult | null | undefined): DancrImageModerationEvaluation {
  const categories = result?.categories || {};
  const categoryScores = normalizeScores(result?.category_scores || result?.categoryScores || {});
  const providerFlagged = Boolean(result?.flagged);

  if (!result || typeof result.flagged !== "boolean") {
    return {
      decision: "review",
      reasonCodes: ["provider_response_incomplete"],
      categoryScores,
      providerFlagged,
    };
  }

  if (result.flagged) {
    return {
      decision: "review",
      reasonCodes: flaggedReasonCodes(categories),
      categoryScores,
      providerFlagged: true,
    };
  }

  return {
    decision: "approved",
    reasonCodes: ["provider_not_flagged"],
    categoryScores,
    providerFlagged: false,
  };
}

function normalizeScores(scores: Record<string, number>) {
  return Object.fromEntries(Object.entries(scores || {}).map(([key, value]) => [key, Number(value) || 0]));
}

function flaggedReasonCodes(categories: Record<string, boolean>) {
  const activeCategories = Object.entries(categories || {})
    .filter(([, active]) => Boolean(active))
    .map(([key]) => `provider_flagged_${key.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase()}`);
  if (Boolean(categories["sexual/minors"]) || Boolean(categories.sexual_minors)) {
    activeCategories.unshift("minor_safety_escalation");
  }
  return activeCategories.length ? activeCategories : ["provider_flagged_manual_review"];
}

function readThreshold(name: string, fallback: number, options: { minimum?: number; maximum?: number } = {}) {
  const value = Number(process.env[name]);
  const threshold = Number.isFinite(value) ? value : fallback;
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? 1;
  return Math.max(minimum, Math.min(maximum, threshold));
}
