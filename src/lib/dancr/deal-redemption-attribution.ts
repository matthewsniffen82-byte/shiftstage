import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyDancerDealAttributionToken } from "./deal-attribution";
import { getVerifiedActiveCheckInAtVenue } from "./deals";
import type { DealSourceType } from "./types";

type DancrClient = SupabaseClient;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DealRedemptionAttributionInput = {
  sourceType: DealSourceType;
  dancerId: string | null;
  attributionToken: string;
  venueId: string;
  dealId: string;
};

export type ResolvedDealRedemptionAttribution = {
  sourceType: DealSourceType;
  dancerId: string | null;
  shiftId: string | null;
};

export class DealRedemptionAttributionError extends Error {
  readonly status: 400 | 409;

  constructor(message: string, status: 400 | 409) {
    super(message);
    this.name = "DealRedemptionAttributionError";
    this.status = status;
  }
}

export async function resolveDealRedemptionAttribution(
  client: DancrClient,
  input: DealRedemptionAttributionInput,
): Promise<ResolvedDealRedemptionAttribution> {
  if (input.sourceType !== "dancer_profile") {
    return { sourceType: "club_page", dancerId: null, shiftId: null };
  }

  const dancerId = input.dancerId?.trim() || "";
  const attributionToken = input.attributionToken.trim();
  if (!UUID_PATTERN.test(dancerId) || !attributionToken) {
    throw new DealRedemptionAttributionError(
      "The dancer attribution is missing. Reopen the dancer profile.",
      400,
    );
  }

  const attribution = verifyDancerDealAttributionToken(attributionToken);
  if (
    !attribution
    || attribution.dancerId !== dancerId
    || attribution.venueId !== input.venueId
    || attribution.dealId !== input.dealId
  ) {
    throw new DealRedemptionAttributionError(
      "The dancer attribution expired. Reopen the dancer profile.",
      400,
    );
  }

  const verifiedCheckIn = await getVerifiedActiveCheckInAtVenue(
    client,
    dancerId,
    input.venueId,
  );
  if (!verifiedCheckIn || verifiedCheckIn.shiftId !== attribution.shiftId) {
    throw new DealRedemptionAttributionError(
      "The dancer is no longer verified at this venue.",
      409,
    );
  }

  return {
    sourceType: "dancer_profile",
    dancerId,
    shiftId: verifiedCheckIn.shiftId,
  };
}
