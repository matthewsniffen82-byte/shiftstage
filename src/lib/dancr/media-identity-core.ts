import type {
  DancrImageModerationEvaluation,
  DancrImageModerationDecision,
} from "./moderation-policy.ts";

const MEDIA_IDENTITY_APPROVE_CONFIDENCE = 0.82;
const MEDIA_IDENTITY_REJECT_CONFIDENCE = 0.9;
const PERSON_COUNT_REQUIRED_CONFIDENCE = 0.9;

export type DancerMediaIdentityReferenceMatch =
  | "match"
  | "mismatch"
  | "uncertain"
  | "not_provided";

export type DancerMediaIdentityAnalysis = {
  personCount: number;
  personCountConfidence: number;
  singlePersonOnly: boolean;
  referenceMatch: DancerMediaIdentityReferenceMatch;
  confidence: number;
};

export type DancerMediaIdentityEvaluation = {
  decision: DancrImageModerationDecision;
  reasonCodes: string[];
  analysis: DancerMediaIdentityAnalysis;
};

export class DancerIdentityReferenceRequiredError extends Error {
  readonly code = "DANCER_IDENTITY_REFERENCE_REQUIRED";

  constructor() {
    super("Upload an approved avatar before adding profile photos or videos.");
    this.name = "DancerIdentityReferenceRequiredError";
  }
}

export function isDancerIdentityReferenceRequiredError(error: unknown) {
  return error instanceof DancerIdentityReferenceRequiredError ||
    String((error as { code?: unknown } | null)?.code || "") ===
      "DANCER_IDENTITY_REFERENCE_REQUIRED";
}

export function parseDancerMediaIdentityAnalysis(
  value: unknown,
  referenceProvided: boolean,
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
  const confidence = candidate.confidence;
  const personCountConfidence = candidate.personCountConfidence;
  for (const value of [confidence, personCountConfidence]) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("Dancer media identity review returned invalid confidence.");
    }
  }
  const allowedMatches = new Set<DancerMediaIdentityReferenceMatch>([
    "match",
    "mismatch",
    "uncertain",
    "not_provided",
  ]);
  const suppliedMatch = String(candidate.referenceMatch || "") as DancerMediaIdentityReferenceMatch;
  const referenceMatch = referenceProvided
    ? allowedMatches.has(suppliedMatch) && suppliedMatch !== "not_provided"
      ? suppliedMatch
      : "uncertain"
    : "not_provided";
  return {
    personCount: rawCount,
    personCountConfidence: personCountConfidence as number,
    singlePersonOnly: candidate.singlePersonOnly === true && rawCount === 1,
    referenceMatch,
    confidence: confidence as number,
  };
}

export function evaluateDancerMediaIdentity(
  analysis: DancerMediaIdentityAnalysis,
  options: { referenceRequired: boolean },
): DancerMediaIdentityEvaluation {
  // Recognizing the main dancer is not enough: the entire media must have a
  // separately confident count of exactly one person before it can publish.
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
  if (!options.referenceRequired) {
    return identityEvaluation(
      analysis.confidence >= MEDIA_IDENTITY_APPROVE_CONFIDENCE ? "approved" : "review",
      analysis.confidence >= MEDIA_IDENTITY_APPROVE_CONFIDENCE
        ? "single_dancer_confirmed"
        : "person_count_uncertain",
      analysis,
    );
  }
  if (analysis.referenceMatch === "not_provided") {
    return identityEvaluation("rejected", "dancer_identity_reference_required", analysis);
  }
  if (
    analysis.referenceMatch === "mismatch" &&
    analysis.confidence >= MEDIA_IDENTITY_REJECT_CONFIDENCE
  ) {
    return identityEvaluation("rejected", "dancer_identity_mismatch", analysis);
  }
  if (
    analysis.referenceMatch === "match" &&
    analysis.confidence >= MEDIA_IDENTITY_APPROVE_CONFIDENCE
  ) {
    return identityEvaluation("approved", "dancer_identity_confirmed", analysis);
  }
  return identityEvaluation("review", "dancer_identity_uncertain", analysis);
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
      dancer_identity_confidence: identity.analysis.confidence,
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
    dancer_identity_reference_match: analysis.referenceMatch === "match",
    dancer_identity_reference_mismatch: analysis.referenceMatch === "mismatch",
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
