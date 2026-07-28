export type DancrImageModerationDecision = "approved" | "review" | "rejected";

export type DancrImageModerationEvaluation = {
  decision: DancrImageModerationDecision;
  reasonCodes: string[];
  categoryScores: Record<string, number>;
  providerFlagged: boolean;
};

type ProviderModerationResult = {
  flagged?: boolean;
  categories?: object;
  category_scores?: object;
  categoryScores?: object;
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
  const categories = (result?.categories || {}) as Record<string, boolean>;
  const categoryScores = normalizeScores(result?.category_scores || result?.categoryScores || {});
  const providerFlagged = Boolean(result?.flagged);
  const thresholds = dancrImageModerationThresholds();

  if (!result || typeof result.flagged !== "boolean") {
    return {
      decision: "review",
      reasonCodes: ["provider_response_incomplete"],
      categoryScores,
      providerFlagged,
    };
  }

  const rejectedReasons = [
    categoryActive(categories, "sexual/minors", "sexual_minors") ||
    categoryScore(categoryScores, "sexual/minors", "sexual_minors") >= thresholds.minorReject
      ? "minor_safety_rejected"
      : "",
    categoryScore(categoryScores, "sexual") >= thresholds.sexualReject
      ? "explicit_sexual_content_rejected"
      : "",
    categoryActive(categories, "violence/graphic", "violence_graphic") ||
    categoryScore(categoryScores, "violence") >= thresholds.violenceReject
      ? "violent_content_rejected"
      : "",
    categoryActive(categories, "self-harm/instructions", "self_harm_instructions") ||
    categoryScore(categoryScores, "self-harm", "self_harm") >= thresholds.selfHarmReject
      ? "self_harm_content_rejected"
      : "",
    categoryActive(categories, "illicit/violent", "illicit_violent")
      ? "illicit_violent_content_rejected"
      : "",
    categoryActive(categories, "hate/threatening", "hate_threatening")
      ? "threatening_hate_content_rejected"
      : "",
  ].filter(Boolean);

  if (rejectedReasons.length) {
    return {
      decision: "rejected",
      reasonCodes: rejectedReasons,
      categoryScores,
      providerFlagged,
    };
  }

  const sexualScore = categoryScore(categoryScores, "sexual");
  const activeCategories = activeCategoryNames(categories);
  const nonPromotionalFlags = activeCategories.filter((category) =>
    category !== "sexual" && category !== "sexual_minors",
  );
  const reviewReasons = [
    sexualScore >= thresholds.sexualReview ? "sexual_content_requires_review" : "",
    providerFlagged && !activeCategories.length ? "provider_flagged_manual_review" : "",
    ...nonPromotionalFlags.map((category) => `provider_flagged_${category}`),
  ].filter(Boolean);

  if (reviewReasons.length) {
    return {
      decision: "review",
      reasonCodes: reviewReasons,
      categoryScores,
      providerFlagged,
    };
  }

  return {
    decision: "approved",
    reasonCodes: providerFlagged
      ? ["promotional_adult_content_below_review_threshold"]
      : ["provider_not_flagged"],
    categoryScores,
    providerFlagged,
  };
}

function normalizeScores(scores: object) {
  return Object.fromEntries(Object.entries(scores || {}).map(([key, value]) => [key, Number(value) || 0]));
}

function activeCategoryNames(categories: Record<string, boolean>) {
  return Object.entries(categories || {})
    .filter(([, active]) => Boolean(active))
    .map(([key]) => normalizeCategoryKey(key));
}

function categoryActive(categories: Record<string, boolean>, ...names: string[]) {
  const normalized = new Set(activeCategoryNames(categories));
  return names.some((name) => normalized.has(normalizeCategoryKey(name)));
}

function categoryScore(scores: Record<string, number>, ...names: string[]) {
  const normalizedNames = new Set(names.map((name) => normalizeCategoryKey(name)));
  return Object.entries(scores).reduce((maximum, [name, score]) =>
    normalizedNames.has(normalizeCategoryKey(name)) ? Math.max(maximum, Number(score) || 0) : maximum,
  0);
}

function normalizeCategoryKey(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function readThreshold(name: string, fallback: number, options: { minimum?: number; maximum?: number } = {}) {
  const value = Number(process.env[name]);
  const threshold = Number.isFinite(value) ? value : fallback;
  const minimum = options.minimum ?? 0;
  const maximum = options.maximum ?? 1;
  return Math.max(minimum, Math.min(maximum, threshold));
}
