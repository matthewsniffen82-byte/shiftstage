export const DANCER_AGREEMENT_VERSION = "2026-10-30";
export const DANCER_AGREEMENT_HREF = "/dancer-agreement/2026-10-30";
export const DANCER_AGREEMENT_CONSENT = "I’m 18 or older and agree to the Dancer Agreement.";

export type DancerAgreementAccess = {
  required: boolean;
  accepted: boolean;
  version: string;
  acceptedAt: string | null;
};
