export const QR_COMMISSION_POLICY_VERSION = "monthly-tier-v1";

export const QR_COMMISSION_TIERS = [
  {
    minimumSuccessfulRedemptions: 1,
    maximumSuccessfulRedemptions: 24,
    dancerShareBps: 3000,
    platformShareBps: 7000,
  },
  {
    minimumSuccessfulRedemptions: 25,
    maximumSuccessfulRedemptions: 74,
    dancerShareBps: 4000,
    platformShareBps: 6000,
  },
  {
    minimumSuccessfulRedemptions: 75,
    maximumSuccessfulRedemptions: null,
    dancerShareBps: 5000,
    platformShareBps: 5000,
  },
] as const;

export function commissionTierForSuccessfulRedemption(successfulRedemptionNumber: number) {
  const normalized = Math.max(1, Math.trunc(successfulRedemptionNumber));
  if (normalized >= 75) return QR_COMMISSION_TIERS[2];
  if (normalized >= 25) return QR_COMMISSION_TIERS[1];
  return QR_COMMISSION_TIERS[0];
}

export function splitQrCommission(grossCommissionCents: number, successfulRedemptionNumber: number) {
  const gross = Math.max(0, Math.trunc(grossCommissionCents));
  const tier = commissionTierForSuccessfulRedemption(successfulRedemptionNumber);
  const dancerCommissionCents = Math.round((gross * tier.dancerShareBps) / 10_000);

  return {
    grossCommissionCents: gross,
    dancerShareBps: tier.dancerShareBps,
    dancerCommissionCents,
    platformCommissionCents: gross - dancerCommissionCents,
    successfulRedemptionNumber: Math.max(1, Math.trunc(successfulRedemptionNumber)),
    policyVersion: QR_COMMISSION_POLICY_VERSION,
  };
}
