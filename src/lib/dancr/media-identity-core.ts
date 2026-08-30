import type {
  DancrImageModerationEvaluation,
  DancrImageModerationDecision,
} from "./moderation-policy.ts";

const MEDIA_IDENTITY_APPROVE_CONFIDENCE = 0.82;
const MEDIA_IDENTITY_REJECT_CONFIDENCE = 0.9;

export type DancerMediaIdentityReferenceMatch =
  | "match"
  | "mismatch"
  | "uncertain"
  | "not_provided";

export type DancerMediaIdentityAnalysis = {
  personCount: number;
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
  const rawCount = Number(candidate.personCount);
  if (!Number.isInteger(rawCount) || rawCount < 0 || rawCount > 20) {
    throw new Error("Dancer media identity review returned an invalid person count.");
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
  const confidence = Number(candidate.confidence);
  return {
    personCount: rawCount,
    singlePersonOnly: candidate.singlePersonOnly === true && rawCount === 1,
    referenceMatch,
    confidence: Number.isFinite(confidence)
      ? Math.max(0, Math.min(1, confidence))
      : 0,
  };
}

export function evaluateDancerMediaIdentity(
  analysis: DancerMediaIdentityAnalysis,
  options: { referenceRequired: boolean },
): DancerMediaIdentityEvaluation {
  if (analysis.personCount === 0) {
    return identityEvaluation(
      analysis.confidence >= MEDIA_IDENTITY_REJECT_CONFIDENCE ? "rejected" : "review",
      analysis.confidence >= MEDIA_IDENTITY_REJECT_CONFIDENCE
        ? "dancer_not_visible"
        : "dancer_visibility_uncertain",
      analysis,
    );
  }
  if (analysis.personCount > 1 || !analysis.singlePersonOnly) {
    return identityEvaluation(
      analysis.confidence >= MEDIA_IDENTITY_APPROVE_CONFIDENCE ? "rejected" : "review",
      analysis.confidence >= MEDIA_IDENTITY_APPROVE_CONFIDENCE
        ? "multiple_people_detected"
        : "person_count_uncertain",
      analysis,
    );
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
