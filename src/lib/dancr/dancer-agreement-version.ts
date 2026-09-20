export const DANCER_AGREEMENT_VERSION = "2026-09-17-v4";
export const DANCER_AGREEMENT_HREF = "/dancer-agreement";
export const DANCER_AGREEMENT_CONSENT = "I agree to the Dancer Agreement.";

export type DancerAgreementAccess = {
  required: boolean;
  accepted: boolean;
  version: string;
  acceptedAt: string | null;
};
