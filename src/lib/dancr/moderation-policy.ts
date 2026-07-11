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
    sexualReview: readThreshold("DANCR_SEXUAL_REVIEW_THRESHOLD", 0.72),
    sexualReject: readThreshold("DANCR_SEXUAL_REJECT_THRESHOLD", 0.92),
    violenceReject: readThreshold("DANCR_VIOLENCE_REJECT_THRESHOLD", 0.82),
    selfHarmReject: readThreshold("DANCR_SELF_HARM_REJECT_THRESHOLD", 0.72),
    minorReject: readThreshold("DANCR_MINOR_REJECT_THRESHOLD", 0.001),
  };
}

export function evaluateDancrImageModeration(result: ProviderModerationResult | null | undefined): DancrImageModerationEvaluation {
  const thresholds = dancrImageModerationThresholds();
  const categories = result?.categories || {};
  const categoryScores = normalizeScores(result?.category_scores || result?.categoryScores || {});
  const providerFlagged = Boolean(result?.flagged);
  const reasonCodes = new Set<string>();

  if (!result || !result.categories || !(result.category_scores || result.categoryScores)) {
    return {
      decision: "review",
      reasonCodes: ["provider_response_incomplete"],
      categoryScores,
      providerFlagged,
    };
  }

  const sexual = score(categoryScores, "sexual");
  const sexualMinors = Math.max(score(categoryScores, "sexual/minors"), score(categoryScores, "sexual_minors"));
  const violenceGraphic = Math.max(score(categoryScores, "violence/graphic"), score(categoryScores, "violence_graphic"));
  const selfHarm = Math.max(score(categoryScores, "self-harm"), score(categoryScores, "self_harm"), score(categoryScores, "self-harm/intent"), score(categoryScores, "self_harm_intent"));
  const illicitViolent = Math.max(score(categoryScores, "illicit/violent"), score(categoryScores, "illicit_violent"));

  if (Boolean(categories["sexual/minors"]) || Boolean(categories.sexual_minors) || sexualMinors > thresholds.minorReject) {
    reasonCodes.add("minor_safety_escalation");
    return { decision: "rejected", reasonCodes: [...reasonCodes], categoryScores, providerFlagged };
  }

  if (Boolean(categories["violence/graphic"]) || Boolean(categories.violence_graphic) || violenceGraphic >= thresholds.violenceReject) {
    reasonCodes.add("graphic_violence");
  }

  if (Boolean(categories["self-harm"]) || Boolean(categories.self_harm) || selfHarm >= thresholds.selfHarmReject) {
    reasonCodes.add("self_harm");
  }

  if (Boolean(categories["illicit/violent"]) || Boolean(categories.illicit_violent) || illicitViolent >= thresholds.violenceReject) {
    reasonCodes.add("violent_or_illicit_content");
  }

  if (sexual >= thresholds.sexualReject && Boolean(categories.sexual)) {
    reasonCodes.add("high_confidence_explicit_sexual_content");
  }

  if (reasonCodes.size) {
    return { decision: "rejected", reasonCodes: [...reasonCodes], categoryScores, providerFlagged };
  }

  if (sexual >= thresholds.sexualReview && Boolean(categories.sexual)) {
    reasonCodes.add("sexual_signal_requires_human_review");
  }

  if (providerFlagged) {
    reasonCodes.add("provider_flagged_without_clear_auto_reject");
  }

  if (reasonCodes.size) {
    return { decision: "review", reasonCodes: [...reasonCodes], categoryScores, providerFlagged };
  }

  return { decision: "approved", reasonCodes: [], categoryScores, providerFlagged };
}

function normalizeScores(scores: Record<string, number>) {
  return Object.fromEntries(Object.entries(scores || {}).map(([key, value]) => [key, Number(value) || 0]));
}

function score(scores: Record<string, number>, key: string) {
  return Number(scores[key] || 0);
}

function readThreshold(name: string, fallback: number) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}
