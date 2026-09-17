import type {
  DancrImageModerationEvaluation,
  DancrImageModerationDecision,
} from "./moderation-policy.ts";

const PERSON_COUNT_REQUIRED_CONFIDENCE = 0.9;

export type DancerMediaIdentityAnalysis = {
  personCount: number;
  personCountConfidence: number;
  singlePersonOnly: boolean;
};

export type DancerMediaIdentityEvaluation = {
  decision: DancrImageModerationDecision;
  reasonCodes: string[];
  analysis: DancerMediaIdentityAnalysis;
};

export function parseDancerMediaIdentityAnalysis(
  value: unknown,
): DancerMediaIdentityAnalysis {
  if (!value || typeof value !== "object") {
    throw new Error("Dancer media identity review returned an incomplete response.");
  }
  const candidate = value as Record<string, unknown>;
  const rawCount = candidate.personCount;
  if (typeof rawCount !== "number" || !Number.isInteger(rawCount) || rawCount < 0 || rawCount > 20) {
    throw new Error("Dancer media identity review returned an invalid person count.");
  }
  if (typeof candidate.singlePersonOnly !== "boolean") {
    throw new Error("Dancer media identity review returned an incomplete person count.");
  }
  const personCountConfidence = candidate.personCountConfidence;
  if (typeof personCountConfidence !== "number" || !Number.isFinite(personCountConfidence)
    || personCountConfidence < 0 || personCountConfidence > 1) {
    throw new Error("Dancer media identity review returned invalid confidence.");
  }
  return {
    personCount: rawCount,
    personCountConfidence,
    singlePersonOnly: candidate.singlePersonOnly === true && rawCount === 1,
  };
}

export function evaluateDancerMediaIdentity(
  analysis: DancerMediaIdentityAnalysis,
): DancerMediaIdentityEvaluation {
  // This check only counts people; it does not compare anyone with an avatar.
  if (!Number.isInteger(analysis.personCount) || analysis.personCount < 0 || analysis.personCount > 20
    || !Number.isFinite(analysis.personCountConfidence)
    || analysis.personCountConfidence < PERSON_COUNT_REQUIRED_CONFIDENCE || analysis.personCountConfidence > 1) {
    return identityEvaluation("review", "person_count_uncertain", analysis);
  }
  if (analysis.personCount === 0) {
    return identityEvaluation("rejected", "dancer_not_visible", analysis);
  }
  if (analysis.personCount > 1) {
    return identityEvaluation("rejected", "multiple_people_detected", analysis);
  }
  if (analysis.singlePersonOnly !== true) {
    return identityEvaluation("review", "person_count_uncertain", analysis);
  }
  return identityEvaluation("approved", "single_dancer_confirmed", analysis);
}

export function combineDancerMediaModeration(
  safety: DancrImageModerationEvaluation,
  identity: DancerMediaIdentityEvaluation,
): DancrImageModerationEvaluation {
  return {
    decision: strongestDecision([safety.decision, identity.decision]),
    reasonCodes: [...new Set([...safety.reasonCodes, ...identity.reasonCodes])],
    categoryScores: {
      ...safety.categoryScores,
      dancer_identity_person_count: identity.analysis.personCount,
      dancer_identity_person_count_confidence: identity.analysis.personCountConfidence,
    },
    providerFlagged: safety.providerFlagged,
  };
}

export function dancerMediaIdentityCategoryFlags(
  analysis: DancerMediaIdentityAnalysis,
) {
  return {
    dancer_identity_single_person: analysis.singlePersonOnly,
  };
}

function identityEvaluation(
  decision: DancrImageModerationDecision,
  reasonCode: string,
  analysis: DancerMediaIdentityAnalysis,
): DancerMediaIdentityEvaluation {
  return { decision, reasonCodes: [reasonCode], analysis };
}

function strongestDecision(decisions: DancrImageModerationDecision[]) {
  if (decisions.includes("rejected")) return "rejected";
  if (decisions.includes("review")) return "review";
  return "approved";
}
